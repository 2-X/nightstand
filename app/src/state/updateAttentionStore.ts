import { create } from 'zustand';

export type UpdateOutcome = 'failed' | 'timed_out';

type UpdateAttentionState = {
  updateAttention: boolean;
  updateOutcome?: UpdateOutcome;
  updateStartVersion?: string;
  setUpdateAttention: (value: boolean, outcome?: UpdateOutcome, startVersion?: string) => void;
};

// Module state for this loaded app. Navigating preserves it; reloading clears it.
export const useUpdateAttentionStore = create<UpdateAttentionState>((set) => ({
  updateAttention: false,
  setUpdateAttention: (updateAttention, updateOutcome, updateStartVersion) => set({
    updateAttention, updateOutcome, updateStartVersion,
  }),
}));
