export const MATCH_APP_ENTRY = 'TORQUE_MATCH_APP_ENTRY';

/** The hashed module entry changes with the application build. */
export function currentAppEntry(): string | undefined {
  const scripts = document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]');
  for (const script of scripts) {
    const url = new URL(script.src, document.baseURI);
    if (url.origin === window.location.origin && url.pathname.startsWith('/assets/')) return url.href;
  }
}

/** An older worker may not support this protocol: uncertainty keeps the prompt. */
export function workerContainsEntry(worker: ServiceWorker, entry: string): Promise<boolean> {
  if (typeof MessageChannel === 'undefined') return Promise.resolve(false);
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const finish = (matches: boolean) => {
      clearTimeout(timeout);
      channel.port1.close();
      channel.port2.close();
      resolve(matches);
    };
    const timeout = setTimeout(() => finish(false), 1500);
    channel.port1.onmessage = event => {
      finish(event.data?.type === MATCH_APP_ENTRY && event.data.matches === true);
    };
    try {
      worker.postMessage({ type: MATCH_APP_ENTRY, entry }, [channel.port2]);
    } catch {
      finish(false);
    }
  });
}
