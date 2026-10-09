"""Optional loopback integration, using locally installed NATS tools only."""
import asyncio
import importlib.util
import os
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import cbor2
from test_stream_helpers import stream, recent_piezo, recent_cap

SUBJECTS = ['raw.log', 'raw.sens.piezo', 'raw.frz.temp', 'raw.sens.capsense', 'raw.frz.health']
BINARY = os.environ.get('NATS_SERVER_BINARY') or shutil.which('nats-server')


@unittest.skipUnless(importlib.util.find_spec('nats') and BINARY and os.path.isfile(BINARY),
                     'nats-py or a local nats-server is unavailable')
class LiveNatsIntegrationTest(unittest.TestCase):
    def setUp(self):
        self.store = tempfile.mkdtemp()
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0))
            port = reservation.getsockname()[1]
        self.url = f'nats://127.0.0.1:{port}'
        self.server = subprocess.Popen([BINARY, '-js', '-a', '127.0.0.1', '-p', str(port), '-sd', self.store],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.addCleanup(shutil.rmtree, self.store, True)
        self.addCleanup(self.server.wait, 5)
        self.addCleanup(self.server.terminate)
        deadline = time.monotonic() + 5
        while True:
            try:
                with socket.create_connection(('127.0.0.1', port), timeout=0.1):
                    break
            except OSError:
                if time.monotonic() >= deadline:
                    self.fail('local nats-server did not start')
                time.sleep(0.05)
        stream._drain_queue(stream.piezo_record_queue)
        self.addCleanup(stream._drain_queue, stream.piezo_record_queue)
        for name, value in (('NATS_URL', self.url), ('_legacy_consumer_checked', False),
                            ('_last_stream_sequence', None), ('_last_stream_message_at', 0.0),
                            ('_last_sensor_record', None)):
            patcher = patch.object(stream, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    async def wait_for(self, check, message):
        deadline = time.monotonic() + 10
        while not await check():
            if time.monotonic() >= deadline:
                self.fail(message)
            await asyncio.sleep(0.02)

    def test_live_reader_explicit_subjects_retention_and_cleanup(self):
        import nats
        from nats.js.api import StreamConfig, RetentionPolicy, ConsumerConfig, AckPolicy, DeliverPolicy

        async def scenario():
            client = await nats.connect(self.url)
            task = None
            try:
                jetstream = client.jetstream()
                await jetstream.add_stream(config=StreamConfig(name='raw', retention=RetentionPolicy.LIMITS,
                                                               subjects=SUBJECTS))
                other = await jetstream.add_consumer('raw', config=ConsumerConfig(
                    durable_name='firmware_reader', ack_policy=AckPolicy.EXPLICIT, deliver_policy=DeliverPolicy.ALL))
                await jetstream.add_consumer('raw', config=ConsumerConfig(
                    durable_name=stream.LEGACY_CONSUMER, ack_policy=AckPolicy.EXPLICIT))
                task = asyncio.create_task(stream._nats_session(Mock(is_alive=Mock(return_value=True))))

                async def ours_only():
                    names = [info.name for info in await jetstream.consumers_info('raw')]
                    return len(names) == 2 and stream.LEGACY_CONSUMER not in names
                await self.wait_for(ours_only, 'live consumer did not replace the earlier one')
                await jetstream.publish('raw.log', cbor2.dumps({'type': 'log', 'ts': time.time()}))
                await jetstream.publish('raw.sens.piezo', cbor2.dumps(recent_piezo(seq=900000)))
                cap = recent_cap()
                await jetstream.publish('raw.sens.capsense', cbor2.dumps({'seq': 2, 'data': cbor2.dumps(cap)}))
                for subject, kind in [('raw.frz.temp', 'frzTemp'), ('raw.frz.health', 'frzHealth')]:
                    await jetstream.publish(subject, cbor2.dumps({'type': kind, 'ts': time.time()}))

                async def all_arrived():
                    return bool(stream.piezo_record_queue.qsize() and temps.call_count
                                and pump.call_count and caps.call_count)
                await self.wait_for(all_arrived, 'not all sensor subjects arrived')
                self.assertEqual(stream.piezo_record_queue.get_nowait()['seq'], 900000)
                received = {key: value for key, value in caps.call_args.args[0].items() if key != '_firmware'}
                self.assertEqual(received, cap)
                self.assertEqual(stream._last_stream_sequence, 5)
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task
                state = (await jetstream.stream_info('raw')).state
                self.assertEqual((state.messages, state.consumer_count), (5, 1))
                self.assertEqual((await jetstream.consumer_info('raw', other.name)).num_pending, 5)

                # A reconnect resumes after the last message instead of replaying the window.
                await jetstream.add_consumer('raw', config=ConsumerConfig(
                    durable_name=stream.LEGACY_CONSUMER, ack_policy=AckPolicy.EXPLICIT))
                task = asyncio.create_task(stream._nats_session(Mock(is_alive=Mock(return_value=True))))
                await jetstream.publish('raw.sens.piezo', cbor2.dumps(recent_piezo()))

                async def resumed():
                    return stream.piezo_record_queue.qsize() == 1 and stream._last_stream_sequence == 6
                await self.wait_for(resumed, 'reconnect did not resume at the next message')
                live = [info for info in await jetstream.consumers_info('raw')
                        if info.name.startswith('nightstand_live_')]
                self.assertEqual([(info.config.deliver_policy, info.config.opt_start_seq) for info in live],
                                 [(DeliverPolicy.BY_START_SEQUENCE, 6)])
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                names = sorted(info.name for info in await jetstream.consumers_info('raw'))
                self.assertEqual(names, sorted([other.name, stream.LEGACY_CONSUMER]))
            finally:
                if task is not None and not task.done():
                    task.cancel()
                    await asyncio.gather(task, return_exceptions=True)
                await client.close()

        with patch.object(stream, 'update_health'), \
                patch.object(stream, 'update_sensor_temps') as temps, \
                patch.object(stream, 'update_pump_health') as pump, \
                patch.object(stream, '_store_decoded_cap_record', wraps=stream._store_decoded_cap_record) as caps:
            asyncio.run(scenario())

    def test_silent_stream_reads_raw_files_and_keeps_listening(self):
        import nats
        from nats.js.api import StreamConfig, RetentionPolicy

        folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, folder, True)
        Path(folder, 'a.RAW').write_bytes(cbor2.dumps({'seq': 1, 'data': cbor2.dumps(recent_piezo(seq=1))}))
        raw_files = stream._RawFiles(folder)
        self.addCleanup(raw_files.close)

        async def scenario():
            client = await nats.connect(self.url)
            task = None
            try:
                jetstream = client.jetstream()
                await jetstream.add_stream(config=StreamConfig(name='raw', retention=RetentionPolicy.LIMITS,
                                                               subjects=SUBJECTS))
                await jetstream.publish('raw.log', cbor2.dumps({'type': 'log', 'ts': time.time()}))
                task = asyncio.create_task(stream._nats_session(Mock(is_alive=Mock(return_value=True)), raw_files))

                async def from_raw():
                    return stream.piezo_record_queue.qsize() == 1
                await self.wait_for(from_raw, 'RAW record was not read while NATS was silent')
                self.assertEqual(stream.piezo_record_queue.get_nowait()['seq'], 1)
                await jetstream.publish('raw.sens.piezo', cbor2.dumps(recent_piezo(seq=2)))

                async def from_nats():
                    return stream.piezo_record_queue.qsize() == 1
                await self.wait_for(from_nats, 'NATS record was not read after silence')
                self.assertEqual(stream.piezo_record_queue.get_nowait()['seq'], 2)
            finally:
                if task is not None and not task.done():
                    task.cancel()
                    await asyncio.gather(task, return_exceptions=True)
                await client.close()

        with patch.object(stream, 'NATS_SILENT_SECONDS', 0.2), patch.object(stream, 'update_health'):
            asyncio.run(scenario())


if __name__ == '__main__':
    unittest.main()
