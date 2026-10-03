"""With the new estimators on, the stream writes one v2 row a minute for a side capacitance places in bed."""
import json
import os
import sys
import unittest
import unittest.mock

sys.path.insert(0, os.path.dirname(__file__))

import migrated_db
import stream_fixture
import stream_processor
from presence.sensors import CAPSENSE
from vitals2_stream import PumpSpeed

COLUMNS = ('side', 'timestamp', 'heart_rate', 'hrv', 'breathing_rate', 'hr_quality', 'rmssd', 'sdnn',
           'hrv_coverage', 'resp_rate', 'resp_quality', 'estimator')


def stream_rows(name, **options):
    db_module = stream_fixture.run_stream(migrated_db.load_db_module(name), **options)
    return [dict(zip(COLUMNS, row)) for row in db_module.conn.execute(
        f'SELECT {", ".join(COLUMNS)} FROM vitals ORDER BY side, timestamp')]


class Vitals2StreamTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows = stream_rows('db_for_v2_stream', v2=True, capacitance=True)

    def test_one_row_a_minute_for_the_occupied_side_only(self):
        self.assertEqual({row['side'] for row in self.rows}, {'left'})
        stamps = [row['timestamp'] for row in self.rows]
        self.assertTrue(all(stamp % 60 == 0 for stamp in stamps))
        self.assertEqual(stamps, sorted(set(stamps)))
        self.assertGreaterEqual(len(stamps), 6)

    def test_rows_carry_the_known_rates(self):
        for row in self.rows:
            self.assertEqual(row['estimator'], 2)
            self.assertLessEqual(abs(row['heart_rate'] - 58), 1)
            if row['hr_quality'] is not None:
                self.assertGreaterEqual(row['hr_quality'], 0.5)
        breathing = [row['resp_rate'] for row in self.rows if row['resp_rate'] is not None]
        self.assertTrue(breathing)
        for value in breathing:
            self.assertAlmostEqual(value, 14, delta=0.7)
        self.assertTrue(all(row['breathing_rate'] in (0, round(row['resp_rate'] or 0)) for row in self.rows))

    def test_hrv_appears_once_five_minutes_of_signal_exist(self):
        with_hrv = [row for row in self.rows if row['rmssd'] is not None]
        self.assertTrue(with_hrv)
        for row in with_hrv:
            self.assertGreaterEqual(row['hrv_coverage'], 0.6)
            self.assertAlmostEqual(row['rmssd'], 28, delta=8)
            self.assertEqual(row['hrv'], int(row['sdnn'] + 0.5))


class PiezoPresenceFallbackTest(unittest.TestCase):
    def test_without_capacitance_presence_the_legacy_rows_are_written_as_with_the_switch_off(self):
        db_module = stream_fixture.run_stream(migrated_db.load_db_module('db_for_v2_piezo_stream'), v2=True)
        with open(os.path.join(os.path.dirname(__file__), 'fixtures', 'legacy_stream_vitals.json')) as handle:
            expected = handle.read()
        self.assertEqual(json.dumps(stream_fixture.legacy_rows(db_module)) + '\n', expected)
        self.assertEqual(db_module.conn.execute('SELECT COUNT(*) FROM vitals WHERE estimator = 2').fetchone()[0], 0)


class HandOverTest(unittest.TestCase):
    """Capacitance arrives at 360 s and stops at 780 s; presence goes back to piezo 60 s later."""

    CAP_FROM, CAP_UNTIL = 360, 780

    @classmethod
    def setUpClass(cls):
        with unittest.mock.patch.object(stream_processor.logger, 'info') as info:
            cls.rows = stream_rows('db_for_v2_hand_over', seconds=1200, v2=True,
                                   capacitance=(cls.CAP_FROM, cls.CAP_UNTIL))
        cls.said = [call.args[0] for call in info.call_args_list if call.args[0].startswith('Vitals now')]
        cls.start = stream_fixture.START

    def seconds(self, estimator):
        return [row['timestamp'] - self.start for row in self.rows
                if row['side'] == 'left' and row['estimator'] == estimator]

    def test_each_path_writes_only_while_it_is_in_charge(self):
        legacy, newer = self.seconds(None), self.seconds(2)
        back = self.CAP_UNTIL + stream_fixture.CAP_FRESH_SECONDS
        self.assertTrue([second for second in legacy if second < self.CAP_FROM])
        self.assertTrue([second for second in legacy if second >= back])
        self.assertEqual([second for second in legacy if self.CAP_FROM <= second < back], [])
        self.assertGreaterEqual(len(newer), 3)
        # The newer rows start after the minute the legacy path last wrote in, and end before the
        # minute it starts again in.
        self.assertTrue(all(self.CAP_FROM // 60 * 60 + 60 <= second < back // 60 * 60 for second in newer))

    def test_no_side_and_minute_has_rows_from_both_paths(self):
        minutes = {}
        for row in self.rows:
            minutes.setdefault((row['side'], row['timestamp'] // 60), set()).add(row['estimator'])
        self.assertTrue(all(len(paths) == 1 for paths in minutes.values()))

    def test_each_change_of_path_is_logged(self):
        self.assertEqual(self.said, ['Vitals now from the newer estimators', 'Vitals now from the legacy estimators'])


class ClockStepBackAfterHandOverTest(unittest.TestCase):
    def test_rows_after_a_long_step_back_are_written(self):
        start = stream_fixture.START
        rows = stream_rows('db_for_v2_step_back', seconds=1200, v2=True, capacitance=True, step_back=(600, 1800))
        before = [row['timestamp'] for row in rows if row['timestamp'] >= start]
        after = [row['timestamp'] for row in rows if row['timestamp'] < start]
        self.assertTrue(before)
        self.assertGreaterEqual(len(after), 5)
        self.assertTrue(all(row['estimator'] == 2 for row in rows))


class VitalsSwitchTest(unittest.TestCase):
    def _processor(self, **options):
        return stream_processor.StreamProcessor(next(stream_fixture.records(1)), **options)

    def test_off_is_the_default(self):
        processor = self._processor()
        self.assertFalse(processor.vitals2_enabled)
        self.assertFalse(processor._use_vitals2(stream_fixture.START))

    def test_the_newer_path_needs_the_switch_and_capacitance_presence_and_starts_cold(self):
        processor = self._processor()
        self.assertIsNone(processor.vitals2)
        processor.use_vitals_v2(True)
        before = processor.vitals2
        self.assertFalse(processor._use_vitals2(stream_fixture.START))
        self.assertIs(processor.vitals2, before)
        processor.use_presence_v2((stream_fixture.PARAMS, stream_fixture.BASELINES))
        self.assertTrue(processor._use_vitals2(stream_fixture.START))
        running = processor.vitals2
        self.assertIsNot(running, before)
        self.assertTrue(processor._use_vitals2(stream_fixture.START + 1))
        self.assertIs(processor.vitals2, running)
        processor.use_vitals_v2(False)
        self.assertFalse(processor._use_vitals2(stream_fixture.START + 2))
        # Switched off, nothing is kept for the newer path.
        self.assertIsNone(processor.vitals2)

    def test_every_estimator_reads_the_pump_it_was_given(self):
        pump = PumpSpeed()
        processor = self._processor(pump=pump)
        processor.use_vitals_v2(True)
        self.assertIs(processor.vitals2.pump, pump)
        processor.use_presence_v2((stream_fixture.PARAMS, stream_fixture.BASELINES))
        self.assertTrue(processor._use_vitals2(stream_fixture.START))
        self.assertIs(processor.vitals2.pump, pump)
        # Presence handed back to piezo with the switch still on: a fresh estimator, same pump.
        processor.use_presence_v2(None)
        self.assertFalse(processor._use_vitals2(stream_fixture.START + 1))
        self.assertIs(processor.vitals2.pump, pump)

    def test_only_the_capacitance_detector_places_a_side(self):
        start = stream_fixture.START
        latest = stream_processor.LatestCap()
        latest.update(start, stream_fixture.LEFT_CHANNELS, stream_fixture.BASELINE)
        processor = self._processor(cap_source=latest)
        processor.left_processor.present = True
        # The piezo detector is in charge: no side and no capacitance age.
        self.assertEqual(processor._present_sides(), {'left': False, 'right': False})
        self.assertIsNone(processor._cap_age(start + 3))
        processor.use_presence_v2((stream_fixture.PARAMS, stream_fixture.BASELINES))
        processor.left_processor.present = True
        self.assertEqual(processor._present_sides(), {'left': True, 'right': False})
        self.assertEqual(processor._cap_age(start + 3), 3)
        # A reading in a format the detector is not reading places nothing.
        latest.update(start, stream_fixture.LEFT_CHANNELS, stream_fixture.BASELINE, CAPSENSE)
        self.assertIsNone(processor._cap_age(start + 3))

    def test_without_a_capacitance_source_there_is_no_age(self):
        processor = self._processor()
        processor.use_presence_v2((stream_fixture.PARAMS, stream_fixture.BASELINES))
        self.assertIsNone(processor._cap_age(stream_fixture.START))

    def test_a_side_swap_resets_both_sides_of_the_v2_state(self):
        processor = self._processor()
        processor.use_vitals_v2(True)
        processor.vitals2.sides['left'].last_present = 1_790_600_000
        processor.vitals2.sides['right'].last_present = 1_790_600_000
        with unittest.mock.patch.object(stream_processor, 'is_side_swap', return_value=True):
            processor.use_presence_v2((stream_fixture.PARAMS, stream_fixture.BASELINES))
            with unittest.mock.patch.object(processor.presence, 'step', return_value={'left': True, 'right': False}):
                processor._step_presence(next(stream_fixture.records(1)))
        self.assertIsNone(processor.vitals2.sides['left'].last_present)
        self.assertIsNone(processor.vitals2.sides['right'].last_present)

    def test_a_side_swap_writes_the_rows_the_previous_occupant_still_owes_first(self):
        processor = self._processor()
        processor.use_vitals_v2(True)
        owed = {'side': 'left', 'timestamp': 1_790_600_040, 'estimator': 2}
        events = []
        with unittest.mock.patch.object(processor.vitals2, 'flush', return_value=[owed]) as flush, \
                unittest.mock.patch.object(processor.vitals2, 'reset_side',
                                           side_effect=lambda side: events.append(('reset', side))), \
                unittest.mock.patch.object(stream_processor, 'insert_vitals',
                                           side_effect=lambda row: events.append(('insert', row))), \
                unittest.mock.patch.object(stream_processor, 'is_side_swap', return_value=True):
            processor.use_presence_v2((stream_fixture.PARAMS, stream_fixture.BASELINES))
            with unittest.mock.patch.object(processor.presence, 'step', return_value={'left': True, 'right': False}):
                record = next(stream_fixture.records(1))
                processor._step_presence(record)
        flush.assert_called_once_with(int(record['ts']), processor.piezo_layout)
        self.assertEqual(events, [('insert', owed), ('reset', 'left'), ('reset', 'right')])


if __name__ == '__main__':
    unittest.main()
