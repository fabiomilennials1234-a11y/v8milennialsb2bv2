import { useCallback, useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { currentAppEntry, workerContainsEntry } from '@/shared/pwa/build-identity';

/**
 * Browsers only re-check sw.js on navigation, and a SPA tab can stay open for
 * days — without polling, a deploy never reaches long-lived tabs.
 */
const SW_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Re-check a missed activation event without reloading an older worker.
 * A busy worker can take longer than three seconds to finish its requests.
 */
const SW_UPDATE_RELOAD_FALLBACK_MS = 3000;
const SW_UPDATE_ACTIVATION_TIMEOUT_MS = 30_000;

interface UseServiceWorkerUpdateReturn {
  /** True when a new SW version is available and pending activation. */
  needRefresh: boolean;
  isUpdating: boolean;
  updateFailed: boolean;
  /** Requests activation and reloads only after the update is ready. */
  updateSW: () => void;
}

/**
 * Registers the PWA service worker. A pending version waits for the user's
 * explicit update action: a hidden or idle tab can still contain unsaved work.
 */
export function useServiceWorkerUpdate(): UseServiceWorkerUpdateReturn {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateFailed, setUpdateFailed] = useState(false);
  const updateSWRef = useRef<ReturnType<typeof registerSW>>();
  const notifiedRef = useRef(false);
  const updatingRef = useRef(false);
  const requestedReloadRef = useRef<() => void>();
  const cleanupUpdateRef = useRef<() => void>();

  const updateSW = useCallback(() => {
    if (updatingRef.current) return;
    updatingRef.current = true;
    setIsUpdating(true);
    setUpdateFailed(false);
    // O reload do build prompt roda só `if (event.isUpdate)` no evento
    // 'controlling', e workbox-window congela isUpdate no register() — página
    // que começou SEM controller ativaria o SW novo sem recarregar, ficando
    // com bundle velho + precache purgado. Garante um único reload local.
    let finished = false;
    const serviceWorker = 'serviceWorker' in navigator ? navigator.serviceWorker : undefined;
    const cleanup = () => {
      finished = true;
      window.clearTimeout(fallbackId);
      window.clearTimeout(timeoutId);
      serviceWorker?.removeEventListener('controllerchange', reload);
      requestedReloadRef.current = undefined;
    };
    const reload = () => {
      if (finished) return;
      cleanup();
      window.location.reload();
    };
    const fail = () => {
      if (finished) return;
      cleanup();
      updatingRef.current = false;
      setIsUpdating(false);
      setUpdateFailed(true);
    };
    const reloadIfReady = async () => {
      if (finished) return;
      try {
        if (!serviceWorker) { reload(); return; }
        const registration = await serviceWorker.getRegistration();
        if (!registration || (
          !registration.waiting && !registration.installing &&
          registration.active?.state === 'activated' &&
          (!serviceWorker.controller || serviceWorker.controller === registration.active)
        )) reload();
      } catch {
        // Failure to inspect the worker is not evidence that it activated.
      }
    };
    requestedReloadRef.current = reload;
    cleanupUpdateRef.current = cleanup;

    if (serviceWorker) {
      serviceWorker.addEventListener('controllerchange', reload, {
        once: true,
      });
    }
    // A blind reload here leaves registration.waiting unchanged, so the new
    // page shows the same toast. Wait for controllerchange while it is busy.
    const fallbackId = window.setTimeout(() => { void reloadIfReady(); }, SW_UPDATE_RELOAD_FALLBACK_MS);
    const timeoutId = window.setTimeout(() => {
      void reloadIfReady().finally(fail);
    }, SW_UPDATE_ACTIVATION_TIMEOUT_MS);

    try {
      void Promise.resolve(updateSWRef.current?.(true)).catch(fail);
    } catch {
      fail();
    }
  }, []);

  useEffect(() => {
    let intervalId: number | undefined;
    let disposed = false;

    updateSWRef.current = registerSW({
      immediate: true,
      onNeedReload() {
        // Workbox also receives activation from other tabs. Only this tab's
        // explicit action may reload it, sharing the native/fallback guard.
        requestedReloadRef.current?.();
      },
      onNeedRefresh() {
        // workbox-window classifica um update achado >60s após o register
        // como "externo" e emite installed + waiting para o MESMO SW — o build
        // prompt então chama onNeedRefresh duas vezes. Sinaliza só uma.
        if (notifiedRef.current) return;
        notifiedRef.current = true;
        const entry = currentAppEntry();
        if (!entry || !navigator.serviceWorker?.getRegistration) {
          setNeedRefresh(true);
          return;
        }
        void (async () => {
          try {
            // Match the registration used by registerSW, including on deep links.
            const registration = await navigator.serviceWorker.getRegistration('/sw.js');
            const waiting = registration?.waiting;
            if (waiting && await workerContainsEntry(waiting, entry) && registration.waiting === waiting) {
              if (!disposed) {
                notifiedRef.current = false; // A later, different build must still notify.
                setNeedRefresh(false);
              }
              return;
            }
          } catch {
            // Failure to identify a build is not evidence that the page is current.
          }
          if (!disposed) setNeedRefresh(true);
        })();
      },
      onRegisteredSW(swUrl: string, registration?: ServiceWorkerRegistration) {
        if (!registration) return;
        intervalId = window.setInterval(async () => {
          if (registration.installing) return;
          try {
            // Probe before update(): a failed fetch (offline, server down)
            // must not surface as an unhandled rejection from update().
            const response = await fetch(swUrl, {
              cache: 'no-store',
              headers: { 'cache-control': 'no-cache' },
            });
            if (response.status === 200) await registration.update();
          } catch {
            // Network hiccup — retry on the next tick.
          }
        }, SW_UPDATE_CHECK_INTERVAL_MS);
      },
    });

    return () => {
      disposed = true;
      if (intervalId !== undefined) window.clearInterval(intervalId);
      cleanupUpdateRef.current?.();
    };
  }, []);

  return { needRefresh, isUpdating, updateFailed, updateSW };
}
