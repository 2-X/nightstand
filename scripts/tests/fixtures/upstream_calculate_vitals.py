# Processing behavior from https://github.com/throwaway31265/free-sleep, e5172139
from __future__ import annotations

def _calculate_vitals(self, signal: np.ndarray, epoch: int, update_breathing=False, update_hrv=False):
    try:
        # Remove outliers from signal
        data = interpolate_outliers_in_wave(
            signal,
            lower_percentile=self.signal_percentile[0],
            upper_percentile=self.signal_percentile[1],
        )

        data = scale_data(data, lower=0, upper=1024)
        data = remove_baseline_wander(data, sample_rate=500.0, cutoff=0.05)

        data = filter_signal(
            data,
            cutoff=[0.5, 20.0],
            sample_rate=500.0,
            order=2,
            filtertype='bandpass'
        )

        working_data, measurement = process(
            data,
            500,
            breathing_method='fft',
            bpmmin=40,
            bpmmax=90,
            windowsize=self.window_size,
            calculate_breathing=update_breathing,
        )
        if update_breathing:
            breathing_rate = measurement.get('breathingrate', 0) * 60
            if (8 <= breathing_rate <= 20) and not np.isnan(breathing_rate):
                self.breath_rates.append(breathing_rate)
                breathing_rate = sum(self.breath_rates) / len(self.breath_rates)
                if not np.isnan(breathing_rate):
                    self.breathing_rate = breathing_rate

        if update_hrv:
            hrv = measurement['sdnn']
            if (8 <= hrv <= 200) and not np.isnan(hrv):
                self.hrv_rates.append(hrv)
                hrv = sum(self.hrv_rates) / len(self.hrv_rates)

                if not np.isnan(hrv):
                    self.hrv = hrv


        if self.is_valid(measurement):
            return {
                'side': self.side,
                'timestamp': epoch,
                'heart_rate': measurement['bpm'],
                'hrv': self.hrv,
                'breathing_rate': self.breathing_rate,
            }
    except BadSignalWarning:
        return None
    except Exception as e:
        error_message = traceback.format_exc()
        logger.error(e)
        logger.error(error_message)
        return None
