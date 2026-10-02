"""With the new estimators off, the stream writes exactly the rows it always has."""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))

import migrated_db
import stream_fixture

GOLDEN = os.path.join(os.path.dirname(__file__), 'fixtures', 'legacy_stream_vitals.json')


class LegacyStreamOutputTest(unittest.TestCase):
    def test_rows_match_the_recorded_output(self):
        db_module = stream_fixture.run_stream(migrated_db.load_db_module('db_for_legacy_stream'))
        with open(GOLDEN) as handle:
            expected = handle.read()
        self.assertEqual(json.dumps(stream_fixture.legacy_rows(db_module)) + '\n', expected)


if __name__ == '__main__':
    unittest.main()
