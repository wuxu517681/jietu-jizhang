function isDocumentRequest(request) {
  return (
    request.method === 'GET' &&
    (request.headers.get('accept') || '').includes('text/html')
  )
}

export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request)

    if (response.status !== 404 || !isDocumentRequest(request)) {
      return response
    }

    const fallbackUrl = new URL('/index.html', request.url)
    return env.ASSETS.fetch(new Request(fallbackUrl, request))
  },
}
