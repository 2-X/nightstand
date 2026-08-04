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
    // Forward the query's abort signal so unmounting actually cancels the
    // request instead of leaving it in flight. Every Status row calls this
    // hook, so without it a page that unmounts mid-request leaves a response
    // with nothing left to deliver to.
    queryFn: async ({ signal }) => {
      const response = await axios.get<CalibrationState>('/calibration', { signal });
      return response.data;
    },
  });
};
