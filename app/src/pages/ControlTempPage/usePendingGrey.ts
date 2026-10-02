import { useEffect, useState } from 'react';

// How long a target may wait for the Pod before it is drawn as unconfirmed.
const PENDING_GREY_AFTER_MS = 2000;

// True once the same pending target has gone unconfirmed for the delay; a new target starts the wait again.
export function usePendingGrey(pending: boolean, target: number) {
  const [greyTarget, setGreyTarget] = useState<number>();
  useEffect(() => {
    if (!pending) return undefined;
    const timer = setTimeout(() => setGreyTarget(target), PENDING_GREY_AFTER_MS);
    return () => {
      clearTimeout(timer);
      setGreyTarget(undefined);
    };
  }, [pending, target]);
  return pending && greyTarget === target;
}
