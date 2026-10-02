import { isAxiosError } from 'axios';
import { inUseLines, type InUseReasonText } from '../../../server/src/routes/update/inUseText';

export { inUseLines, type InUseReasonText };

// The reasons in a 409 from update, rollback or switch, or undefined when the
// failure is anything else. A reason this app does not know is dropped, and a
// refusal with none left is an ordinary failure, not a question to answer.
export function inUseReasons(failure: unknown): InUseReasonText[] | undefined {
  if (!isAxiosError(failure) || failure.response?.status !== 409) return undefined;
  const reasons: unknown = failure.response.data?.reasons;
  if (!Array.isArray(reasons)) return undefined;
  const known = reasons.filter((reason): reason is InUseReasonText => inUseLines([reason as InUseReasonText]).length > 0);
  return known.length > 0 ? known : undefined;
}
