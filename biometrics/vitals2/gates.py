HR_MIN_QUALITY = 0.6
HR_RANGE = (35, 140)
HRV_MIN_COVERAGE = 0.6
RESP_MIN_QUALITY = 0.5
RESP_RANGE = (6, 30)
# Heart-rate windows also need these, beside quality (posterior mass near the
# rate) and range: a share of nearby windows agreeing, enough evidence at the
# rate, little evidence at double it, and few moving or clipped seconds.
HR_MIN_SUPPORT = 0.4
HR_MIN_EVIDENCE = 0.25
HR_MAX_OCTAVE = 0.3
HR_MAX_MOTION = 0.2
