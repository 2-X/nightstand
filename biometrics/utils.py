import argparse
import numpy as np
from datetime import datetime



def validate_datetime_utc(date_str):
    """
    Validate and parse datetime input as UTC.
    Accepts ISO 8601 format (e.g., '2025-02-04T04:00:00Z' or '2025-02-04T04:00:00.000Z')
    """
    try:
        # Handle both cases with and without microseconds
        # return datetime.fromisoformat(date_str.replace('Z', '+00:00')).astimezone(timezone.utc)
        return datetime.fromisoformat(date_str.replace('Z', '+00:00')).replace(tzinfo=None)
    except ValueError:
        raise argparse.ArgumentTypeError(
            f"Invalid datetime format: '{date_str}'. Use ISO 8601 format like 'YYYY-MM-DDTHH:MM:SSZ'."
        )


def serialize_numpy(obj):
    """Converts NumPy objects to standard Python types for JSON serialization, limiting lists to 10 items."""
    if isinstance(obj, (np.ndarray, ma.MaskedArray)):
        return obj.tolist()[:10]  # Convert arrays and masked arrays to lists and truncate
    elif isinstance(obj, (np.int64, np.int32)):
        return int(obj)  # Convert NumPy integers to Python int
    elif isinstance(obj, (np.float64, np.float32)):
        return float(obj)  # Convert NumPy floats to Python float
    elif isinstance(obj, dict):
        return {key: serialize_numpy(value) for key, value in obj.items()}  # Recursively convert dicts
    elif isinstance(obj, list):
        return [serialize_numpy(item) for item in obj[:10]]  # Truncate lists to first 10 items
    return obj  # Return other types unchanged

