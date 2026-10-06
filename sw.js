// ========================================================
// SERVICE WORKER - PREFEITURA DE CANTEIRO (PWA OFFLINE)
// ========================================================
const CACHE_NAME = 'prefeitura-pwa-v3.1';
const ASSETS_TO_CACHE = [
  './',
  'index.html',
  'chamado.html',
  'app.js',
  'xlsx.bundle.js',
  'manifest.json',
  'dados_iniciais_taboca.json',
  'favicon.ico',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
  'logo_gel.png',
  'logo_gel_cropped.png',
  'logo_gel_oficial.png',
  'banner.html'
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

// Interceptação de requisições: Network-First para código e dados críticos; Cache-First para estáticos
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Não interceptar requisições de API (o app.js já gerencia) ou Firebase/Imgbb
  if (url.pathname.includes('/api/') || url.hostname.includes('firestore') || url.hostname.includes('googleapis') || url.hostname.includes('imgbb')) {
    return;
  }

  // Network-First para app.js, index.html e dados_iniciais_taboca.json
  const isDynamicAsset = event.request.mode === 'navigate' || 
                         url.pathname.endsWith('index.html') || 
                         url.pathname.endsWith('app.js') || 
                         url.pathname.endsWith('dados_iniciais_taboca.json');

  if (isDynamicAsset) {
    event.respondWith(
      fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      }).catch(() => {
        // Fallback offline do cache
        return caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          if (event.request.mode === 'navigate') return caches.match('index.html');
        });
      })
    );
    return;
  }

  // Cache-First para imagens, ícones e libs estáticas
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') return response;
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        return response;
      });
    })
  );
});
