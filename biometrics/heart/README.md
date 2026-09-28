# HeartPy (adapted copy)

The code in this folder is adapted from HeartPy, a heart rate analysis toolkit
by Paul van Gent. The biometrics pipeline uses it to estimate heart rate, HRV,
and breathing rate from the piezo signal (see `stream/biometric_processor.py`
and `vitals/calculations.py`).

It came into this repository with the original
[throwaway31265/free-sleep](https://github.com/throwaway31265/free-sleep)
project, which kept only the modules the pipeline needs and adapted them to
its own types in `biometrics/data_types.py`. This folder matches that copy.
Because it is trimmed, it does not accept every parameter the PyPI package
does; `biometrics/__tests__/test_vitals_calculations.py` checks the ones
`vitals/calculations.py` passes.

## Original author

**Paul van Gent**

- [HeartPy on PyPI](https://pypi.org/project/heartpy/)
- [GitHub repository](https://github.com/paulvangentcom/heartrate_analysis_python)
- [Heart Rate Analysis for Human Factors: Development and Validation of an Open-Source Toolkit for Noisy Naturalistic Heart Rate Data](https://www.researchgate.net/publication/325967542_Heart_Rate_Analysis_for_Human_Factors_Development_and_Validation_of_an_Open_Source_Toolkit_for_Noisy_Naturalistic_Heart_Rate_Data)
- [Analysing Noisy Driver Physiology in Real-Time Using Off-the-Shelf Sensors: Heart Rate Analysis Software from the Taking the Fast Lane Project](https://www.researchgate.net/publication/328654252_Analysing_Noisy_Driver_Physiology_Real-Time_Using_Off-the-Shelf_Sensors_Heart_Rate_Analysis_Software_from_the_Taking_the_Fast_Lane_Project?channel=doi&linkId=5bdab2c84585150b2b959d13&showFulltext=true)
