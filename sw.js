const CACHE_NAME = 'screenshot-ledger-v2'
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './ocr/worker.min.js',
  './ocr/tesseract-core-lstm.wasm.js',
  './tessdata/chi_sim.traineddata.gz',
  './tessdata/eng.traineddata.gz',
]

const scopedUrl = (path) => new URL(path, self.registration.scope).href

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME)
    await cache.addAll(CORE_ASSETS.map(scopedUrl))

    const response = await fetch(scopedUrl('./index.html'), { cache: 'no-store' })
    const html = await response.text()
    const buildAssets = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)]
      .map((match) => match[1])
      .filter((path) => !path.startsWith('data:') && !path.startsWith('http'))
      .map(scopedUrl)
    await cache.addAll([...new Set(buildAssets)])
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys
      .filter((key) => key.startsWith('screenshot-ledger-') && key !== CACHE_NAME)
      .map((key) => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request)
        const cache = await caches.open(CACHE_NAME)
        await cache.put(scopedUrl('./index.html'), response.clone())
        return response
      } catch {
        return (await caches.match(scopedUrl('./index.html'))) || Response.error()
      }
    })())
    return
  }

  event.respondWith((async () => {
    const cached = await caches.match(request)
    if (cached) return cached
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME)
      await cache.put(request, response.clone())
    }
    return response
  })())
})
