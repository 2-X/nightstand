"""Insufficient-data classification for data-dependent biometrics jobs.

Kept deliberately import-light (standard library only) so it can be imported
from the pod's job scripts and unit-tested anywhere, including the local Mac
python that has no numpy/pandas.

On a fresh install, or shortly after biometrics is enabled, the sensor RAW
archive has not accumulated a full night yet. Jobs like calibration and sleep
analysis run on schedule, find nothing to work with, and raise. That is not a
failure: it resolves on its own once the archive fills. Represent it as its own
job outcome (`waiting_for_data`) rather than reusing `failed`, so the Status
page can show a calm "collecting data" state instead of "needs attention".
"""

# The job status reported for the insufficient-data case. Must match the
# `Status` enum in server/src/routes/serverStatus/serverStatusSchema.ts.
WAITING_FOR_DATA = 'waiting_for_data'

_DEFAULT_WAITING_MESSAGE = (
    'Waiting for enough sensor data. This runs automatically once your first '
    'nights have been recorded.'
)


class InsufficientDataError(Exception):
    """Raised by a data-dependent job when there is not yet enough archived
    RAW/sleep data to produce a result (fresh install, or biometrics recently
    enabled). Distinct from a real failure: callers report it as
    `waiting_for_data`, not `failed`.
    """


def outcome_for_exception(error: BaseException) -> "tuple[str, str]":
    """Map a job exception to the (status, message) to report via update_health.

    Insufficient-data conditions become the calm `waiting_for_data` state; every
    other exception stays a `failed` outcome with its repr, unchanged from the
    previous behavior.
    """
    if isinstance(error, InsufficientDataError):
        return WAITING_FOR_DATA, str(error) or _DEFAULT_WAITING_MESSAGE
    return 'failed', repr(error)
