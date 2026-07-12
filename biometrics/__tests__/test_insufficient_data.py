"""Tests for the insufficient-data job-outcome classification (UX-10).

Import-light and unittest-compatible: `insufficient_data` uses only the
standard library, so these run anywhere, including the local Mac python that
has no numpy/pandas. Run on the pod with:

    /home/dac/venv/bin/python -m unittest __tests__.test_insufficient_data -v

from /tmp/biom-test/biometrics (see CLAUDE.md's python-tests note).
"""
import os
import sys
import unittest

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from insufficient_data import (
    InsufficientDataError,
    outcome_for_exception,
    WAITING_FOR_DATA,
)


class InsufficientDataErrorTest(unittest.TestCase):
    def test_is_an_exception(self):
        # Must be catchable by the jobs' existing `except Exception` blocks so
        # the classifier gets a chance to relabel it.
        self.assertTrue(issubclass(InsufficientDataError, Exception))

    def test_status_constant_matches_contract(self):
        # Must match the Status enum in serverStatusSchema.ts.
        self.assertEqual(WAITING_FOR_DATA, 'waiting_for_data')


class OutcomeForExceptionTest(unittest.TestCase):
    def test_insufficient_data_becomes_waiting_state(self):
        status, message = outcome_for_exception(
            InsufficientDataError('No piezo rows found for the requested window')
        )
        self.assertEqual(status, 'waiting_for_data')
        self.assertIn('No piezo rows', message)

    def test_insufficient_data_without_message_gets_default(self):
        status, message = outcome_for_exception(InsufficientDataError())
        self.assertEqual(status, 'waiting_for_data')
        self.assertTrue(message)  # non-empty friendly default

    def test_real_error_stays_failed(self):
        status, message = outcome_for_exception(ValueError('boom'))
        self.assertEqual(status, 'failed')
        self.assertIn('boom', message)

    def test_memory_error_stays_failed(self):
        # A genuinely failed job (state 1) must not be softened to the calm
        # waiting state.
        status, _ = outcome_for_exception(MemoryError('Available memory is too little'))
        self.assertEqual(status, 'failed')


if __name__ == '__main__':
    unittest.main()
