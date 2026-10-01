import numpy as np
import struct
import traceback
from datetime import datetime, timedelta, timezone
import cbor2
from pathlib import Path
import gc
import sys
import os

# Add the current directory to sys.path
sys.path.append(os.getcwd())
from data_types import *
from get_logger import get_logger
from presence.detector import piezo_range
from presence.sensors import read_cap, unknown_cap_type

logger = get_logger()


def _read_raw_record(f):
    """
    Manually parse one outer {seq, data} CBOR record using f.read().

    The cbor2 C extension (_cbor2) reads files in internal 4096-byte chunks,
    so cbor2.load(f) advances f.tell() by 4096 bytes regardless of the actual
    record size. RAW file records are typically 17-5000 bytes (Pod 5
    piezo-dual records are ~2700 bytes), so nearly every record gets skipped
    silently and the pipeline sees almost no data.

    This function parses the outer {seq: uint, data: bytes} wrapper
    byte-by-byte with f.read(), keeping f.tell() accurate after each record.

    Returns the raw inner data bytes, or None for empty placeholder records
    (the Pod firmware writes data=b'' records as sequence-number markers).
    Raises EOFError at end of file or on a record cut short, ValueError on malformed data.
    """
    b = f.read(1)
    if not b:
        raise EOFError
    # Skip NUL padding between records, the firmware pads RAW files, and
    # treating each padding byte as a malformed record would log one error
    # per byte while scanning past it.
    while b[0] == 0x00:
        b = f.read(1)
        if not b:
            raise EOFError
    if b[0] != 0xa2:
        raise ValueError('Expected outer map 0xa2, got 0x%02x' % b[0])
    key = f.read(4)
    if len(key) < 4:
        raise EOFError
    if key != b'\x63\x73\x65\x71':  # text(3) "seq"
        raise ValueError('Expected seq key')
    hdr = f.read(1)
    if not hdr:
        raise EOFError
    val = hdr[0]
    if val <= 0x17:
        pass  # tiny uint, value lives in the additional-info bits
    elif val == 0x18:
        if len(f.read(1)) < 1:
            raise EOFError
    elif val == 0x19:
        if len(f.read(2)) < 2:
            raise EOFError
    elif val == 0x1a:
        if len(f.read(4)) < 4:
            raise EOFError
    elif val == 0x1b:
        if len(f.read(8)) < 8:
            raise EOFError
    else:
        raise ValueError('Unexpected seq encoding: 0x%02x' % val)
    key = f.read(5)
    if len(key) < 5:
        raise EOFError
    if key != b'\x64\x64\x61\x74\x61':  # text(4) "data"
        raise ValueError('Expected data key')
    bs = f.read(1)
    if not bs:
        raise EOFError
    ai = bs[0] & 0x1f
    if ai <= 23:
        length = ai
    elif ai == 24:
        lb = f.read(1)
        if not lb:
            raise EOFError
        length = lb[0]
    elif ai == 25:
        lb = f.read(2)
        if len(lb) < 2:
            raise EOFError
        length = struct.unpack('>H', lb)[0]
    elif ai == 26:
        lb = f.read(4)
        if len(lb) < 4:
            raise EOFError
        length = struct.unpack('>I', lb)[0]
    else:
        raise ValueError('Unsupported length encoding: %d' % ai)
    data = f.read(length)
    if len(data) < length:
        raise EOFError
    if not data:
        return None  # empty placeholder record, caller should skip
    return data


def get_current_files(folder_path: str):
    # Scan the live folder where frankenfirmware writes RAW files AND the
    # archive that hardlinks them before frank truncates its rolling buffer
    # (~75 min). Without the archive a daily analyze run sees only the last
    # hour. The archive is raw-archive/ under the data folder
    # (/persistent/free-sleep-data/raw-archive/ on the Pod), filled by
    # scripts/archive-raw.sh on a systemd timer. Both entries point to the
    # same inode until frank deletes its own, so dedupe by filename.
    candidates: dict[str, str] = {}
    archive_path = os.path.join(logger.folder_path, 'raw-archive')
    for folder in (folder_path, archive_path):
        if not folder:
            continue
        try:
            for f in Path(folder).glob('*.RAW'):
                if f.is_file() and f.name != 'SEQNO.RAW' and f.name not in candidates:
                    candidates[f.name] = str(f.resolve())
        except (OSError, FileNotFoundError):
            continue
    # Name order, so the same archive always decodes in the same order.
    return [candidates[name] for name in sorted(candidates)]


def _decode_piezo_data(raw_bytes: bytes) -> np.ndarray:
    return np.frombuffer(raw_bytes, dtype=np.int32)


# Pod 5 writes -1 for a capacitance value it could not read.
NO_CAP_READING = -1


def _cap_values_missing(record: dict) -> dict:
    """Per side, whether any raw capSense2 value is missing."""
    missing = {}
    for side in ('left', 'right'):
        channel = record.get(side)
        missing[side] = isinstance(channel, dict) and NO_CAP_READING in (channel.get('values') or ())
    return missing


def _normalize_cap_sense2(record: dict) -> dict:
    """
    Convert a Pod 5 'capSense2' record to the legacy 'capSense' shape.

    Pod 5 firmware writes each side as {'values': [8 floats], 'status'}
    instead of the older {'out', 'cen', 'in', 'status'}. The 8 values arrive
    as 4 near-identical pairs; the 4th pair sits near zero (reference-like),
    so map the first three pair-means onto out/cen/in. The downstream
    baseline/presence math only needs channels that are consistent between
    calibration and detection and shift under load, it computes z-scores
    against a baseline built from this same mapping, so the exact channel
    semantics don't matter.

    Unrecognized shapes are returned unchanged (still typed 'capSense2') and
    fall out at the type filter instead of crashing the load loop.
    """
    converted = {}
    for side in ('left', 'right'):
        channel = record.get(side)
        if not isinstance(channel, dict):
            return record
        values = channel.get('values')
        if not isinstance(values, (list, tuple)) or len(values) < 6:
            return record
        converted[side] = {
            'out': (values[0] + values[1]) / 2,
            'cen': (values[2] + values[3]) / 2,
            'in': (values[4] + values[5]) / 2,
            'status': channel.get('status', 'good'),
        }
    record.update(converted)
    record['type'] = 'capSense'
    return record


def load_piezo_row(data: dict, side: Side):
    # if side == 'left':
    if 'left1' in data:
        data['left1'] = _decode_piezo_data(data['left1'])
    if 'left2' in data:
        data['left2'] = _decode_piezo_data(data['left2'])
    # else:
    if 'right1' in data:
        data['right1'] = _decode_piezo_data(data['right1'])
    if 'right2' in data:
        data['right2'] = _decode_piezo_data(data['right2'])


def _delete_other_side(decoded_data: dict, side: Side, sensor_count: int):
    """
    Delete other sides data for saving memory space
    """
    try:
        del_side = 'left'
        if side == 'left':
            del_side = 'right'

        if decoded_data['type'] == 'capSense':
            del decoded_data[del_side]
        else:
            if sensor_count == 1:
                # Delete sensor 2 of the current side
                if f'{side}2' in decoded_data:
                    del decoded_data[f'{side}2']
            # Delete opposite side
            del decoded_data[f'{del_side}1']
            if f'{del_side}2' in decoded_data:
                del decoded_data[f'{del_side}2']
    except Exception as error:
        logger.error(error)
        traceback.print_exc()
        print(decoded_data)
        raise error


def _capture_presence(record: dict):
    """Both sides' presence inputs, taken before normalization and _delete_other_side drop them."""
    if record.get('type') == 'piezo-dual':
        return 'piezo', record.get('left1'), record.get('right1')
    reading = read_cap(record)
    if reading is not None:
        if reading.left is not None and reading.right is not None:
            return 'cap', reading.left, reading.right, reading.cap_format.name
        return None
    kind = unknown_cap_type(record)
    return None if kind is None else ('unknown', kind)


def _record_range(raw):
    if raw is None:
        return None
    try:
        return piezo_range(np.frombuffer(raw, dtype=np.int32))
    except (TypeError, ValueError):
        # The dropped side's bytes never reached the loader's decode, so they must not fail the record.
        return None


def _feed_presence(collector, capture, ts: int):
    if capture[0] == 'cap':
        _, left, right, name = capture
        collector.add_cap(ts, left, right)
        collector.note_cap_format(name)
    else:
        _, left, right = capture
        collector.add_piezo(ts, _record_range(left), _record_range(right))


def _decode_cbor_file(file_path: str, data: dict, start_time, end_time, side: Side, sensor_count: int, presence_collector=None):
    # logger.debug(f'Loading cbor data from: {file_path}')
    load_raw_types = list(data.keys())
    checked_timespan = False
    with open(file_path, 'rb') as raw_data:
        while True:
            try:

                # Manual reader instead of cbor2.load(), the C extension
                # reads in 4096-byte chunks and skips most records (see
                # _read_raw_record docstring).
                data_bytes = _read_raw_record(raw_data)
                if data_bytes is None:
                    continue  # empty placeholder record
                decoded_data = cbor2.loads(data_bytes)
                presence_capture = _capture_presence(decoded_data) if presence_collector is not None else None
                if presence_capture is not None and presence_capture[0] == 'unknown':
                    # An unknown type never passes the type filter below.
                    try:
                        presence_collector.note_unknown_cap(presence_capture[1])
                    except Exception as error:
                        logger.error(error)
                    presence_capture = None
                # Pod 5 writes 'capSense2' records; normalize them to the
                # legacy 'capSense' shape before the type filter so Pod 5
                # capacitance data isn't silently dropped.
                if decoded_data.get('type') == 'capSense2':
                    missing = _cap_values_missing(decoded_data)
                    decoded_data = _normalize_cap_sense2(decoded_data)
                    if decoded_data['type'] == 'capSense':
                        # Movement skips these rows; presence and calibration
                        # read only out, cen and in.
                        for cap_side, value in missing.items():
                            decoded_data[cap_side]['no_reading'] = value
                if not decoded_data['type'] in load_raw_types:
                    continue
                _delete_other_side(decoded_data, side, sensor_count)
                record_time = datetime.fromtimestamp(decoded_data['ts'], timezone.utc)
                if not checked_timespan:
                    timestamp_start = record_time
                    timestamp_end = timestamp_start + timedelta(minutes=15)
                    if start_time <= timestamp_start <= end_time:
                        checked_timespan = True
                    else:
                        if start_time <= timestamp_end <= end_time:
                            checked_timespan = True
                        else:
                            raw_data.close()
                            return

                # A file spans ~15 minutes and can straddle either window edge.
                if not start_time <= record_time <= end_time:
                    continue

                if decoded_data['type'] == 'piezo-dual':
                    load_piezo_row(decoded_data, side)

                decoded_data['ts'] = record_time.strftime("%Y-%m-%d %H:%M:%S")
                data[decoded_data['type']].append(decoded_data)

                if presence_capture is not None:
                    try:
                        _feed_presence(presence_collector, presence_capture, int(record_time.timestamp()))
                    except Exception as error:
                        logger.error(error)

            except EOFError:
                break
            except Exception as error:
                logger.error(error)
        raw_data.close()
        gc.collect()
    return data


def _rename_keys(data: dict):
    key_mapping = {
        'log': 'logs',
        'piezo-dual': 'piezo_dual',
        'capSense': 'cap_senses',
        'frzTemp': 'freeze_temps',
        'bedTemp': 'bed_temps',
    }
    for old_key, new_key in key_mapping.items():
        if old_key in data:
            data[new_key] = data.pop(old_key)


def _debug_data(data: dict):
    for key in data:
        if isinstance(data[key], list) and len(data[key]) > 0:
            logger.info(f'{key} - {data[key][0]}')
        elif not isinstance(data[key], list):
            logger.warning(f'Unexpected type for loading raw file {type(data[key])}')


def load_raw_files(folder_path: str, start_time: datetime, end_time: datetime, side: Side, sensor_count=2, raw_data_types: List[RawDataTypes] = None,
                   presence_collector=None):
    """Decode the RAW records in [start_time, end_time] for one side.

    presence_collector, when given, also receives both sides' capacitance
    channels (any format presence.sensors reads) and per-record piezo ranges
    (see presence.replay.FrameCollector).
    It sees only the types listed in raw_data_types, so a caller that feeds
    one lists both 'capSense' and 'piezo-dual'.
    """
    try:
        data = {}
        if raw_data_types is None:
            raw_data_types = ['bedTemp', 'capSense', 'frzTemp', 'log', 'piezo-dual']

        for field in raw_data_types:
            data[field] = []
        logger.info(f'Loading RAW files from {folder_path} | {start_time.isoformat()} -> {end_time.isoformat()}')

        file_paths = get_current_files(folder_path)

        if len(file_paths) == 0:
            logger.error('No file paths detected!')
            raise FileNotFoundError(f'No files found for: {folder_path}! Is internet blocked?')

        for file_path in file_paths:
            if os.path.isfile(file_path):
                _decode_cbor_file(file_path, data, start_time, end_time, side, sensor_count, presence_collector)
            else:
                logger.warning(f'File path deleted before parsed! {file_path}')

        _rename_keys(data)
        data_found = False
        for key in data.keys():
            if len(data[key]) > 0:
                data_found = True
            logger.debug(f"{key} - Rows found: {len(data[key])}")

        if not data_found:
            logger.warning('No data found! Mattress topper may be disconnected!')
        gc.collect()
        _debug_data(data)

        return data
    except Exception as error:
        logger.error(error)
        _debug_data(data)

        raise error
