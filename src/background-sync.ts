export interface BackgroundSyncHandle {
  stop(): void;
  tick(): Promise<void>;
}

export function startBackgroundSync(options: {
  intervalMs: number;
  syncNow: () => Promise<unknown>;
  onError?: (error: unknown) => void;
}): BackgroundSyncHandle {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await options.syncNow();
    } catch (error) {
      options.onError?.(error);
    } finally {
      running = false;
    }
  };
  const handle = setInterval(tick, options.intervalMs);
  return {
    stop: () => clearInterval(handle),
    tick,
  };
}
