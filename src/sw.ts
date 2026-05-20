/// <reference lib="webworker" />

import { clientsClaim } from 'workbox-core';
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare let self: ServiceWorkerGlobalScope;

// ─── Skip waiting when prompted by the app (registerSW → SKIP_WAITING) ──
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ─── Workbox precache (injected by vite-plugin-pwa) ─────
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
clientsClaim();

// ─── Runtime caching (mirrors workbox config from vite.config) ──
registerRoute(
  ({ request }) =>
    request.destination === 'style' ||
    request.destination === 'font' ||
    request.destination === 'image',
  new CacheFirst({
    cacheName: 'static-assets',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 dias
      }),
    ],
  }),
);

registerRoute(
  ({ request }) => request.destination === 'script',
  new StaleWhileRevalidate({
    cacheName: 'js-assets',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 7 * 24 * 60 * 60, // 7 dias
      }),
    ],
  }),
);

registerRoute(
  ({ url }) => /\.supabase\.co\/rest\/v1\//.test(url.href),
  new NetworkFirst({
    cacheName: 'api-cache',
    networkTimeoutSeconds: 10,
    plugins: [
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 5 * 60 }),
    ],
  }),
);

registerRoute(
  ({ url }) => /\.supabase\.co\/auth\//.test(url.href),
  new NetworkFirst({
    cacheName: 'auth-cache',
    networkTimeoutSeconds: 5,
    plugins: [
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 }),
    ],
  }),
);

registerRoute(
  ({ url }) => /\.supabase\.co\/functions\//.test(url.href),
  new NetworkFirst({
    cacheName: 'edge-fn-cache',
    networkTimeoutSeconds: 15,
    plugins: [
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 5 * 60 }),
    ],
  }),
);

// ─── Push Notifications ─────────────────────────────────
self.addEventListener('push', (event: PushEvent) => {
  if (!event.data) return;

  let payload: { title?: string; body?: string; icon?: string; url?: string; tag?: string };

  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Torque CRM', body: event.data.text() };
  }

  const title = payload.title || 'Torque CRM';
  const options: NotificationOptions = {
    body: payload.body || '',
    icon: payload.icon || '/pwa-192x192.svg',
    badge: '/pwa-192x192.svg',
    tag: payload.tag || 'torque-push',
    data: { url: payload.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();

  const targetUrl = (event.notification.data?.url as string) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Foca tab existente se possível
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      // Abre nova tab
      return self.clients.openWindow(targetUrl);
    }),
  );
});
