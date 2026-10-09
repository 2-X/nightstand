"""Synthetic packed RAW records, using epoch timestamps like existing fixtures."""
import io
import os
import sys

import cbor2
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from raw_decoder import decode_payload, decode_row


def test_bundle_preserves_identity_and_times():
    rows = [{'type': 'log', 'ts': 1, 'msg': 'first'}, {'type': 'frzTherm', 'ts': 2}]
    decoded = list(decode_row({'seq': 17, 'data': b''.join(cbor2.dumps(row) for row in rows)}, 3))
    assert [row['type'] for row in decoded] == ['log', 'frzTherm']
    assert [row['ts'] for row in decoded] == [1, 2]
    assert [row['_firmware'] for row in decoded] == [
        {'sequence': 17, 'index': 0, 'receivedAt': 3}, {'sequence': 17, 'index': 1, 'receivedAt': 3}]


def test_bundle_does_not_silently_drop_records_after_index_1023():
    payload = cbor2.dumps({'type': 'log', 'ts': 1}) * 1025
    decoded = list(decode_payload(payload, 17, 3))
    assert len(decoded) == 1025
    assert decoded[-1]['_firmware']['index'] == 1024


def test_partial_inner_tail_keeps_complete_prefix():
    first = cbor2.dumps({'type': 'log', 'ts': 1})
    tail = cbor2.dumps({'type': 'log', 'ts': 2})[:-1]
    assert len(list(decode_payload(first + tail, 1, 3))) == 1


def test_outer_truncation_can_be_retried(monkeypatch):
    # Import only after quieting the existing loader's logger.
    import logging
    import get_logger
    monkeypatch.setattr(get_logger, '_get_file_handler', lambda *args: logging.NullHandler())
    get_logger.get_logger('free-sleep-stream')
    from load_raw_files import _read_raw_record
    payload = cbor2.dumps({'type': 'log', 'ts': 1}) + cbor2.dumps({'type': 'log', 'ts': 2})
    envelope = cbor2.dumps({'seq': 24, 'data': payload})
    for cut in (7, len(envelope) - 1):
        handle = io.BytesIO(envelope[:cut])
        with pytest.raises(EOFError):
            _read_raw_record(handle, with_sequence=True)
        handle.seek(0)
        handle.write(envelope)
        handle.seek(0)
        assert len(list(decode_row(_read_raw_record(handle, with_sequence=True), 3))) == 2


def test_envelope_inside_a_payload_is_corrupt():
    swallowed = cbor2.dumps({'seq': 2, 'data': cbor2.dumps({'type': 'log', 'ts': 1})})
    payload = cbor2.dumps({'type': 'log', 'ts': 0}) + swallowed
    try:
        list(decode_payload(payload, 1))
    except ValueError:
        return
    raise AssertionError('an envelope inside a payload must be reported as corrupt')


def test_unknown_objects_and_empty_payload():
    payload = cbor2.dumps('unknown') + cbor2.dumps({'type': 'log', 'ts': 1})
    assert list(decode_payload(payload, 2, 3))[0]['_firmware']['index'] == 1
    assert list(decode_row({'seq': 1, 'data': b''}, 3)) == []


def test_malformed_inner_tail_keeps_complete_prefix():
    payload = cbor2.dumps({'type': 'log', 'ts': 1}) + b'\x1c'
    assert len(list(decode_payload(payload, 1, 3))) == 1


@pytest.mark.parametrize('level,target', [(-100, 10), (-71, 18.48), (-60, 19.80), (-49, 21.12),
    (-42, 21.96), (-38, 22.44), (-31, 23.28), (-27, 23.76), (-24, 24.12), (-20, 24.60),
    (-16, 25.08), (-9, 25.92), (2, 27.36), (27, 31.86)])
def test_observed_pair_log_survives_bundle(level, target):
    message = f'set target temp (R: {level}, {target:.2f}C)'
    payload = cbor2.dumps({'type': 'log', 'ts': 1, 'msg': 'initialization'})
    payload += cbor2.dumps({'type': 'log', 'ts': 2, 'msg': message})
    assert list(decode_payload(payload, 1, 3))[1]['msg'] == message
