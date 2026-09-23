// Service worker: guarda o app no aparelho para abrir sem internet.
// Rotas e busca de endereço sempre vão à rede (não fazem sentido em cache).

const VERSAO = 'contorno-v1';
const CASCA = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/core.js',
  './js/rede.js',
  './js/guarda.js',
  './vendor/maplibre-gl.js',
  './vendor/maplibre-gl.css',
  './fonts/barlow-latin-400-normal.woff2',
  './fonts/barlow-latin-500-normal.woff2',
  './fonts/barlow-latin-600-normal.woff2',
  './fonts/barlow-condensed-latin-600-normal.woff2',
  './fonts/barlow-condensed-latin-700-normal.woff2',
  './fonts/ibm-plex-mono-latin-400-normal.woff2',
  './fonts/ibm-plex-mono-latin-500-normal.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Navegação (inclui o share target com ?text=...): rede primeiro, casca se offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('./index.html')));
    return;
  }
  // Arquivos do app: cache primeiro, atualiza em segundo plano.
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const rede = fetch(e.request).then((resp) => {
        if (resp.ok) caches.open(VERSAO).then((c) => c.put(e.request, resp.clone()));
        return resp;
      }).catch(() => hit);
      return hit || rede;
    }),
  );
});
