# Bundled Python modules

The two `pyexpat` extensions are built from CPython source for Linux
AArch64. They include Expat, so no separate `libexpat` installation is
required. CPython's license is in `LICENSE-CPython.txt`; Expat's MIT license
is in `LICENSE-Expat.txt`. The same Expat notice accompanies both source
releases. The Python library files in this directory also come from CPython.

| Extension | Source release | Build environment |
| --- | --- | --- |
| `pyexpat.cpython-39-aarch64-linux-gnu.so` | CPython 3.9.9 | manylinux2014 AArch64, glibc 2.17 |
| `pyexpat.cpython-310-aarch64-linux-gnu.so` | CPython 3.10.4 | manylinux2014 AArch64, glibc 2.17 |

Only the 3.10 extension was rebuilt for the recipe below. Its C sources are
unmodified, and it was stripped after compilation. It requires only the
`GLIBC_2.17` symbol version and imports the same Python C API symbols as the
previous extension. Building on an older glibc keeps it compatible with
older Pod Linux installations.

## Rebuilding the Python 3.10 extension

Source: [Python-3.10.4.tar.xz](https://www.python.org/ftp/python/3.10.4/Python-3.10.4.tar.xz).

Source SHA-256:

```text
80bf925f571da436b35210886cf79f6eb5fa5d6c571316b73568343451f77a19
```

The build used GCC 10.2.1 in this image:

```text
quay.io/pypa/manylinux2014_aarch64@sha256:d36e257b4f7b1130a1442a5cd28022307645a92b8093ab65543205426354cfd2
```

Extract the source archive into a working directory, mount that directory
at `/work` in the image, and run the following inside the container. The
build container needs no network access.

```sh
cd /work/Python-3.10.4
./configure --without-ensurepip
gcc -O2 -DNDEBUG -fPIC -shared \
  -I. -IInclude -IModules/expat \
  -DHAVE_EXPAT_CONFIG_H=1 -DXML_POOR_ENTROPY=1 \
  Modules/pyexpat.c Modules/expat/xmlparse.c \
  Modules/expat/xmlrole.c Modules/expat/xmltok.c \
  -lm -o /work/pyexpat.cpython-310-aarch64-linux-gnu.so
strip --strip-unneeded /work/pyexpat.cpython-310-aarch64-linux-gnu.so
readelf --version-info /work/pyexpat.cpython-310-aarch64-linux-gnu.so
PYTHONPATH=/work:/work/Python-3.10.4/Lib \
  /opt/python/cp310-cp310/bin/python -m unittest test.test_pyexpat
```

The rebuilt extension passed all 39 parser tests from CPython 3.10.4 using
the image's Python 3.10.21 interpreter. XML ElementTree and XML plist
round trips also passed with the rebuilt extension loaded. Validation was
performed in the container, without accessing a Pod.

The resulting binary SHA-256 is:

```text
82c4559d594794c68055949962745fad7296048a2da446adb41d16a793460b28
```
