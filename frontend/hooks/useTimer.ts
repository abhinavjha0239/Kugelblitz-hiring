'use client';
import { useState, useEffect, useCallback, useRef } from 'react';

export function useTimer(startedAt: string | null, durationMinutes: number, onTimeout?: () => void) {
  const [remaining, setRemaining] = useState<number>(durationMinutes * 60);
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  const calculate = useCallback(() => {
    if (!startedAt) return durationMinutes * 60;
    const elapsed = (Date.now() - new Date(startedAt).getTime()) / 1000;
    return Math.max(0, Math.floor(durationMinutes * 60 - elapsed));
  }, [startedAt, durationMinutes]);

  useEffect(() => {
    setRemaining(calculate());
    const interval = setInterval(() => {
      const r = calculate();
      setRemaining(r);
      if (r <= 0) {
        clearInterval(interval);
        onTimeoutRef.current?.();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [calculate]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const isLow = remaining < 300;
  const isCritical = remaining < 60;

  return { remaining, minutes, seconds, formatted, isLow, isCritical };
}
