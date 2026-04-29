'use client';
import { useEffect, useCallback, useRef } from 'react';

export function useFullscreen(testId: string | null, onExit?: () => void) {
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  const enterFullscreen = useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen();
    } catch (e) {
      console.warn('Fullscreen request denied');
    }
  }, []);

  const exitFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch (e) {
      console.warn('Exit fullscreen failed');
    }
  }, []);

  useEffect(() => {
    if (!testId) return;

    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        onExitRef.current?.();
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        onExitRef.current?.();
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [testId]);

  return { enterFullscreen, exitFullscreen };
}
