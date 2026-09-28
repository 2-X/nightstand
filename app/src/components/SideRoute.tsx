import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAppStore, Side } from '@state/appStore.tsx';

export default function SideRoute({ side }: { side: Side }) {
  const setSide = useAppStore((state) => state.setSide);
  useEffect(() => {
    setSide(side);
  }, [side, setSide]);
  return <Navigate to="/" replace />;
}
