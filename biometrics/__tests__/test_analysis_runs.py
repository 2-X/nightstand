"""Every analyzer run leaves one row saying what it did."""
import json
import logging
import os
import sqlite3
import subprocess
import sys
import time
import unittest

BIOMETRICS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
sys.path.insert(0, BIOMETRICS)
import get_logger as gl

gl._get_file_handler = lambda *args: logging.NullHandler()
for name in gl.LOGGER_NAMES:
    gl.get_logger(name)

import analysis_runs

ROOT = os.path.join(BIOMETRICS, '..')
MIGRATION = os.path.join(ROOT, 'server', 'prisma', 'migrations', '20260930000000_analysis_runs', 'migration.sql')


class AnalysisRunsTest(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(':memory:', isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        with open(MIGRATION) as file:
            self.conn.executescript(file.read())

    def _row(self, run_id):
        return dict(self.conn.execute('SELECT * FROM analysis_runs WHERE id = ?', (run_id,)).fetchone())

    def test_start_records_a_running_row(self):
        before = int(time.time())
        run_id = analysis_runs.start_run('left', analysis_runs.KIND_ANALYZE, 100, 200, conn=self.conn)
        row = self._row(run_id)
        with open(os.path.join(ROOT, 'server', 'src', 'serverInfo.json')) as file:
            version = json.load(file)['version']
        self.assertEqual((row['side'], row['kind'], row['window_start'], row['window_end'], row['status']),
                         ('left', 'analyze', 100, 200, 'running'))
        self.assertGreaterEqual(row['started_at'], before)
        self.assertIsNone(row['finished_at'])
        self.assertEqual(row['code_version'], version)

    def test_start_closes_an_unfinished_run_left_by_a_killed_process(self):
        dead = analysis_runs.start_run('left', analysis_runs.KIND_ANALYZE, 100, 200, conn=self.conn)
        other_side = analysis_runs.start_run('right', analysis_runs.KIND_ANALYZE, 100, 200, conn=self.conn)
        fresh = analysis_runs.start_run('left', analysis_runs.KIND_ANALYZE, 300, 400, conn=self.conn)
        row = self._row(dead)
        self.assertEqual((row['status'], row['error']), ('failed', 'Interrupted before it finished'))
        self.assertIsNotNone(row['finished_at'])
        self.assertEqual(self._row(other_side)['status'], 'running')
        self.assertEqual(self._row(fresh)['status'], 'running')

    def test_finish_records_outcome_and_counts(self):
        run_id = analysis_runs.start_run('right', analysis_runs.KIND_ANALYZE, 100, 200, conn=self.conn)
        analysis_runs.finish_run(run_id, analysis_runs.STATUS_OK, conn=self.conn, rows_loaded=88000,
                                 records_written=1, movement_written=742, duration_ms=61000, peak_rss_mb=512.5)
        row = self._row(run_id)
        self.assertEqual((row['status'], row['rows_loaded'], row['records_written'], row['movement_written'],
                          row['duration_ms'], row['peak_rss_mb'], row['error']),
                         ('ok', 88000, 1, 742, 61000, 512.5, None))
        self.assertIsNotNone(row['finished_at'])

    def test_finish_clears_the_interrupted_error_of_a_run_that_completes(self):
        run_id = analysis_runs.start_run('left', analysis_runs.KIND_ANALYZE, 100, 200, conn=self.conn)
        analysis_runs.start_run('left', analysis_runs.KIND_ANALYZE, 300, 400, conn=self.conn)
        self.assertEqual(self._row(run_id)['error'], analysis_runs.INTERRUPTED)
        analysis_runs.finish_run(run_id, analysis_runs.STATUS_OK, conn=self.conn)
        row = self._row(run_id)
        self.assertEqual((row['status'], row['error']), ('ok', None))

    def test_finish_keeps_the_error_it_is_given(self):
        run_id = analysis_runs.start_run('left', analysis_runs.KIND_ANALYZE, 100, 200, conn=self.conn)
        analysis_runs.finish_run(run_id, analysis_runs.STATUS_FAILED, conn=self.conn, error='Out of memory')
        self.assertEqual(self._row(run_id)['error'], 'Out of memory')

    def test_finish_rejects_a_run_that_does_not_exist(self):
        with self.assertRaises(ValueError):
            analysis_runs.finish_run(999, analysis_runs.STATUS_OK, conn=self.conn)

    def test_finish_rejects_unknown_status_and_fields(self):
        run_id = analysis_runs.start_run('left', analysis_runs.KIND_ANALYZE, 100, 200, conn=self.conn)
        with self.assertRaises(ValueError):
            analysis_runs.finish_run(run_id, 'healthy', conn=self.conn)
        with self.assertRaises(ValueError):
            analysis_runs.finish_run(run_id, analysis_runs.STATUS_OK, conn=self.conn, rows=1)

    def test_summary_reads_naturally(self):
        self.assertEqual(
            analysis_runs.summarize({'records_written': 1, 'movement_written': 742, 'rows_loaded': 88000}),
            '1 sleep record and 742 movement rows from 88,000 sensor rows',
        )
        self.assertEqual(
            analysis_runs.summarize({'records_written': 0, 'movement_written': 0, 'rows_loaded': 0}),
            '0 sleep records and 0 movement rows from 0 sensor rows',
        )


class PeakRssTest(unittest.TestCase):
    @staticmethod
    def _run_child(code):
        return subprocess.check_output([sys.executable, '-c', code], text=True)

    def test_peak_grows_with_an_allocation(self):
        # A fresh process, so an earlier test's peak cannot hide the growth.
        code = (f'import sys; sys.path.insert(0, {BIOMETRICS!r}); '
                'from resource_usage import get_peak_rss_mb; '
                'before = get_peak_rss_mb(); block = b"x" * (80 * 1024 * 1024); '
                'print(before, get_peak_rss_mb())')
        before, after = map(float, self._run_child(code).split())
        self.assertGreater(before, 0)
        self.assertGreaterEqual(after, before + 60)

    def test_child_reports_its_own_peak_not_its_parents(self):
        # Linux carries a Python parent's resident size into ru_maxrss across exec.
        parent_block = b'x' * (300 * 1024 * 1024)
        code = (f'import sys; sys.path.insert(0, {BIOMETRICS!r}); '
                'from resource_usage import get_peak_rss_mb; print(get_peak_rss_mb())')
        peak = float(self._run_child(code))
        self.assertGreater(len(parent_block), 0)
        self.assertLess(peak, 150)


if __name__ == '__main__':
    unittest.main()
