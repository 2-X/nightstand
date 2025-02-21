'''
# Original Author:

- **Paul van Gent**
- [HeartPy on PyPI](https://pypi.org/project/heartpy/)
- [GitHub Repository](https://github.com/paulvangentcom/heartrate_analysis_python)
- [Heart Rate Analysis for Human Factors: Development and Validation of an Open-Source Toolkit for Noisy Naturalistic Heart Rate Data](https://www.researchgate.net/publication/325967542_Heart_Rate_Analysis_for_Human_Factors_Development_and_Validation_of_an_Open_Source_Toolkit_for_Noisy_Naturalistic_Heart_Rate_Data)
- [Analysing Noisy Driver Physiology in Real-Time Using Off-the-Shelf Sensors: Heart Rate Analysis Software from the Taking the Fast Lane Project](https://www.researchgate.net/publication/328654252_Analysing_Noisy_Driver_Physiology_Real-Time_Using_Off-the-Shelf_Sensors_Heart_Rate_Analysis_Software_from_the_Taking_the_Fast_Lane_Project?channel=doi&linkId=5bdab2c84585150b2b959d13&showFulltext=true)


functions for peak detection and related tasks
'''
from typing import List, Dict, Union, Tuple
import numpy as np
from scipy.signal import resample

from heart.analysis import calc_rr, update_rr
from heart.exceptions import BadSignalWarning
from data_types import *
__all__ = ['make_windows',
           'append_dict',
           'detect_peaks',
           'fit_peaks',
           'check_peaks',
           'check_binary_quality',
           'interpolate_peaks']


def make_windows(data, sample_rate, windowsize=120, overlap=0, min_size=20):
    '''slices data into windows

    Funcion that slices data into windows for concurrent analysis.
    Used by process_segmentwise wrapper function.

    Parameters
    ----------
    data : 1-d array
        array containing heart rate sensor data

    sample_rate : int or float
        sample rate of the data stream in 'data'

    windowsize : int
        size of the window that is sliced in seconds

    overlap : float
        fraction of overlap between two adjacent windows: 0 <= float < 1.0

    min_size : int
        the minimum size for the last (partial) window to be included. Very short windows
        might not stable for peak fitting, especially when significant noise is present.
        Slightly longer windows are likely stable but don't make much sense from a
        signal analysis perspective.

    Returns
    -------
    out : array
        tuples of window indices

    Examples
    --------
    Assuming a given example data file:

    >>> import heartpy as hp
    >>> data, _ = hp.load_exampledata(1)

    We can split the data into windows:

    >>> indices = make_windows(data, 100.0, windowsize = 30, overlap = 0.5, min_size = 20)
    >>> indices.shape
    (9, 2)

    Specifying min_size = -1 will include the last window no matter what:

    >>> indices = make_windows(data, 100.0, windowsize = 30, overlap = 0.5, min_size = -1)
    '''
    ln = len(data)
    window = windowsize * sample_rate
    stepsize = (1 - overlap) * window
    start = 0
    end = window

    slices = []
    while end < len(data):
        slices.append((start, end))
        start += stepsize
        end += stepsize

    if min_size == -1:
        slices[-1] = (slices[-1][0], len(data))
    elif (ln - start) / sample_rate >= min_size:
        slices.append((start, ln))

    return np.array(slices, dtype=np.int32)


def append_dict(dict_obj, measure_key, measure_value):
    '''appends data to keyed dict.

    Function that appends key to continuous dict, creates if doesn't exist. EAFP

    Parameters
    ----------
    dict_obj : dict
        dictionary object that contains continuous output measures

    measure_key : str
        key for the measure to be stored in continuous_dict

    measure_value : any data container
        value to be appended to dictionary

    Returns
    -------
    dict_obj : dict
        dictionary object passed to function, with specified data container appended

    Examples
    --------
    Given a dict object 'example' with some data in it:

    >>> example = {}
    >>> example['call'] = ['hello']

    We can use the function to append it:

    >>> example = append_dict(example, 'call', 'world')
    >>> example['call']
    ['hello', 'world']

    A new key will be created if it doesn't exist:

    >>> example = append_dict(example, 'different_key', 'hello there!')
    >>> sorted(example.keys())
    ['call', 'different_key']
    '''
    try:
        dict_obj[measure_key].append(measure_value)
    except KeyError:
        dict_obj[measure_key] = [measure_value]
    return dict_obj


def detect_peaks(
        hrdata: np.ndarray,
        rol_mean: np.ndarray,
        ma_perc: float,
        sample_rate: int,
        working_data: Dict[str, Union[List[int], np.ndarray, float]] = {}
) -> WorkingData:
    """
    Detect peaks in a heart rate signal based on a rolling mean.
    """
    # rol_mean = np.array(rol_mean)

    # Corrected rolling mean calculation (matches the original implementation)
    mean = np.mean(rol_mean / 100) * ma_perc
    rol_mean_copy = rol_mean + mean

    # Identify candidate peaks where hrdata exceeds the adjusted rolling mean
    peaksx = np.where(hrdata > rol_mean_copy)[0]
    peaksy = hrdata[peaksx]

    # Identify peak segment boundaries
    peak_edges = np.concatenate(([0], np.where(np.diff(peaksx) > 1)[0], [len(peaksx)]))

    peaklist = []

    # Iterate through peak segments and find the highest peak in each segment
    for i in range(len(peak_edges) - 1):
        segment_values = peaksy[peak_edges[i]:peak_edges[i + 1]].tolist()
        if segment_values:
            peaklist.append(peaksx[peak_edges[i] + segment_values.index(max(segment_values))])

    working_data["peaklist"] = np.array(peaklist)
    working_data["ybeat"] = np.array([hrdata[x] for x in peaklist])
    working_data["rolling_mean"] = rol_mean_copy

    # Calculate RR intervals
    working_data = calc_rr(working_data["peaklist"], sample_rate, working_data=working_data)

    # Compute RR standard deviation
    # working_data["rrsd"] = np.std(working_data["RR_list"]) if working_data["RR_list"] else np.inf
    if len(working_data['RR_list']) > 0:
        working_data['rrsd'] = np.std(working_data['RR_list'])
    else:
        working_data['rrsd'] = np.inf
    return working_data



def fit_peaks(
        hrdata: np.ndarray,
        rol_mean: np.ndarray,
        sample_rate: int,
        bpmmin: int = 40,
        bpmmax: int = 180,
        working_data: Dict[str, Union[List[int], np.ndarray, float]] = {}
) -> WorkingData:
    """
    Optimize peak detection by testing multiple moving average percentages.
    """
    ma_perc_list = [5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90,
                    100, 110, 120, 150, 200, 300]

    # Store results: (RR standard deviation, detected BPM, ma_perc)
    rrsd = []

    for ma_perc in ma_perc_list:
        working_data = detect_peaks(hrdata, rol_mean, ma_perc, sample_rate, working_data=working_data)
        bpm = ((len(working_data["peaklist"]) / (len(hrdata) / sample_rate)) * 60)
        rrsd.append((working_data["rrsd"], bpm, ma_perc))

    # Find valid MA percentages based on RR standard deviation and BPM range
    valid_ma = [(rrsd, ma_perc) for rrsd, bpm, ma_perc in rrsd if rrsd > 0.1 and bpmmin <= bpm <= bpmmax]

    if valid_ma:
        # Select the best moving average percentage based on lowest RRSD
        best_ma_perc = min(valid_ma, key=lambda x: x[0])[1]
        working_data["best"] = best_ma_perc

        # Re-run peak detection with the best MA percentage
        working_data = detect_peaks(hrdata, rol_mean, best_ma_perc, sample_rate, working_data=working_data)
        return working_data
    else:
        # Raise warning if no valid peak detection can be determined
        raise BadSignalWarning("Could not determine best fit, bad signal")


def check_peaks(working_data: WorkingData) -> WorkingData:
    '''find anomalous peaks.

    Function that checks peaks for outliers based on anomalous peak-peak distances and corrects
    by excluding them from further analysis.
    '''
    try:
        # define RR range as mean +/- 30%, with a minimum of 300
        mean_rr = np.mean(working_data['RR_list'])
        thirty_perc = 0.3 * mean_rr
        if thirty_perc <= 300:
            upper_threshold = mean_rr + 300
            lower_threshold = mean_rr - 300
        else:
            upper_threshold = mean_rr + thirty_perc
            lower_threshold = mean_rr - thirty_perc

        # identify peaks to exclude based on RR interval
        # rem_idx = np.where((rr_arr <= lower_threshold) | (rr_arr >= upper_threshold))[0] + 1
        rem_idx = np.where((working_data['RR_list'] <= lower_threshold) | (working_data['RR_list'] >= upper_threshold))[0] + 1

        working_data['removed_beats'] = working_data['peaklist'][rem_idx]
        working_data['removed_beats_y'] = working_data['ybeat'][rem_idx]
        working_data['binary_peaklist'] = np.asarray([0 if x in working_data['removed_beats']
                                                      else 1 for x in working_data['peaklist']])

        # if reject_segmentwise:
        #     working_data = check_binary_quality(working_data['peaklist'], working_data['binary_peaklist'],
        #                                         working_data=working_data)

        working_data = update_rr(working_data=working_data)

        return working_data
    except Exception as e:
        print('-----------------------------------------------------------------------------------------------------')
        print(f"peakdetection.py:237 type((working_data['RR_list']) {type(working_data['RR_list'])}")
        print(f"peakdetection.py:237 type((working_data['peaklist']) {type(working_data['peaklist'])}")
        print(f"peakdetection.py:237 type((working_data['ybeat']) {type(working_data['ybeat'])}")

        print(e)



def check_binary_quality(peaklist, binary_peaklist, maxrejects=3, working_data={}):
    '''checks signal in chunks of 10 beats.

    Function that checks signal in chunks of 10 beats. It zeros out chunk if
    number of rejected peaks > maxrejects. Also marks rejected segment coordinates
    in tuples (x[0], x[1] in working_data['rejected_segments']

    Parameters
    ----------
    peaklist : 1d array or list
        list or array containing detected peak positions

    binary_peaklist : 1d array or list
        list or array containing mask for peaklist, coding which peaks are rejected

    maxjerects : int
        maximum number of rejected peaks per 10-beat window
        default : 3

    working_data : dict
        dictionary object that contains all heartpy's working data (temp) objects.
        will be created if not passed to function

    Returns
    -------
    working_data : dict
        working_data dictionary object containing all of heartpy's temp objects

    '''
    idx = 0
    working_data['rejected_segments'] = []
    for i in range(int(len(binary_peaklist) / 10)):
        if np.bincount(binary_peaklist[idx:idx + 10])[0] > maxrejects:
            binary_peaklist[idx:idx + 10] = [0 for i in range(len(binary_peaklist[idx:idx + 10]))]
            if idx + 10 < len(peaklist):
                working_data['rejected_segments'].append((peaklist[idx], peaklist[idx + 10]))
            else:
                working_data['rejected_segments'].append((peaklist[idx], peaklist[-1]))
        idx += 10
    return working_data


def interpolate_peaks(data, peaks, sample_rate, desired_sample_rate=1000.0, working_data={}):
    '''interpolate detected peak positions and surrounding data points

    Function that enables high-precision mode by taking the estimated peak position,
    then upsampling the peak position +/- 100ms to the specified sampling rate, subsequently
    estimating the peak position with higher accuracy.

    Parameters
    ----------
    data : 1d list or array
        list or array containing heart rate data

    peaks : 1d list or array
        list or array containing x-positions of peaks in signal

    sample_rate : int or float
        the sample rate of the signal (in Hz)

    desired_sampled-rate : int or float
        the sample rate to which to upsample.
        Must be sample_rate < desired_sample_rate

    Returns
    -------
    working_data : dict
        working_data dictionary object containing all of heartpy's temp objects

    Examples
    --------
    Given the output of a normal analysis and the first five peak-peak intervals:

    >>> import heartpy as hp
    >>> data, _ = hp.load_exampledata(0)
    >>> wd, m = hp.process(data, 100.0)
    >>> wd['peaklist'][0:5]
    [63, 165, 264, 360, 460]

    Now, the resolution is at max 10ms as that's the distance between data points.
    We can use the high precision mode for example to approximate a more precise
    position, for example if we had recorded at 1000Hz:

    >>> wd = interpolate_peaks(data = data, peaks = wd['peaklist'],
    ... sample_rate = 100.0, desired_sample_rate = 1000.0, working_data = wd)
    >>> wd['peaklist'][0:5]
    [63.5, 165.4, 263.6, 360.4, 460.2]

    As you can see the accuracy of peak positions has increased.
    Note that you cannot magically upsample nothing into something. Be reasonable.
    '''
    assert desired_sample_rate > sample_rate, "desired sample rate is lower than actual sample rate \
this would result in downsampling which will hurt accuracy."

    num_samples = int(0.1 * sample_rate)
    ratio = sample_rate / desired_sample_rate
    interpolation_slices = [(x - num_samples, x + num_samples) for x in peaks]
    peaks = []

    for i in interpolation_slices:
        slice = data[i[0]:i[1]]
        resampled = resample(slice, int(len(slice) * (desired_sample_rate / sample_rate)))
        peakpos = np.argmax(resampled)
        peaks.append((i[0] + (peakpos * ratio)))

    working_data['peaklist'] = peaks

    return working_data
