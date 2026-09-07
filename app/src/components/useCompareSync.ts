import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useAppStore } from '@state/appStore.tsx';
import {
  COMPARE_NAVIGATE,
  COMPARE_ROUTE_REPORT,
  isCompareMessage,
} from '@lib/compareMessages.ts';

/**
 * Keeps a Compare-mode pane in step with its sibling (see ComparePage).
 * Mounted once in Layout; does nothing unless this document is a side-pinned
 * iframe. Reports our route changes to the parent, and follows navigation
 * orders relayed from the other pane. The follow is a no-op when we're
 * already on the requested path, which is also what stops the two panes
 * ping-ponging forever.
 */
export default function useCompareSync() {
  const location = useLocation();
  const navigate = useNavigate();
  const { sidePinned } = useAppStore();
  const embedded = sidePinned && window.parent !== window;

  useEffect(() => {
    if (!embedded) return;
    window.parent.postMessage(
      { type: COMPARE_ROUTE_REPORT, path: location.pathname },
      window.location.origin,
    );
  }, [embedded, location.pathname]);

  useEffect(() => {
    if (!embedded) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!isCompareMessage(event.data) || event.data.type !== COMPARE_NAVIGATE) return;
      if (event.data.path !== location.pathname) navigate(event.data.path);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [embedded, location.pathname, navigate]);
}
