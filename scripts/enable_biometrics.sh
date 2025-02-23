#!/bin/bash

sh /home/dac/free-sleep/scripts/unblock_internet_access.sh
sh /home/dac/free-sleep/scripts/setup_python.sh
sh /home/dac/free-sleep/scripts/install_python_packages.sh
sh /home/dac/free-sleep/scripts/setup_streamer_service.sh
sh /home/dac/free-sleep/scripts/block_internet_access.sh
