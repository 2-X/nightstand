import { useAppStore } from '@state/appStore';
import { useDeviceFreshness } from './useDeviceFreshness';

// The Bed page's one reading of the device status: the query, plus whether its answer is live.
export function useBedFrame() {
  const { side } = useAppStore();
  const { frameFor, ...query } = useDeviceFreshness();
  return { ...query, frame: frameFor(side) };
}
