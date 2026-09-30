import { isAxiosError } from 'axios';

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

// The server answers { message }, { error: string } or { error: { message } }.
export function serverMessage(failure: unknown): string | undefined {
  if (!isAxiosError(failure)) return undefined;
  const data = failure.response?.data;
  if (!data || typeof data !== 'object') return undefined;
  const { message, error } = data as { message?: unknown; error?: unknown };
  return text(message) ?? text(error) ?? text((error as { message?: unknown } | null | undefined)?.message);
}

export const bedCommandMessage = (failure: unknown) => serverMessage(failure) ?? 'Could not reach the Pod. Try again.';

export const isConflict = (failure: unknown) => isAxiosError(failure) && failure.response?.status === 409;

// A timeout would only take another full wait, and a 4xx answer will not change.
export function isRetryable(failure: unknown) {
  if (!isAxiosError(failure)) return true;
  if (failure.code === 'ECONNABORTED' || failure.code === 'ETIMEDOUT') return false;
  const status = failure.response?.status;
  return !(status && status >= 400 && status < 500);
}
