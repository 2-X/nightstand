#!/bin/bash

# systemd refuses to stop a unit that does not load, even one that is not
# running, so the stream's state decides.
systemctl stop free-sleep-stream
case "$(systemctl is-active free-sleep-stream 2>/dev/null)" in
  inactive|failed|unknown) ;;
  *) exit 1 ;;
esac
systemctl disable free-sleep-stream
