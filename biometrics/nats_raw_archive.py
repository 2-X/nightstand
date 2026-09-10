"""Preserve NATS sensor/log records in the existing RAW-reader format.

The button monitor tails this archive on newer firmware. Offline analysis also
reads it. No network publishing; files are private and retained for 36 hours.
"""
import os
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path

import cbor2


class RawArchive:
    def __init__(self, directory='/persistent/free-sleep-data/raw-archive'):
        self.directory = Path(directory)
        self.hour = None
        self.last_sequence = 0

    def append(self, payload, sequence, timestamp, now=None):
        now = time.time() if now is None else now
        if type(timestamp) not in (int, float) or not now - 120 <= timestamp <= now + 1:
            return False
        if sequence <= self.last_sequence:
            return False
        hour = datetime.fromtimestamp(timestamp, timezone.utc).strftime('%Y%m%dT%H')
        if hour != self.hour:
            self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
            for old in self.directory.glob('nats-*.RAW'):
                if old.stat().st_mtime < now - 36 * 3600:
                    old.unlink()
            if shutil.disk_usage(self.directory).free < 2 * 1024 ** 3:
                raise OSError('RAW archive paused: less than 2 GiB free')
            self.hour = hour
        path = self.directory / ('nats-' + hour + '.RAW')
        # Insertion order matches the installed byte-accurate RAW parser.
        encoded = cbor2.dumps({'seq': sequence, 'data': payload})
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(descriptor, 'ab') as target:
            target.write(encoded)
        self.last_sequence = sequence
        return True
