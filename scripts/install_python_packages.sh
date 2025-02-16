#!/bin/bash
cp /home/dac/free-sleep/scripts/python/plistlib.py /usr/lib64/python3.10/

# TODO: need the version for python 3.9
cp /home/dac/free-sleep/scripts/python/pyexpat.cpython-310-aarch64-linux-gnu.so /usr/lib64/python3.10/
python3 -m venv /home/dac/venv
source /home/dac/venv/bin/activate
/home/dac/venv/bin/python -m pip install numpy scipy pandas cbor2 watchdog
/home/dac/venv/bin/python -m pip install watchdog
