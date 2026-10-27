// The phone app's service worker. It exists so the app can be installed to the home screen;
// it caches nothing, so the app and the API always come straight from the PC.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
