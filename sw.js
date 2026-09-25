// ========================================================
// SERVICE WORKER - PREFEITURA DE CANTEIRO (PWA OFFLINE)
// ========================================================
const CACHE_NAME = 'prefeitura-pwa-v2.0';
const ASSETS_TO_CACHE = [
  './',
  'index.html',
  'app.js',
  'manifest.json',
  'dados_iniciais_taboca.json',
  'favicon.ico',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
  'logo_gel.png',
  'logo_gel_cropped.png'
];

// Instalação do Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Cache inicializado com sucesso.');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Ativação e limpeza de versões antigas
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Removendo cache antigo:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Interceptação de requisições
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Não interceptar requisições de API (o app.js já gerencia) ou Firebase/Imgbb
  if (url.pathname.includes('/api/') || url.hostname.includes('firestore') || url.hostname.includes('imgbb')) {
    return;
  }

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        // Retorna do cache e atualiza em background
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => {});
        return cachedResponse;
      }

      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return response;
      }).catch(() => {
        // Fallback offline
        if (event.request.mode === 'navigate') {
          return caches.match('index.html');
        }
      });
    })
  );
});
