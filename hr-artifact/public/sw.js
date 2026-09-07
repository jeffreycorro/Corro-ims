/* Minimal HR PWA shell. Never cache HTML, the shim, or Netlify functions. */
var CACHE = "corcondev-hr-shell-v1";
var SHELL = [
  "/manifest.json",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-512-maskable.png",
  "/pwa.css",
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(function (cache) {
        return cache.addAll(SHELL);
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              return key !== CACHE;
            })
            .map(function (key) {
              return caches.delete(key);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;

  var url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf("/.netlify/") === 0) return;
  if (SHELL.indexOf(url.pathname) === -1) return;

  event.respondWith(
    caches.match(req).then(function (cached) {
      return cached || fetch(req);
    })
  );
});
