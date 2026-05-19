import { useCallback, useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

interface UseServiceWorkerUpdateOptions {
  /** Called when a new SW version is available and waiting to activate. */
  onNeedRefresh?: () => void;
}

interface UseServiceWorkerUpdateReturn {
  /** True when a new SW version is available. */
  needRefresh: boolean;
  /** Call to activate the waiting SW and reload. */
  updateSW: () => void;
}

/**
 * Registers the PWA service worker and exposes update state.
 * Used by the app shell to show "new version available" toasts.
 */
export function useServiceWorkerUpdate(
  options?: UseServiceWorkerUpdateOptions,
): UseServiceWorkerUpdateReturn {
  const [needRefresh, setNeedRefresh] = useState(false);
  const onNeedRefreshRef = useRef(options?.onNeedRefresh);
  onNeedRefreshRef.current = options?.onNeedRefresh;

  const updateSWRef = useRef<ReturnType<typeof registerSW>>();

  useEffect(() => {
    updateSWRef.current = registerSW({
      immediate: true,
      onNeedRefresh() {
        setNeedRefresh(true);
        onNeedRefreshRef.current?.();
      },
      onRegisteredSW(_url: string, _r?: ServiceWorkerRegistration) {
        // SW registered. Could add periodic update check here.
      },
    });
  }, []);

  const updateSW = useCallback(() => {
    updateSWRef.current?.(true);
  }, []);

  return { needRefresh, updateSW };
}
