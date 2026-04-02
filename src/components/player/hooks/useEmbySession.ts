import { useEffect, useRef } from 'react';
import { embyService } from '../../../services/emby/embyService';
import { logger } from '../../../utils/logger';

// Report progress to Emby every 10 seconds to avoid request spam
const PROGRESS_INTERVAL_MS = 10_000;

/**
 * useEmbySession
 *
 * Reports playback lifecycle events (start / progress / stopped) back to an
 * Emby server whenever the current stream originated from Emby.
 *
 * Usage: call this hook inside the player component passing the embyItemId
 * extracted from the route params.  When embyItemId is undefined/null the hook
 * is a no-op, so it is safe to include unconditionally.
 */
export const useEmbySession = (
  embyItemId: string | undefined | null,
  currentTime: number,
  paused: boolean
) => {
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep a ref for the latest values to avoid stale closures in the interval
  const currentTimeRef = useRef(currentTime);
  const pausedRef = useRef(paused);

  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  // Session lifecycle: start when embyItemId becomes available, stop when it
  // changes or the component unmounts.  The cleanup closure captures the
  // embyItemId that was active when the effect ran, so the correct session is
  // always stopped — even if the ref/prop has already moved to a new value.
  useEffect(() => {
    if (!embyItemId) return;

    embyService.reportPlaybackStart(embyItemId, currentTimeRef.current).catch((err) => {
      logger.warn('[useEmbySession] reportPlaybackStart error:', err);
    });

    return () => {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }

      // Deferred so navigation can complete first
      const positionAtStop = currentTimeRef.current;
      setTimeout(() => {
        embyService
          .reportPlaybackStopped(embyItemId, positionAtStop)
          .catch((err) => logger.warn('[useEmbySession] reportPlaybackStopped error:', err));
      }, 0);
    };
  }, [embyItemId]);

  // Send progress every PROGRESS_INTERVAL_MS while playing; pause/resume sends an immediate report
  useEffect(() => {
    if (!embyItemId) return;

    // Clear existing timer first
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }

    // Immediately report the new pause state when it changes
    embyService.reportPlaybackProgress(embyItemId, currentTimeRef.current, paused).catch(() => {});

    if (!paused) {
      progressTimerRef.current = setInterval(() => {
        embyService
          .reportPlaybackProgress(embyItemId, currentTimeRef.current, pausedRef.current)
          .catch(() => {});
      }, PROGRESS_INTERVAL_MS);
    }

    return () => {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
    };
  }, [embyItemId, paused]);
};
