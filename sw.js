// ========================================================
// SERVICE WORKER - PREFEITURA DE CANTEIRO (PWA OFFLINE)
// ========================================================
const CACHE_NAME = 'prefeitura-pwa-v6.1';
const ASSETS_TO_CACHE = [
  './',
  'index.html',
  'chamado.html',
  'limpeza.html',
  'ronda.html',
  'guarda.html',
  'alojado.html',
  'auth.js',
  'app.js',
  'qrcode.min.js',
  'xlsx.bundle.js',
  'manifest.json',
  'manifest-alojado.json',
  'dados_iniciais_taboca.json',
  'favicon.ico',
  'icon-192.png',
  'icon-512.png',
  'icon-alojado-192.png',
  'icon-alojado-512.png',
  'apple-touch-icon.png',
  'banner_pavilhao.jpg',
  'logo_gel.png',
  'logo_gel_cropped.png',
  'logo_gel_oficial.png'
];

// Instalação do Service Worker com cache resiliente
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Cache inicializando:', CACHE_NAME);
      return Promise.allSettled(
        ASSETS_TO_CACHE.map((url) =>
          fetch(url, { cache: 'no-cache' })
            .then((response) => {
              if (response && response.status === 200) {
                return cache.put(url, response);
              }
              console.warn('[SW] Asset ignorado no pré-cache:', url, response ? response.status : 'sem resposta');
            })
            .catch((err) => {
              console.warn('[SW] Falha ao baixar asset no pré-cache:', url, err.message);
            })
        )
      );
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

  // Não interceptar requisições de API (o app.js já gerencia) ou Firebase Auth/Firestore/Imgbb
  if (
    url.pathname.includes('/api/') ||
    url.hostname.includes('firestore') ||
    url.hostname.includes('googleapis') ||
    url.hostname.includes('firebaseapp') ||
    url.hostname.includes('identitytoolkit') ||
    url.hostname.includes('securetoken') ||
    url.hostname.includes('imgbb')
  ) {
    return;
  }

  // Network-First para auth.js, app.js, index.html e dados_iniciais_taboca.json
  const isDynamicAsset = event.request.mode === 'navigate' ||
                         url.pathname.endsWith('index.html') ||
                         url.pathname.endsWith('auth.js') ||
                         url.pathname.endsWith('app.js') ||
                         url.pathname.endsWith('ronda.html') ||
                         url.pathname.endsWith('limpeza.html') ||
                         url.pathname.endsWith('chamado.html') ||
                         url.pathname.endsWith('alojado.html') ||
                         url.pathname.endsWith('dados_iniciais_taboca.json');

  if (isDynamicAsset) {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' }).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      }).catch(() => {
        // Fallback offline do cache (respeitando cada app sem misturar Alojado com Gestão)
        return caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          if (event.request.mode === 'navigate') {
            if (url.pathname.includes('alojado')) return caches.match('alojado.html');
            if (url.pathname.includes('chamado')) return caches.match('chamado.html');
            if (url.pathname.includes('ronda')) return caches.match('ronda.html');
            if (url.pathname.includes('limpeza')) return caches.match('limpeza.html');
            if (url.pathname.includes('guarda')) return caches.match('guarda.html');
            return caches.match('index.html');
          }
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
        if (!response || (response.status !== 200 && response.type !== 'opaque')) return response;
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        return response;
      });
    })
  );
});
