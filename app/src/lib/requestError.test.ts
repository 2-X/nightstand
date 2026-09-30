import { describe, it, expect } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import { bedCommandMessage, isConflict, isRetryable, serverMessage } from './requestError';

function failure(status: number | undefined, data?: unknown, code?: string) {
  const config = { headers: new AxiosHeaders() };
  const response = status === undefined ? undefined : { status, data, statusText: '', headers: {}, config };
  return new AxiosError('failed', code, config, undefined, response);
}

describe('serverMessage', () => {
  it('reads a nested error message', () => {
    expect(serverMessage(failure(503, { error: { message: 'Pod hardware is not connected.' } }))).toBe('Pod hardware is not connected.');
  });
  it('reads a top level message', () => {
    expect(serverMessage(failure(409, { message: 'Already running' }))).toBe('Already running');
  });
  it('reads a plain error string', () => {
    expect(serverMessage(failure(500, { error: 'Broke' }))).toBe('Broke');
  });
  it('ignores blank and non-string values', () => {
    expect(serverMessage(failure(500, { message: '  ', error: { message: 4 } }))).toBeUndefined();
    expect(serverMessage(failure(500, 'text'))).toBeUndefined();
  });
  it('ignores errors that are not responses', () => {
    expect(serverMessage(new Error('x'))).toBeUndefined();
    expect(serverMessage(failure(undefined))).toBeUndefined();
  });
});

describe('bedCommandMessage', () => {
  it('prefers the server message and falls back to a plain one', () => {
    expect(bedCommandMessage(failure(503, { error: { message: 'Try in a moment.' } }))).toBe('Try in a moment.');
    expect(bedCommandMessage(failure(500))).toBe('Could not reach the Pod. Try again.');
    expect(bedCommandMessage(new Error('x'))).toBe('Could not reach the Pod. Try again.');
  });
});

describe('isConflict', () => {
  it('is true only for a 409 response', () => {
    expect(isConflict(failure(409))).toBe(true);
    expect(isConflict(failure(400))).toBe(false);
    expect(isConflict(new Error('x'))).toBe(false);
  });
});

describe('isRetryable', () => {
  it('never retries timeouts or client errors', () => {
    expect(isRetryable(failure(undefined, undefined, 'ECONNABORTED'))).toBe(false);
    expect(isRetryable(failure(undefined, undefined, 'ETIMEDOUT'))).toBe(false);
    expect(isRetryable(failure(400))).toBe(false);
    expect(isRetryable(failure(404))).toBe(false);
    expect(isRetryable(failure(429))).toBe(false);
  });
  it('retries server errors and dropped connections', () => {
    expect(isRetryable(failure(503))).toBe(true);
    expect(isRetryable(failure(500))).toBe(true);
    expect(isRetryable(failure(undefined, undefined, 'ERR_NETWORK'))).toBe(true);
    expect(isRetryable(new Error('x'))).toBe(true);
  });
});
