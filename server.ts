import http from 'node:http'
import next from 'next'
import httpProxy from 'http-proxy'

const dev = process.env.NODE_ENV !== 'production'
const hostname = '0.0.0.0'
const port = Number(process.env.PORT || 3000)
const backendUrl = process.env.INTERNAL_ORDER_API_BASE_URL || 'http://backend:8080'

type NextApp = {
    getRequestHandler: () => (request: http.IncomingMessage, response: http.ServerResponse) => void | Promise<void>
    prepare: () => Promise<void>
}

const app = (next as unknown as (options: { dev: boolean; hostname: string; port: number }) => NextApp)({
    dev,
    hostname,
    port,
})
const handle = app.getRequestHandler()
const proxy = httpProxy.createProxyServer({
    target: backendUrl,
    changeOrigin: true,
    ws: true,
})

proxy.on('error', (error, _request, response) => {
    console.error('[order-web proxy]', error)
    if (response instanceof http.ServerResponse && !response.headersSent) {
        response.writeHead(502, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: 'Public service unavailable' }))
    }
})

const isPublicApi = (pathname: string) => pathname === '/api/public' || pathname.startsWith('/api/public/')
const isSocket = (pathname: string) => pathname === '/socket.io' || pathname.startsWith('/socket.io/')

await app.prepare()

const server = http.createServer((request, response) => {
    const pathname = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`).pathname
    if (isPublicApi(pathname) || isSocket(pathname)) {
        proxy.web(request, response)
        return
    }
    void handle(request, response)
})

server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`).pathname
    if (isSocket(pathname)) {
        proxy.ws(request, socket, head)
        return
    }
    socket.destroy()
})

server.listen(port, hostname, () => {
    console.log(`Order web listening on http://${hostname}:${port}; backend proxy: ${backendUrl}`)
})
