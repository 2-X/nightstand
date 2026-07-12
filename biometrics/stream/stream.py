"""
This script processes the 8 Sleep Pod's CBOR-encoded biometric data in
real-time.

It consumes the pod firmware's own NATS JetStream ('raw' stream on
localhost), which carries sensor records as they are produced. If NATS is
unavailable (older firmware, nats-py not installed, or the stream is
missing), it falls back to watching /persistent for the latest .RAW file and
tailing it with the byte-accurate CBOR reader.

Key functionalities:
- Pulls records from NATS JetStream with a durable consumer, deduplicated by
  firmware sequence number.
- Fallback: watches the `/persistent` directory for new .RAW files using
  `watchdog`, tracking only the most recently modified file.
- Filters and processes `piezo-dual` sensor data, ensuring only recent
  entries are used; forwards `frzTemp` records as sensor temperatures.
- Loads parsed piezoelectric sensor data into `load_piezo_row` and queues it
  for processing by `StreamProcessor` in a separate thread.
- Handles graceful shutdown via KeyboardInterrupt.

Usage:
This is set up to run as a systemctl service, but you can manually run it with:
/home/dac/venv/bin/python /home/dac/free-sleep/biometrics/stream/stream.py
"""

import sys
import platform
import cbor2
import asyncio
import inspect
from datetime import datetime, timedelta
from collections import deque

if platform.system().lower() == 'linux':
    sys.path.append('/home/dac/free-sleep/biometrics/')
    sys.path.append('/home/dac/free-sleep/biometrics/stream/')

import time
import os
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import queue
import threading

from get_logger import get_logger
logger = get_logger('free-sleep-stream')

from stream_processor import StreamProcessor
from load_raw_files import load_piezo_row, _read_raw_record
from service_health import update_health, update_sensor_temps, update_pump_health

# Global queue for processing decoded biometric data
piezo_record_queue = queue.Queue()

STREAM_HEALTH_INTERVAL_SECONDS = 60
RECENT_RECORD_WINDOW = timedelta(minutes=2)
NATS_URL = 'nats://127.0.0.1:4222'
NATS_STREAM = 'raw'
NATS_DURABLE = 'free_sleep_stream_live'
PROCESSED_SEQUENCE_LIMIT = 5000
processed_sequences = set()
processed_sequence_order = deque(maxlen=PROCESSED_SEQUENCE_LIMIT)


def _safe_getmtime(path: str) -> float:
    try:
        if os.path.exists(path):
            return os.path.getmtime(path)
    except FileNotFoundError:
        logger.warning(f'File path not found, ignoring... {path}')
        pass
    return 0  # Default for missing files


def _mark_sequence_processed(sequence):
    if sequence is None:
        return
    if len(processed_sequence_order) == processed_sequence_order.maxlen:
        oldest = processed_sequence_order.popleft()
        processed_sequences.discard(oldest)
    processed_sequence_order.append(sequence)
    processed_sequences.add(sequence)


def _decode_raw_row(row):
    if not isinstance(row, dict):
        return None

    if row.get('data'):
        return cbor2.loads(row['data'])

    return row


def _queue_decoded_piezo_record(decoded_data) -> bool:
    if not isinstance(decoded_data, dict):
        logger.warning(f'Skipping unexpected nested CBOR value: {type(decoded_data)}')
        return False
    if decoded_data.get('type') != 'piezo-dual':
        return False
    if 'ts' not in decoded_data:
        logger.warning(f'Skipping piezo-dual record without timestamp: {decoded_data.keys()}')
        return False

    record_time = datetime.fromtimestamp(decoded_data['ts'])
    if datetime.now() - record_time > RECENT_RECORD_WINDOW:
        return False

    sequence = decoded_data.get('seq')
    if sequence in processed_sequences:
        return False

    load_piezo_row(decoded_data, 'right')
    piezo_record_queue.put(decoded_data)
    _mark_sequence_processed(sequence)
    return True


class LatestRawFileHandler(FileSystemEventHandler):
    """Monitors only the latest RAW file and processes CBOR-encoded lines separately."""

    def __init__(self, directory):
        self.directory = directory
        self.latest_file = None
        self.latest_file_obj = None
        self.last_pos = 0  # Track last read position
        self.track_latest_file()

    def track_latest_file(self):
        """Finds the most recent RAW file in the directory and starts tracking it."""
        raw_files = [f for f in os.listdir(self.directory) if f.endswith(".RAW") and not f.endswith('SEQNO.RAW')]
        if not raw_files:
            return

        # Get the latest file by modification time
        raw_files.sort(
            key=lambda f: _safe_getmtime(os.path.join(self.directory, f)),
            reverse=True
        )

        latest_file = os.path.join(self.directory, raw_files[0])

        if latest_file != self.latest_file:
            # If a new file is found, stop tracking the old one
            self.latest_file = latest_file
            logger.debug(f"Now tracking: {self.latest_file}")

            # Close old file handle if open
            if self.latest_file_obj:
                self.latest_file_obj.close()

            # Open the new file for reading in binary mode
            self.latest_file_obj = open(self.latest_file, "rb")
            self.last_pos = 0  # Reset position for new file

    def on_created(self, event):
        """Triggered when a new .RAW file is created."""
        if event.is_directory or not event.src_path.endswith(".RAW"):
            return
        self.track_latest_file()

    def follow_latest_file(self):
        """Reads and decodes new CBOR-encoded lines from the latest file."""
        if not self.latest_file_obj:
            return

        # Move to the last known position before reading
        self.latest_file_obj.seek(self.last_pos)

        while True:
            try:
                # Manual reader instead of cbor2.load(), the C extension
                # reads in 4096-byte chunks and skips most records (see
                # _read_raw_record in load_raw_files.py). last_pos advances
                # past every parsed record, including skipped ones, so they
                # aren't re-parsed on the next follow pass.
                data_bytes = _read_raw_record(self.latest_file_obj)
                if data_bytes is None:
                    self.last_pos = self.latest_file_obj.tell()
                    continue  # empty placeholder record

                decoded_data = cbor2.loads(data_bytes)

                # Handle frzTemp records for sensor temperatures
                if isinstance(decoded_data, dict) and decoded_data.get('type') == 'frzTemp':
                    update_sensor_temps(decoded_data)
                    self.last_pos = self.latest_file_obj.tell()
                    continue

                # Handle frzHealth records for pump-stall detection
                if isinstance(decoded_data, dict) and decoded_data.get('type') == 'frzHealth':
                    update_pump_health(decoded_data)
                    self.last_pos = self.latest_file_obj.tell()
                    continue

                # Shared filter/queue path with the NATS consumer, so the
                # sequence dedup also covers a NATS -> fallback transition.
                _queue_decoded_piezo_record(decoded_data)

                # Update last read position
                self.last_pos = self.latest_file_obj.tell()

            except EOFError:
                # Mid-record EOF means a partially written record; last_pos
                # still points at its start, so the next pass retries it once
                # the firmware finishes writing.
                break
            except Exception as e:
                logger.error(f"Error reading record: {e}")
                # Seek back to the last known good position so a transient
                # bad read doesn't cascade.
                self.latest_file_obj.seek(self.last_pos)
                break


def process_biometrics():
    piezo_record = piezo_record_queue.get()
    stream_processor = StreamProcessor(piezo_record, debug=False)
    ix = 0
    while True:
        ix += 1
        if ix == 60:
            update_health('stream', 'healthy')
            ix = 0
        try:
            piezo_record = piezo_record_queue.get(timeout=5)

            if piezo_record is None:
                # Stop if None is received
                break

            stream_processor.process_piezo_record(piezo_record)
            piezo_record_queue.task_done()
        except queue.Empty:
            # Just continue if the queue is empty, do not exit the loop
            logger.info("No new data, retrying...")
        except Exception as error:
            logger.error(error)
            update_health('stream', 'failed', repr(error))


def watch_directory(directory="/persistent"):
    """Monitors the directory for new RAW files and processes only the latest one."""
    logger.info('Stream processor starting...')
    update_health('stream', 'started', '')
    handler = LatestRawFileHandler(directory)
    observer = Observer()
    observer.schedule(handler, directory, recursive=False)
    observer.start()

    # Start biometric processing in a separate thread
    processing_thread = threading.Thread(target=process_biometrics, daemon=True)
    processing_thread.start()

    logger.debug('Stream processor set up successfully, running...')
    try:
        while True:
            time.sleep(1)
            handler.track_latest_file()  # Check if a newer file exists
            handler.follow_latest_file()  # Read new CBOR entries line-by-line
    except KeyboardInterrupt:
        observer.stop()
        piezo_record_queue.put(None)  # Send stop signal to processing thread
        processing_thread.join()
    except Exception as error:
        logger.error(error)
        update_health('stream', 'failed', repr(error))
        raise error

    observer.join()


async def _ack_message(message):
    ack_result = message.ack()
    if inspect.isawaitable(ack_result):
        await ack_result


async def watch_nats_stream():
    try:
        import nats
        from nats.errors import TimeoutError as NatsTimeoutError
        from nats.js.api import AckPolicy, ConsumerConfig, DeliverPolicy
    except ImportError as error:
        raise RuntimeError('nats-py is not installed') from error

    logger.info('NATS stream processor starting...')
    update_health('stream', 'started', '')

    processing_thread = threading.Thread(target=process_biometrics, daemon=True)
    processing_thread.start()

    nc = None
    try:
        nc = await nats.connect(NATS_URL, connect_timeout=5)
        js = nc.jetstream()
        stream_info = await js.stream_info(NATS_STREAM)
        subjects = getattr(stream_info.config, 'subjects', None) or [NATS_STREAM]
        subject = subjects[0]
        logger.info(f'Consuming NATS JetStream stream={NATS_STREAM} subject={subject}')

        consumer_config = ConsumerConfig(
            durable_name=NATS_DURABLE,
            deliver_policy=DeliverPolicy.NEW,
            ack_policy=AckPolicy.EXPLICIT,
        )
        subscription = await js.pull_subscribe(
            subject,
            durable=NATS_DURABLE,
            stream=NATS_STREAM,
            config=consumer_config,
        )
        last_health_update = time.monotonic()
        queued_count = 0

        while True:
            if time.monotonic() - last_health_update >= STREAM_HEALTH_INTERVAL_SECONDS:
                update_health('stream', 'healthy', '')
                last_health_update = time.monotonic()
                logger.debug(f'NATS stream heartbeat; queued piezo records={queued_count}')

            try:
                messages = await subscription.fetch(25, timeout=5)
            except NatsTimeoutError:
                continue

            for message in messages:
                try:
                    row = cbor2.loads(message.data)
                    decoded_data = _decode_raw_row(row)
                    if isinstance(decoded_data, dict) and decoded_data.get('type') == 'frzTemp':
                        update_sensor_temps(decoded_data)
                    elif isinstance(decoded_data, dict) and decoded_data.get('type') == 'frzHealth':
                        update_pump_health(decoded_data)
                    elif _queue_decoded_piezo_record(decoded_data):
                        queued_count += 1
                    await _ack_message(message)
                except Exception as error:
                    logger.warning(f'Error decoding NATS raw message, acknowledging and skipping: {error}')
                    await _ack_message(message)
    finally:
        if nc is not None:
            await nc.close()
        piezo_record_queue.put(None)
        processing_thread.join(timeout=5)


def watch_stream():
    try:
        asyncio.run(watch_nats_stream())
    except Exception as error:
        logger.warning(f'NATS stream unavailable, falling back to RAW file watcher: {error}')
        watch_directory("/persistent")


if __name__ == '__main__':
    # Give time for the express.js server to boot
    print('Sleeping for 30 seconds before starting stream service...')
    time.sleep(30)
    # Start watching and processing live biometrics data.
    watch_stream()
