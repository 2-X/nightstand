"""Frozen copy of the RAW-only loader from before the NATS fallback, for behaviour comparisons."""
import gc
import os
from datetime import datetime, timedelta, timezone

import cbor2

from load_raw_files import (_cap_format_name, _cap_values_missing, _capture_presence, _debug_data, _delete_other_side,
                            _feed_presence, _in_window, _normalize_cap_sense2, _read_raw_record, _rename_keys,
                            get_current_files, load_piezo_row, logger)


def _decode_cbor_file(file_path: str, data: dict, start_time, end_time, side, sensor_count: int, presence_collector=None,
                      cap_formats=None):
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
                format_name = _cap_format_name(decoded_data) if cap_formats is not None else None
                presence_capture = _capture_presence(decoded_data) if presence_collector is not None else None
                unknown_kind = None
                if presence_capture is not None and presence_capture[0] == 'unknown':
                    # An unknown type never passes the type filter below.
                    unknown_kind = presence_capture[1]
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
                    # Never loaded, but still what the Pod writes in this window.
                    if (format_name == 'unknown' or unknown_kind is not None) and \
                            _in_window(decoded_data, start_time, end_time):
                        if format_name == 'unknown':
                            cap_formats[format_name] += 1
                        if unknown_kind is not None:
                            try:
                                presence_collector.note_unknown_cap(unknown_kind)
                            except Exception as error:
                                logger.error(error)
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
                if format_name is not None:
                    cap_formats[format_name] += 1

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


def load_raw_files(folder_path: str, start_time: datetime, end_time: datetime, side, sensor_count=2, raw_data_types=None,
                   presence_collector=None, cap_formats=None):
    """The pre-fallback load_raw_files, unchanged apart from type hints and this docstring."""
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
                _decode_cbor_file(file_path, data, start_time, end_time, side, sensor_count, presence_collector, cap_formats)
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
