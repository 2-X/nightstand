#!/usr/bin/env python3
"""Prints a release's GitHub notes: its CHANGELOG section, then what was
checked before release. Run from the repository root."""
import re
import sys


def section(changelog, version):
    pattern = re.compile(r"^## \[" + re.escape(version) + r"\][^\n]*\n(.*?)(?=^## \[|\Z)", re.S | re.M)
    match = pattern.search(changelog)
    if not match:
        sys.exit("no CHANGELOG section for %s" % version)
    return match.group(1).strip()


def main(argv):
    version, checked_path = argv[1], argv[2]
    with open("CHANGELOG.md") as handle:
        body = section(handle.read(), version)
    with open(checked_path) as handle:
        checked = handle.read().strip()
    sys.stdout.write("%s\n\n### Checked before release\n\n%s\n" % (body, checked))


if __name__ == "__main__":
    main(sys.argv)
