"""An empty archive is a waiting state, not a dataframe column failure."""
import logging
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import get_logger as gl

gl._get_file_handler = lambda *args: logging.NullHandler()
for name in gl.LOGGER_NAMES:
    gl.get_logger(name)

from piezo_data import load_piezo_df
from insufficient_data import InsufficientDataError, outcome_for_exception


class EmptyPiezoTest(unittest.TestCase):
    def test_empty_archive_is_waiting_for_data(self):
        with self.assertRaises(InsufficientDataError) as raised:
            load_piezo_df({'piezo_dual': []}, 'left')
        self.assertEqual(outcome_for_exception(raised.exception)[0], 'waiting_for_data')
