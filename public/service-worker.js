try {
  importScripts('https://www.gstatic.com/firebasejs/11.6.1/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/11.6.1/firebase-messaging-compat.js');
  firebase.initializeApp({
    apiKey: 'AIzaSyD3X8KecK7b7ZNZWDusNzO9do0IlN-jNQE',
    authDomain: 'football-nine-league.firebaseapp.com',
    projectId: 'football-nine-league',
    storageBucket: 'football-nine-league.firebasestorage.app',
    messagingSenderId: '172532669165',
    appId: '1:172532669165:web:6ff9ddc4b481e938954ae4'
  });
  firebase.messaging();
} catch (error) {
  console.warn('Firebase Messaging could not be initialized', error);
}

const CACHE_NAME = 'fnl-app-v40';
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './fnl-logo.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  // 画面本体は常に最新を優先し、更新後に古い画面が残らないようにする
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || './', self.location.href).href;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      const existing = windowClients.find(client => client.url.startsWith(new URL('./', self.location.href).href));
      if (existing) {
        existing.navigate(targetUrl);
        return existing.focus();
      }
      return clients.openWindow(targetUrl);
    })
  );
});
