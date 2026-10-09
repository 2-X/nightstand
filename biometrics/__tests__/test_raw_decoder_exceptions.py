"""Decoder failures do not stop RAW ingestion."""
import os
import sys
import unittest
import unittest.mock
from decimal import InvalidOperation

import cbor2

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from raw_decoder import decode_payload


class DecimalDecodeTest(unittest.TestCase):
    def test_decoder_exception_keeps_complete_prefix(self):
        with unittest.mock.patch('raw_decoder.cbor2.CBORDecoder') as decoder:
            decoder.return_value.decode.side_effect = [{'type': 'log', 'ts': 1}, InvalidOperation()]
            decoded = list(decode_payload(cbor2.dumps({'type': 'log', 'ts': 1}) +
                                          bytes.fromhex('c4 82 1b 7f ff ff ff ff ff ff ff 01')))
        self.assertEqual(len(decoded), 1)
        self.assertEqual(decoded[0]['ts'], 1)

    def test_invalid_decimal_exponent_keeps_only_complete_prefix(self):
        corrupt = bytes.fromhex('c4 82 1b 7f ff ff ff ff ff ff ff 01')
        self.assertEqual(list(decode_payload(corrupt)), [])
        prefix = cbor2.dumps({'type': 'log', 'ts': 1})
        decoded = list(decode_payload(prefix + corrupt, 7, 3))
        self.assertEqual(len(decoded), 1)
        self.assertEqual(decoded[0]['ts'], 1)


if __name__ == '__main__':
    unittest.main()
