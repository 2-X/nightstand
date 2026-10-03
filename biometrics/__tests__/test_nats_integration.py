"""JetStream history against the real nats-py client and, when present, a local nats-server.

Skipped without nats-py. The server tests also need a nats-server binary on
PATH or in NATS_SERVER; the server listens on 127.0.0.1 only.
"""
import asyncio
import importlib.util
import logging
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from collections import Counter
from datetime import datetime, timedelta, timezone

import cbor2
import numpy as np

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, '..'))
sys.path.insert(0, HERE)
import get_logger as gl

gl._get_file_handler = lambda *args: logging.NullHandler()
for name in gl.LOGGER_NAMES:
    gl.get_logger(name)

import load_raw_files as loader
import nats_source
import presence_scenarios as scenarios

try:
    HAS_NATS = importlib.util.find_spec('nats') is not None
except (ImportError, ValueError):
    HAS_NATS = False
NATS_SERVER = os.environ.get('NATS_SERVER') or shutil.which('nats-server')
SUBJECTS = {'piezo-dual': 'raw.sens.piezo', 'capSense2': 'raw.sens.capsense'}
TYPES = ['capSense', 'piezo-dual']


def free_port():
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        return probe.getsockname()[1]


class NatsCase(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.folder, True)
        self.saved = (loader.logger.folder_path, nats_source.NATS_URL)
        loader.logger.folder_path = self.folder
        self.addCleanup(self.restore)

    def restore(self):
        loader.logger.folder_path, nats_source.NATS_URL = self.saved

    def use_port(self, port):
        nats_source.NATS_URL = f'nats://127.0.0.1:{port}'

    def load(self, start, end):
        return loader.load_raw_files(self.folder, start, end, 'left', sensor_count=1, raw_data_types=TYPES)


@unittest.skipUnless(HAS_NATS, 'nats-py is not installed')
class NoServerTest(NatsCase):
    def test_closed_port_fails_fast_naming_both_sources(self):
        self.use_port(free_port())
        now = datetime.now(timezone.utc)
        started = time.monotonic()
        with self.assertRaisesRegex(FileNotFoundError, 'RAW.*NATS'):
            self.load(now - timedelta(hours=25), now)
        self.assertLess(time.monotonic() - started, 1.0)

    def test_silent_server_fails_within_the_setup_bound(self):
        listener = socket.socket()
        listener.bind(('127.0.0.1', 0))
        listener.listen(4)
        self.addCleanup(listener.close)
        accepted = []
        threading.Thread(target=lambda: accepted.append(listener.accept()), daemon=True).start()
        self.use_port(listener.getsockname()[1])
        now = datetime.now(timezone.utc)
        started = time.monotonic()
        with self.assertRaisesRegex(FileNotFoundError, 'RAW.*NATS'):
            self.load(now - timedelta(hours=25), now)
        self.assertLess(time.monotonic() - started, nats_source.SETUP_TIMEOUT + 1.0)
        self.assertTrue(accepted)

    def test_raw_files_with_empty_window_wait_instead_of_failing(self):
        self.use_port(free_port())
        scenarios.write_raw_file(os.path.join(self.folder, 'old.RAW'), scenarios.raw_records(
            scenarios.Night(seconds=3), t0=scenarios.T0 - 3600))
        start = datetime.fromtimestamp(scenarios.T0, timezone.utc)
        started = time.monotonic()
        self.assertEqual(self.load(start, start + timedelta(hours=1)), {'cap_senses': [], 'piezo_dual': []})
        self.assertLess(time.monotonic() - started, 1.0)


async def _call(port, work):
    import nats
    connection = await nats.connect(f'nats://127.0.0.1:{port}', allow_reconnect=False, max_reconnect_attempts=1,
                                    reconnect_time_wait=0, connect_timeout=2)
    try:
        return await work(connection)
    finally:
        await connection.close()


def run(port, work):
    return asyncio.new_event_loop().run_until_complete(_call(port, work))


@unittest.skipUnless(HAS_NATS and NATS_SERVER, 'nats-py or nats-server is not available')
class ServerTest(NatsCase):
    @classmethod
    def setUpClass(cls):
        cls.store = tempfile.mkdtemp()
        cls.port = free_port()
        cls.server = subprocess.Popen([NATS_SERVER, '-js', '-a', '127.0.0.1', '-p', str(cls.port), '-sd', cls.store],
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.monotonic() + 10
        while True:
            try:
                socket.create_connection(('127.0.0.1', cls.port), timeout=0.2).close()
                break
            except OSError:
                if time.monotonic() > deadline or cls.server.poll() is not None:
                    cls.tearDownClass()
                    raise
                time.sleep(0.05)

    @classmethod
    def tearDownClass(cls):
        cls.server.terminate()
        try:
            cls.server.wait(10)
        except subprocess.TimeoutExpired:
            cls.server.kill()
            cls.server.wait()
        shutil.rmtree(cls.store, True)

    def setUp(self):
        super().setUp()
        self.use_port(self.port)
        # The fixture night, shifted to end now, as the firmware would publish it.
        self.t0 = int(time.time()) - 600
        self.night = scenarios.Night(seconds=600, left=((100, 600),), right=((200, 600),))
        self.records = list(scenarios.raw_records(self.night, t0=self.t0))
        self.start = datetime.fromtimestamp(self.t0, timezone.utc)
        self.end = self.start + timedelta(seconds=599)
        run(self.port, self.publish)

    async def publish(self, connection):
        from nats.js.api import AckPolicy, ConsumerConfig, RetentionPolicy, StreamConfig
        js = connection.jetstream(timeout=5)
        try:
            await js.delete_stream('raw')
        except Exception:
            pass
        await js.add_stream(StreamConfig(name='raw', subjects=['raw.>'], retention=RetentionPolicy.LIMITS,
                                         max_age=86400))
        await js.add_consumer('raw', ConsumerConfig(durable_name='firmware', ack_policy=AckPolicy.EXPLICIT))
        for seq, record in enumerate(self.records):
            await connection.publish(SUBJECTS.get(record['type'], 'raw.log'),
                                     cbor2.dumps({'seq': seq, 'data': cbor2.dumps(record)}))
        await connection.flush()
        for _ in range(100):
            if (await js.stream_info('raw')).state.messages == len(self.records):
                break
            await asyncio.sleep(0.05)
        self.before = await self.snapshot(connection)

    async def snapshot(self, connection):
        js = connection.jetstream(timeout=5)
        info = await js.stream_info('raw')
        firmware = await js.consumer_info('raw', 'firmware')
        names = [consumer.name for consumer in await js.consumers_info('raw')]
        return {'config': info.config.as_dict(), 'messages': info.state.messages, 'last_seq': info.state.last_seq,
                'consumers': sorted(names), 'firmware_config': firmware.config.as_dict(),
                'firmware_pending': firmware.num_pending, 'firmware_ack_floor': firmware.ack_floor.stream_seq,
                'firmware_delivered': firmware.delivered.stream_seq}

    def assert_untouched(self):
        after = run(self.port, self.snapshot)
        self.assertEqual(after, self.before)
        self.assertEqual(after['consumers'], ['firmware'])
        stored = [name for _, dirs, _ in os.walk(self.store) for name in dirs if name.startswith('nightstand_window_')]
        self.assertEqual(stored, [])

    def test_published_window_matches_raw_path(self):
        raw_folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, raw_folder, True)
        scenarios.write_raw_file(os.path.join(raw_folder, 'night.RAW'), self.records)
        raw_formats, nats_formats = Counter(), Counter()
        raw = loader.load_raw_files(raw_folder, self.start, self.end, 'left', sensor_count=1, raw_data_types=TYPES,
                                    cap_formats=raw_formats)
        loaded = loader.load_raw_files(self.folder, self.start, self.end, 'left', sensor_count=1,
                                       raw_data_types=TYPES, cap_formats=nats_formats)
        self.assertEqual(loaded['cap_senses'], raw['cap_senses'])
        self.assertEqual(len(loaded['piezo_dual']), 600)
        self.assertEqual(len(loaded['piezo_dual']), len(raw['piezo_dual']))
        for actual, expected in zip(loaded['piezo_dual'], raw['piezo_dual']):
            np.testing.assert_array_equal(actual.pop('left1'), expected.pop('left1'))
            self.assertEqual(actual, expected)
        self.assertEqual(nats_formats, raw_formats)
        self.assert_untouched()

    def test_consumer_is_in_memory_during_the_read_and_removed_early(self):
        records = nats_source.iter_window_records(self.start, self.end)
        next(records)

        async def ours(connection):
            consumers = await connection.jetstream(timeout=5).consumers_info('raw')
            return [consumer for consumer in consumers if consumer.name != 'firmware']

        during = run(self.port, ours)
        self.assertEqual(len(during), 1)
        self.assertTrue(during[0].name.startswith('nightstand_window_'))
        self.assertTrue(during[0].config.mem_storage)
        self.assertEqual(during[0].config.ack_policy, 'none')
        records.close()
        self.assert_untouched()

    def test_message_limit_fails_and_cleans_up(self):
        limits = nats_source.WindowLimits(seconds=60, messages=100, kept_records=10**9, kept_bytes=10**12)
        with self.assertRaisesRegex(RuntimeError, 'message limit'):
            list(nats_source.iter_window_records(self.start, self.end, limits))
        self.assert_untouched()

    def test_kept_limit_fails_and_cleans_up(self):
        limits = nats_source.WindowLimits(seconds=60, messages=10**6, kept_records=10**9, kept_bytes=100_000)
        saved = nats_source.window_limits
        nats_source.window_limits = lambda *args: limits
        self.addCleanup(setattr, nats_source, 'window_limits', saved)
        with self.assertRaisesRegex(RuntimeError, 'kept more than'):
            self.load(self.start, self.end)
        self.assert_untouched()


if __name__ == '__main__':
    unittest.main()
