importScripts('/p/controller/controller.sw.js');

self.addEventListener('fetch', (event) => {
  if (self.$scramjetController && self.$scramjetController.shouldRoute(event)) {
    event.respondWith(self.$scramjetController.route(event));
  }
});
