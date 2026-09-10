import ast
import io
import os
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import cbor2

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from nats_raw_archive import RawArchive


class ArchiveTests(unittest.TestCase):
    def test_existing_raw_reader_can_read_archived_button_and_pump_records(self):
        tree = ast.parse((Path(__file__).resolve().parents[1] / 'load_raw_files.py').read_text())
        reader = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == '_read_raw_record')
        scope = {'struct': struct}
        exec(compile(ast.Module(body=[reader], type_ignores=[]), 'reader', 'exec'), scope)
        with tempfile.TemporaryDirectory() as folder:
            archive = RawArchive(folder)
            records = [{'type': 'log', 'ts': 1789080000, 'msg': '[test] button'},
                       {'type': 'frzHealth', 'ts': 1789080000, 'left': {'pump': {'rpm': 1900, 'water': True}}}]
            for seq, record in enumerate(records, 1):
                self.assertTrue(archive.append(cbor2.dumps(record), seq, record['ts'], now=1789080001))
            self.assertFalse(archive.append(b'ignored', 2, 1789080000, now=1789080001))
            path = next(Path(folder).glob('*.RAW'))
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with path.open('rb') as source:
                self.assertEqual([cbor2.loads(scope['_read_raw_record'](source)) for _ in records], records)
            self.assertFalse(archive.append(b'stale', 3, 100, now=1789080001))

    def test_low_disk_space_stops_archiving(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch('nats_raw_archive.shutil.disk_usage') as usage:
                usage.return_value.free = 1024
                with self.assertRaises(OSError):
                    RawArchive(folder).append(b'x', 1, 1789080000, now=1789080001)
                self.assertEqual(list(Path(folder).glob('*.RAW')), [])


if __name__ == '__main__':
    unittest.main()
