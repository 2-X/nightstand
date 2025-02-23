#!/bin/bash


PYTHON_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
PYTHON_VERSION_2=$(python3 -c 'import sys; print(f"{sys.version_info.major}{sys.version_info.minor}")')
echo "Python version: $PYTHON_VERSION_2"

cp /home/dac/free-sleep/scripts/python/plistlib.py /usr/lib64/python$PYTHON_VERSION/
cp /home/dac/free-sleep/scripts/python/pyexpat.cpython-$PYTHON_VERSION_2-aarch64-linux-gnu.so /usr/lib64/python$PYTHON_VERSION/
python3 -m venv /home/dac/venv
source /home/dac/venv/bin/activate
/home/dac/venv/bin/python -m pip install numpy scipy pandas cbor2 watchdog

