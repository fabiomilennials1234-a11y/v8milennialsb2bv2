/**
 * Réplica do Service Worker antes da correção, reduzida ao que importa: intercepta script, estilo,
 * fonte e imagem de qualquer origem. É o que um cliente com a versão antiga ainda tem instalado.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', (event) => {
  if (['script', 'style', 'font', 'image'].includes(event.request.destination)) {
    event.respondWith(fetch(event.request));
  }
});
