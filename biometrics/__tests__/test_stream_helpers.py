"""Tests for the stream service's record filtering and dedup helpers.

These cover the pure logic shared by the NATS JetStream consumer and the
RAW-file fallback watcher: outer-row decoding, the piezo queueing filter
(type/timestamp/recency checks), and the bounded sequence-dedup ring.

Run locally (needs cbor2, numpy, watchdog, pytest, not part of the node CI):
    python3 -m pytest biometrics/__tests__/test_stream_helpers.py -v
"""
from datetime import datetime, timedelta

import cbor2
import pytest

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'stream'))

import logging
import tempfile
import get_logger as _gl

_gl._get_file_handler = lambda data_folder_path, name: logging.NullHandler()

from get_logger import get_logger, LOGGER_NAMES

# db.py derives its SQLite path from the folder_path of whichever logger a
# nameless get_logger() finds first, which points at a developer-machine path
# locally, give every logger a writable temp dir instead. Other test modules
# in the same pytest run may already have created some of them.
_tmp_folder = tempfile.mkdtemp() + '/'
for _name in LOGGER_NAMES:
    get_logger(_name).folder_path = _tmp_folder

import stream


@pytest.fixture(autouse=True)
def reset_stream_state():
    stream.processed_sequences.clear()
    stream.processed_sequence_order.clear()
    while not stream.piezo_record_queue.empty():
        stream.piezo_record_queue.get_nowait()
    yield


def recent_piezo(seq=None, ts=None):
    record = {
        'type': 'piezo-dual',
        'ts': ts if ts is not None else datetime.now().timestamp(),
        'right1': b'\x01\x00\x00\x00',
    }
    if seq is not None:
        record['seq'] = seq
    return record


class TestDecodeRawRow:
    def test_unwraps_nested_data(self):
        inner = {'type': 'piezo-dual', 'ts': 1.0}
        row = {'seq': 1, 'data': cbor2.dumps(inner)}
        assert stream._decode_raw_row(row) == inner

    def test_passes_through_direct_records(self):
        row = {'type': 'piezo-dual', 'ts': 1.0}
        assert stream._decode_raw_row(row) == row

    def test_rejects_non_dict(self):
        assert stream._decode_raw_row([1, 2]) is None
        assert stream._decode_raw_row(None) is None


class TestQueueDecodedPiezoRecord:
    def test_queues_recent_piezo_record(self):
        assert stream._queue_decoded_piezo_record(recent_piezo(seq=1)) is True
        assert stream.piezo_record_queue.qsize() == 1

    def test_skips_wrong_type(self):
        assert stream._queue_decoded_piezo_record({'type': 'frzTemp', 'ts': 0}) is False

    def test_skips_missing_timestamp(self):
        assert stream._queue_decoded_piezo_record({'type': 'piezo-dual'}) is False

    def test_skips_stale_records(self):
        stale_ts = (datetime.now() - timedelta(minutes=10)).timestamp()
        assert stream._queue_decoded_piezo_record(recent_piezo(ts=stale_ts)) is False

    def test_deduplicates_by_sequence(self):
        assert stream._queue_decoded_piezo_record(recent_piezo(seq=7)) is True
        assert stream._queue_decoded_piezo_record(recent_piezo(seq=7)) is False
        assert stream.piezo_record_queue.qsize() == 1

    def test_records_without_sequence_are_not_deduplicated(self):
        assert stream._queue_decoded_piezo_record(recent_piezo()) is True
        assert stream._queue_decoded_piezo_record(recent_piezo()) is True


class TestSequenceRing:
    def test_ring_evicts_oldest(self):
        limit = stream.PROCESSED_SEQUENCE_LIMIT
        for seq in range(limit + 10):
            stream._mark_sequence_processed(seq)
        assert len(stream.processed_sequences) == limit
        assert 0 not in stream.processed_sequences
        assert limit + 9 in stream.processed_sequences


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
