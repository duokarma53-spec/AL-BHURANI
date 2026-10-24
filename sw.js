/**
 * AL-BURHANI POS — Production Service Worker
 * Version: albhurani-pos-v3
 * 
 * Safety & Integrity Constraints:
 * 1. NEVER cache sensitive user authentication data or login tokens.
 * 2. NEVER cache sales transactions, orders, customer records, or financial entries.
 * 3. NEVER cache Turso database or remote API calls (always network-only).
 * 4. Only cache static app shell assets (HTML, JS, CSS, fonts, brand icons).
 * 5. Navigation requests use network-first with offline app shell fallback.
 */

const CACHE_NAME = 'albhurani-pos-v3';

const STATIC_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
];

// Handle direct skipWaiting message from client
self.addEventListener('message', (event) => {
  if (event.data && (event.data.type === 'SKIP_WAITING' || event.data === 'skipWaiting')) {
    self.skipWaiting();
  }
});

// Install: Pre-cache static shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(STATIC_SHELL_ASSETS);
      })
      .then(() => self.skipWaiting())
      .catch((err) => {
        console.warn('[SW] Pre-caching static assets failed:', err);
      })
  );
});

// Activate: Purge obsolete caches and claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((name) => {
            if (name !== CACHE_NAME) {
              console.log('[SW] Purging old cache:', name);
              return caches.delete(name);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch: Safe routing policy
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // 1. Pass-through for non-GET methods (POST, PUT, DELETE, etc.)
  if (request.method !== 'GET') {
    return;
  }

  // 2. Pass-through for database / remote API / auth / analytics endpoints (NEVER CACHE)
  const isRemoteApiOrDb = 
    url.hostname.includes('turso.io') ||
    url.pathname.startsWith('/api') ||
    url.pathname.includes('/api/') ||
    url.pathname.includes('/auth') ||
    url.protocol === 'libsql:' ||
    url.protocol === 'ws:' ||
    url.protocol === 'wss:';

  if (isRemoteApiOrDb) {
    return;
  }

  // 3. Navigation requests (HTML documents) -> Network-First with cached app shell fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone.clone());
              cache.put('/index.html', responseClone);
            });
          }
          return networkResponse;
        })
        .catch(async () => {
          const cachedApp = await caches.match('/index.html');
          return cachedApp || caches.match('/') || Response.error();
        })
    );
    return;
  }

  // 4. Static build assets (Vite hashed bundles, JS, CSS, fonts, SVG/PNG icons)
  // Stale-While-Revalidate for cached static assets
  if (
    url.origin === self.location.origin ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com')
  ) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          // Fetch updated version in background for non-hashed assets
          fetch(request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse));
              }
            })
            .catch(() => {});
          return cachedResponse;
        }

        return fetch(request).then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse;
          }
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          return networkResponse;
        });
      })
    );
  }
});
