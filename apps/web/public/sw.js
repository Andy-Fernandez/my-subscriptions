const offlinePage = `<!doctype html>
<html lang="es">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#e5eef7">
<title>Sin conexión · Suscripciones</title>
<style>
  body { display: grid; place-items: center; min-height: 100vh; margin: 0; background: #e5eef7; color: #19283e; font: 1rem/1.5 system-ui, sans-serif; }
  main { max-width: 24rem; margin: 1rem; padding: 1.5rem; border-radius: 1.25rem; border: 1px solid #cbd8e8; background: #fff; }
  strong { color: #a93d39; }
  h1 { margin: .25rem 0; }
  a { display: inline-block; padding: .6rem .9rem; border-radius: .5rem; background: #a93d39; color: #fff; }
</style>
<main>
  <strong>Suscripciones</strong>
  <h1>Sin conexión</h1>
  <p>Conéctate a internet para consultar tus suscripciones y registrar movimientos.</p>
  <a href="/">Volver a intentar</a>
</main>
</html>`

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.mode !== 'navigate' || event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return
  event.respondWith(fetch(event.request).catch(() => new Response(offlinePage, {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    },
  })))
})
