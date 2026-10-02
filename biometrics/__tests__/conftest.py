# Several tests stub scipy with sys.modules.setdefault so they run without it.
# Whichever module is collected first wins for the whole session, so import
# the real package up front when it is installed; the stubs then do nothing.
try:
    import scipy.interpolate  # noqa: F401
    import scipy.signal  # noqa: F401
except ImportError:
    pass
