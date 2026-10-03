"""Makes the packages bundled in vendor/ importable when the venv lacks them."""
import os
import sys

VENDOR_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'vendor')

# Appended, so a copy installed in the venv still comes first.
if VENDOR_DIR not in sys.path:
    sys.path.append(VENDOR_DIR)
