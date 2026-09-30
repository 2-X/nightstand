"""The same RAW input gives the same movement and sleep records, with no side effects."""
import logging
import os
import sys
import tempfile
import unittest
import unittest.mock
import warnings
from datetime import timezone

import cbor2
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'sleep_detection'))
import get_logger as gl

gl._get_file_handler = lambda *args: logging.NullHandler()
for name in gl.LOGGER_NAMES:
    gl.get_logger(name)

import cap_data
import load_raw_files
import piezo_data
import sleep_detector

START = pd.Timestamp('2026-09-28 04:00:00')
START_EPOCH = 1790568000


def _two_rows_per_second(seconds):
    """Capacitance arrives about twice a second; the first row of each second
    counts up by one, the second sits 100 higher."""
    index, rows = [], []
    for second in range(seconds):
        stamp = START + pd.Timedelta(seconds=second)
        index += [stamp, stamp]
        rows += [(second, second, second), (second + 100, second + 100, second + 100)]
    return pd.DataFrame(rows, columns=['left_out', 'left_cen', 'left_in'], index=pd.DatetimeIndex(index, name='ts'))


def _varying_rows(seconds):
    """Like _two_rows_per_second, but each 2-minute bin moves by a different amount."""
    index, rows, level = [], [], 0
    for second in range(seconds):
        level += second // 120 + second % 3
        stamp = START + pd.Timedelta(seconds=second)
        index += [stamp, stamp]
        rows += [(level, level, level), (level + 100, level + 100, level + 100)]
    return pd.DataFrame(rows, columns=['left_out', 'left_cen', 'left_in'], index=pd.DatetimeIndex(index, name='ts'))


class OneRowPerSecondTest(unittest.TestCase):
    def test_keeps_the_first_row_of_each_second_in_load_order(self):
        kept = sleep_detector._one_row_per_second(_two_rows_per_second(3600).reset_index())
        self.assertEqual(kept['left_out'].tolist(), list(range(3600)))


class DetectMovementTest(unittest.TestCase):
    def test_two_minute_bins_from_first_rows_without_writing_files(self):
        with warnings.catch_warnings(), \
                unittest.mock.patch.object(pd.DataFrame, 'to_csv', side_effect=AssertionError('no debug csv')):
            warnings.simplefilter('error', FutureWarning)
            rows = sleep_detector.detect_movement('left', _two_rows_per_second(300))
        # The first bin has no second before it and the last is cut short.
        self.assertEqual(rows, [(START_EPOCH + 120, 3.0)])

    def test_same_input_gives_same_movement(self):
        first = sleep_detector.detect_movement('left', _two_rows_per_second(3600))
        second = sleep_detector.detect_movement('left', _two_rows_per_second(3600))
        self.assertEqual(first, second)
        self.assertEqual({value for _, value in first}, {3.0})
        self.assertEqual(len(first), 29)

    def test_a_shorter_window_gives_the_same_bins_inside_it(self):
        # The analysis can run over a whole day or over one sleep; a bin both
        # cover must hold the same value, and a bin cut off by the window's
        # edge must not be written at all.
        whole = sleep_detector.detect_movement('left', _varying_rows(3600))
        part = sleep_detector.detect_movement('left', _varying_rows(3600).iloc[1200:4800].copy())
        expected = [row for row in whole if START_EPOCH + 601 <= row[0] and row[0] + 119 <= START_EPOCH + 2399]
        self.assertEqual(len(expected), 14)
        self.assertEqual(part, expected)
        self.assertGreater(len({value for _, value in part}), 5)

    def test_capacitance_rows_without_a_reading_are_skipped(self):
        # Pod 5 writes a capacitance row of -1 on every channel every few minutes.
        frame = _two_rows_per_second(600)
        stamps = pd.DatetimeIndex([START + pd.Timedelta(seconds=s) for s in (130, 250, 400)], name='ts')
        no_reading = pd.DataFrame(-1, columns=frame.columns, index=stamps)
        with_gaps = pd.concat([no_reading, frame]).sort_index(kind='stable')
        self.assertEqual(sleep_detector.detect_movement('left', with_gaps),
                         sleep_detector.detect_movement('left', _two_rows_per_second(600)))

    def test_a_bin_with_a_non_finite_value_is_left_out(self):
        frame = _two_rows_per_second(600).astype(float)
        frame.iloc[2 * 250, 0] = np.inf
        rows = sleep_detector.detect_movement('left', frame)
        self.assertTrue(rows)
        self.assertTrue(all(np.isfinite(value) for _, value in rows))
        self.assertNotIn(START_EPOCH + 240, [epoch for epoch, _ in rows])


def _raw(seconds):
    """Decoded RAW for the left side: two capacitance rows a second moving by a
    varying amount, and one piezo row a second whose average jumps around, so
    the piezo percentile trim drops different seconds in different windows."""
    rng = np.random.default_rng(7)
    cap, piezo, level = [], [], 0
    for second in range(seconds):
        level += second // 120 + second % 3
        ts = (START + pd.Timedelta(seconds=second)).strftime('%Y-%m-%d %H:%M:%S')
        cap.append({'ts': ts, 'left': {'out': level, 'cen': level, 'in': level}})
        cap.append({'ts': ts, 'left': {'out': level + 100, 'cen': level + 100, 'in': level + 100}})
        samples = (rng.normal(size=10) * 1000 + rng.integers(-500_000, 500_000)).astype(np.int32)
        piezo.append({'ts': ts, 'type': 'piezo-dual', 'freq': 500, 'adc': 1, 'gain': 1, 'left1': samples})
    return {'cap_senses': cap, 'piezo_dual': piezo}


class WindowIndependentMovementTest(unittest.TestCase):
    def _detect(self, raw, first_second, last_second):
        start = START + pd.Timedelta(seconds=first_second)
        end = START + pd.Timedelta(seconds=last_second)

        def load(folder_path, start_time, end_time, *args, **kwargs):
            inside = lambda row: str(start_time) <= row['ts'] <= str(end_time)
            return {'cap_senses': [r for r in raw['cap_senses'] if inside(r)],
                    'piezo_dual': [r for r in raw['piezo_dual'] if inside(r)]}

        with unittest.mock.patch.object(sleep_detector, 'load_raw_files', side_effect=load), \
                unittest.mock.patch.object(sleep_detector, 'load_baseline', return_value=None):
            merged, _, cap = sleep_detector.detect_sleep('left', start.to_pydatetime(), end.to_pydatetime(), '/persistent/')
        return merged, sleep_detector.detect_movement('left', cap)

    def test_two_windows_over_the_same_raw_give_the_same_common_bins(self):
        raw = _raw(3600)
        whole_merged, whole = self._detect(raw, 0, 3599)
        part_merged, part = self._detect(raw, 1200, 3599)
        self.assertNotIn('left_no_reading', whole_merged.columns)
        # The piezo trim keeps different seconds in each window.
        common = part_merged.index.min()
        self.assertNotEqual(set(whole_merged.index[whole_merged.index >= common]), set(part_merged.index))
        common_bins = sorted(set(epoch for epoch, _ in whole) & set(epoch for epoch, _ in part))
        self.assertGreaterEqual(len(common_bins), 15)
        self.assertEqual([row for row in part if row[0] in common_bins],
                         [row for row in whole if row[0] in common_bins])
        self.assertEqual(len(part), len(common_bins))


def _write_cap_sense2(path, rows):
    """A Pod 5 RAW file of capSense2 records, (second, eight values) each."""
    with open(path, 'wb') as handle:
        for seq, (second, values) in enumerate(rows):
            record = {'type': 'capSense2', 'ts': START_EPOCH + second,
                      'left': {'values': values, 'status': 'good'}, 'right': {'values': values, 'status': 'good'}}
            handle.write(cbor2.dumps({'seq': seq, 'data': cbor2.dumps(record)}))


class PartialCapReadingTest(unittest.TestCase):
    """Pod 5 sometimes writes -1 for a few of a record's eight values; the
    pair average then reads about half the real level."""

    def _load(self, rows, **kwargs):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, 'night.RAW')
            _write_cap_sense2(path, rows)
            data = {'capSense': []}
            start = START.to_pydatetime().replace(tzinfo=timezone.utc)
            load_raw_files._decode_cbor_file(path, data, start, start + pd.Timedelta(hours=1), 'left', 1)
        return cap_data.load_cap_df({'cap_senses': data['capSense']}, 'left', **kwargs)

    def test_a_row_with_any_value_missing_is_skipped_for_movement_only(self):
        levels = [float(10 + second % 7) for second in range(600)]
        rows = [(second, [level] * 6 + [1.2, 1.2]) for second, level in enumerate(levels)]
        partial = list(rows)
        partial[250] = (250, [-1.0, levels[250], -1.0, levels[250], -1.0, levels[250], 1.2, -1.0])

        # Presence and calibration read the default frame, which is unchanged.
        plain = self._load(partial)
        self.assertEqual(list(plain.columns), ['left_out', 'left_cen', 'left_in'])
        self.assertEqual(plain['left_out'].iloc[250], (levels[250] - 1) / 2)

        flagged = self._load(partial, with_no_reading=True)
        self.assertEqual(flagged.index[flagged['left_no_reading']].tolist(), [plain.index[250]])
        without = self._load(rows[:250] + rows[251:], with_no_reading=True)
        self.assertEqual(sleep_detector.detect_movement('left', flagged),
                         sleep_detector.detect_movement('left', without))
        self.assertNotEqual(sleep_detector.detect_movement('left', plain),
                            sleep_detector.detect_movement('left', self._load(rows)))


class StableLoadOrderTest(unittest.TestCase):
    def _stamps(self, seconds):
        return [(START + pd.Timedelta(seconds=s)).strftime('%Y-%m-%d %H:%M:%S') for s in range(seconds) for _ in (0, 1)]

    def test_cap_rows_keep_load_order_within_a_second(self):
        stamps = self._stamps(3600)
        data = {'cap_senses': [{'ts': ts, 'left': {'out': i, 'cen': i, 'in': i}} for i, ts in enumerate(stamps)]}
        frame = cap_data.load_cap_df(data, 'left')
        self.assertEqual(frame['left_out'].tolist(), list(range(len(stamps))))

    def test_piezo_rows_keep_load_order_within_a_second(self):
        stamps = self._stamps(3600)
        samples = np.full(10, 1000, dtype=np.int32)
        data = {'piezo_dual': [{'ts': ts, 'type': 'piezo-dual', 'freq': 500, 'adc': 1, 'gain': 1,
                                'left1': samples, 'seq': i} for i, ts in enumerate(stamps)]}
        frame = piezo_data.load_piezo_df(data, 'left')
        self.assertEqual(frame['seq'].tolist(), list(range(len(stamps))))

    def test_current_files_are_in_name_order(self):
        with tempfile.TemporaryDirectory() as folder:
            live = os.path.join(folder, 'live')
            archive = os.path.join(folder, 'data', 'raw-archive')
            os.makedirs(live)
            os.makedirs(archive)
            for path in (os.path.join(live, '0551A09F.RAW'), os.path.join(archive, '0551ACD0.RAW'),
                         os.path.join(archive, '0551946D.RAW')):
                open(path, 'wb').close()
            with unittest.mock.patch.object(load_raw_files.logger, 'folder_path', os.path.join(folder, 'data', '')):
                files = load_raw_files.get_current_files(live)
        self.assertEqual([os.path.basename(p) for p in files], ['0551946D.RAW', '0551A09F.RAW', '0551ACD0.RAW'])


class DetectSleepTest(unittest.TestCase):
    def test_returns_records_without_writing_them(self):
        index = pd.date_range(START, periods=6 * 3600, freq='1s', name='ts')
        present = ((index >= START + pd.Timedelta(hours=1)) & (index < START + pd.Timedelta(hours=5))).astype(int)
        piezo = pd.DataFrame({'piezo_left1_presence': present}, index=index)
        cap = pd.DataFrame({'left_out': np.arange(len(index), dtype=float), 'left_cen': 1.0, 'left_in': 1.0,
                            'left_no_reading': False}, index=index)
        with unittest.mock.patch.object(sleep_detector, 'load_raw_files', return_value={}), \
                unittest.mock.patch.object(sleep_detector, 'load_piezo_df', return_value=piezo), \
                unittest.mock.patch.object(sleep_detector, 'load_cap_df', return_value=cap), \
                unittest.mock.patch.object(sleep_detector, 'detect_presence_piezo_p2p'), \
                unittest.mock.patch.object(sleep_detector, 'load_baseline', return_value=None):
            merged, records, cap_frame = sleep_detector.detect_sleep('left', START.to_pydatetime(),
                                                                     (START + pd.Timedelta(hours=6)).to_pydatetime(), '/persistent/')
        self.assertEqual(len(merged), len(index))
        self.assertNotIn('left_no_reading', merged.columns)
        self.assertIs(cap_frame, cap)
        self.assertEqual(len(cap_frame), len(index))
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]['entered_bed_at'], START + pd.Timedelta(hours=1))
        self.assertEqual(records[0]['left_bed_at'], START + pd.Timedelta(hours=5))
        self.assertEqual(records[0]['sleep_period_seconds'], 4 * 3600)
        self.assertFalse(hasattr(sleep_detector, 'insert_sleep_records'))


if __name__ == '__main__':
    unittest.main()
