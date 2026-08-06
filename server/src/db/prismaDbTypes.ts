import { Side } from './schedulesSchema.js';

export interface SleepRecord {
  id: number;
  side: Side;
  entered_bed_at: string;
  left_bed_at: string;
  sleep_period_seconds: number;
  times_exited_bed: number;
  present_intervals: [string, string][];
  not_present_intervals: [string, string][];
}

export interface MovementRecord {
  timestamp: string;
  side: Side;
  total_movement: number;
}

