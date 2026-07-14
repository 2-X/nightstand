import { useEffect, useRef, useState } from 'react';

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

// Animates toward `target` instead of snapping, so the bed illustration
// glides as the head/feet angle changes (matches the "Base is moving..."
// status) rather than jumping a frame at a time like the old PNG sequence.
export function useTweenedNumber(target: number, durationMs = 450): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    fromRef.current = value;
    startRef.current = null;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

    const from = fromRef.current;
    const delta = target - from;
    if (delta === 0) return;

    const step = (timestamp: number) => {
      if (startRef.current === null) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current;
      const t = Math.min(1, elapsed / durationMs);
      setValue(from + delta * easeOutCubic(t));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      }
    };
    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // Deliberately excludes `value` - re-running on every tween tick would
    // restart the animation from wherever it currently sits, never reaching
    // `target`. Each run captures the in-flight value via fromRef instead.
  }, [target, durationMs]);

  return value;
}
