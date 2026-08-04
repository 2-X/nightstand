import axios from './api';
import { useQuery } from '@tanstack/react-query';
import { CalibrationView } from '../../../server/src/routes/calibration/calibrationView.ts';
export type { CalibrationView };

export type CalibrationState = {
  left: CalibrationView;
  right: CalibrationView;
};

export const useCalibration = () => {
  return useQuery<CalibrationState>({
    queryKey: ['useCalibration'],
    queryFn: async () => {
      const response = await axios.get<CalibrationState>('/calibration');
      return response.data;
    },
  });
};
