// Response shape of /metrics/sleep-score. The app no longer requests it.
export type SleepScoreComponent = {
  score: number;
  weight: number;
  value: string;
  available: boolean;
};

export type SleepScore = {
  // false when features.sleepScore is off or biometrics itself is off; in
  // that case score is null and components is empty rather than a
  // fabricated result.
  active: boolean;
  score: number | null;
  components: Partial<{
    duration: SleepScoreComponent;
    continuity: SleepScoreComponent;
    restingHr: SleepScoreComponent;
  }>;
};
