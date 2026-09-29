"""Let normal Python cleanup run when systemd stops the streamer."""
import signal


def _terminate(_signum, _frame):
    # SystemExit runs db.py's atexit checkpoint and connection close. The
    # default SIGTERM action skips atexit and can leave committed rows in WAL.
    raise SystemExit(0)


def install_shutdown_handlers():
    signal.signal(signal.SIGTERM, _terminate)
