"""Tests for the manual CBOR raw record parser (Pod 5 record-skipping fix).

`_read_raw_record` manually parses the outer ``{seq, data}`` CBOR wrapper
byte-by-byte to avoid the buffering behaviour of cbor2's C extension, which
reads files in 4096-byte chunks and silently skips most records.

Adapted from throwaway31265/free-sleep PRs #46 (seanpasino) and #50
(alexuser); this fork keeps a single copy of the parser in
``load_raw_files.py`` and imports it from ``stream.py``.

Run locally (needs cbor2, numpy, pytest, not part of the node CI):
    python3 -m pytest biometrics/__tests__/test_raw_record_parser.py -v

Key areas tested:
1. Normal records with varying ``data`` sizes (boundary, large, sequential)
2. Empty placeholder records (data=b'') returning None
3. Malformed / unexpected bytes -- should raise ValueError early
4. Truncated data -- should raise EOFError instead of silently
   producing corrupt bytes
5. Sequential reading correctness -- file offset advances exactly by the
   CBOR record length
"""
import pytest
from io import BytesIO

import cbor2
import numpy as np

# Make the biometrics modules importable when running from the repo root
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

# Prevent the logger from creating log folders on the test machine when
# modules call get_logger() at import time.
import logging
import get_logger as _gl

_gl._get_file_handler = lambda data_folder_path, name: logging.NullHandler()

# Set up a default logger so get_logger() works during module import
from get_logger import get_logger
get_logger('sleep-analyzer')

from load_raw_files import (
    _read_raw_record,
    _decode_piezo_data,
    load_piezo_row,
    _delete_other_side,
)


# ---------------------------------------------------------------------------
# Helpers to build minimal valid outer records
# ---------------------------------------------------------------------------

def outer_record(seq: int, data: bytes) -> bytes:
    """Build the *binary* outer ``{seq: uint, data: bytes}`` record that
    cbor2 would emit for a dict with that key/value pair."""
    return cbor2.dumps({"seq": seq, "data": data})


# ---------------------------------------------------------------------------
# 1. Normal records
# ---------------------------------------------------------------------------

class TestNormalRecords:
    def test_simple_record(self):
        inner = {"type": "piezo-dual", "ts": 42.0, "left1": b"\x00\x01"}
        raw = outer_record(seq=1, data=cbor2.dumps(inner))
        handle = BytesIO(raw)
        result = _read_raw_record(handle)
        out = cbor2.loads(result)
        assert out == inner
        assert handle.tell() == len(raw)

    def test_larger_than_4k(self):
        """Record > 4k ensures we are not relying on 4k buffer alignment."""
        payload = {"type": "piezo-dual", "value": "x" * 5000}
        raw = outer_record(seq=99, data=cbor2.dumps(payload))
        handle = BytesIO(raw)
        result = _read_raw_record(handle)
        out = cbor2.loads(result)
        assert out["value"] == payload["value"]
        assert handle.tell() == len(raw)

    def test_exact_boundary_4096(self):
        """Record size exactly 4096 bytes (the buggy chunk size)."""
        inner = {"pad": "y" * 4074}
        raw = outer_record(seq=1, data=cbor2.dumps(inner))
        assert len(raw) == 4096
        handle = BytesIO(raw)
        result = _read_raw_record(handle)
        out = cbor2.loads(result)
        assert "pad" in out
        assert handle.tell() == len(raw)

    def test_two_records_sequential(self):
        """Two records in a single stream: both should parse and file offset
        must land correctly after the second one."""
        inner1 = {"ts": 1.0}
        inner2 = {"ts": 2.0}
        raw = outer_record(1, cbor2.dumps(inner1)) + outer_record(2, cbor2.dumps(inner2))
        handle = BytesIO(raw)

        r1 = _read_raw_record(handle)
        pos_after_1 = handle.tell()

        r2 = _read_raw_record(handle)
        pos_after_2 = handle.tell()

        assert cbor2.loads(r1) == inner1
        assert cbor2.loads(r2) == inner2
        assert pos_after_2 == len(raw)
        assert pos_after_1 < pos_after_2

    def test_wide_seq_encodings(self):
        """Seq numbers that force 1/2/4/8-byte uint encodings all parse.
        Real files roll seq far past the tiny-uint range."""
        inner = {"ts": 1.0}
        for seq in (0x18, 0x1234, 0x12345678, 0x123456789A):
            raw = outer_record(seq, cbor2.dumps(inner))
            handle = BytesIO(raw)
            result = _read_raw_record(handle)
            assert cbor2.loads(result) == inner
            assert handle.tell() == len(raw)


# ---------------------------------------------------------------------------
# 2. Placeholder records
# ---------------------------------------------------------------------------

class TestPlaceholderRecords:
    def test_standard_empty_placeholder(self):
        """Empty placeholder with standard CBOR ``bytes(0)`` representation."""
        raw = outer_record(seq=5, data=b"")
        handle = BytesIO(raw)
        result = _read_raw_record(handle)
        assert result is None

    def test_placeholder_followed_by_real(self):
        """Placeholder then real record: real record must still be readable."""
        inner = {"ts": 3.0}
        placeholder = outer_record(seq=0, data=b"")
        real = outer_record(seq=1, data=cbor2.dumps(inner))
        raw = placeholder + real
        handle = BytesIO(raw)
        _read_raw_record(handle)          # placeholder -> None
        result = _read_raw_record(handle)  # real record
        assert cbor2.loads(result) == inner
        assert handle.tell() == len(raw)

    def test_nul_padding_between_records(self):
        """NUL padding bytes between records are skipped silently."""
        inner1 = {"ts": 1.0}
        inner2 = {"ts": 2.0}
        raw = (
            outer_record(1, cbor2.dumps(inner1))
            + b"\x00" * 64
            + outer_record(2, cbor2.dumps(inner2))
        )
        handle = BytesIO(raw)
        assert cbor2.loads(_read_raw_record(handle)) == inner1
        assert cbor2.loads(_read_raw_record(handle)) == inner2
        assert handle.tell() == len(raw)

    def test_trailing_nul_padding_raises_eof(self):
        """A file ending in NUL padding raises EOFError, not ValueError."""
        raw = outer_record(1, cbor2.dumps({"ts": 1.0})) + b"\x00" * 32
        handle = BytesIO(raw)
        _read_raw_record(handle)
        with pytest.raises(EOFError):
            _read_raw_record(handle)


# ---------------------------------------------------------------------------
# 3. Truncated / malformed input
# ---------------------------------------------------------------------------

class TestMalformedInput:
    def test_bad_first_byte(self):
        """Anything other than ``0xa2`` (CBOR map of 2 items) or NUL padding
        is an immediate error."""
        handle = BytesIO(b"\x01")
        with pytest.raises(ValueError, match="0x01"):
            _read_raw_record(handle)

    def test_truncated_after_map_header(self):
        handle = BytesIO(b"\xa2\x63seq")
        with pytest.raises(EOFError):
            _read_raw_record(handle)

    def test_truncated_data_length(self):
        """Data length says 10 bytes but only 5 are present."""
        head = b'\xa2\x63seq\x18\x01\x64data'
        # uint8 length = 10, only 5 bytes follow
        raw = head + b'\x18\x0a' + b'\x00' * 5
        handle = BytesIO(raw)
        with pytest.raises(EOFError):
            _read_raw_record(handle)

    def test_garbage_data_key(self):
        """Wrong key after seq."""
        raw = b'\xa2\x63seq\x18\x01\x64foo\x40'
        handle = BytesIO(raw)
        with pytest.raises(ValueError, match="data key"):
            _read_raw_record(handle)

    def test_unsupported_length_ai(self):
        """CBOR major type 2 with additional info 27 (8-byte length) is not
        supported. Parser must raise ValueError, not crash."""
        # map(2), "seq", 1-byte uint, "data", bytes with 8-byte length header
        raw = b'\xa2\x63seq\x18\x01\x64data\x5b' + b'\x00' * 8
        handle = BytesIO(raw)
        with pytest.raises(ValueError, match="Unsupported length"):
            _read_raw_record(handle)


# ---------------------------------------------------------------------------
# 4. EOF propagation
# ---------------------------------------------------------------------------

class TestEOFPropagation:
    def test_empty_stream(self):
        handle = BytesIO(b"")
        with pytest.raises(EOFError):
            _read_raw_record(handle)

    def test_partial_header_eof(self):
        """Stream ends after the first byte which is ``0xa2``."""
        handle = BytesIO(b"\xa2")
        with pytest.raises(ValueError, match="Expected seq key"):
            _read_raw_record(handle)

    def test_eof_after_seq(self):
        handle = BytesIO(b'\xa2\x63seq\x18\x01\x64data')
        with pytest.raises(EOFError):
            _read_raw_record(handle)


# ---------------------------------------------------------------------------
# 5. Existing helpers still work
# ---------------------------------------------------------------------------

class TestExistingHelpers:
    def test_decode_piezo_data(self):
        raw = np.array([1, 2, 3], dtype=np.int32).tobytes()
        arr = _decode_piezo_data(raw)
        np.testing.assert_array_equal(arr, [1, 2, 3])

    def test_load_piezo_row(self):
        payload = {
            "type": "piezo-dual",
            "left1": np.array([1, 2], dtype=np.int32).tobytes(),
            "right1": np.array([3, 4], dtype=np.int32).tobytes(),
        }
        load_piezo_row(payload, "left")
        assert isinstance(payload["left1"], np.ndarray)
        np.testing.assert_array_equal(payload["left1"], [1, 2])

    def test_delete_other_side(self):
        payload = {
            "type": "piezo-dual",
            "left1": 1,
            "left2": 2,
            "right1": 3,
            "right2": 4,
        }
        _delete_other_side(payload, "left", sensor_count=2)
        assert "right1" not in payload
        assert "right2" not in payload
        assert "left1" in payload
        assert "left2" in payload


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
