import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { Buffer } from 'node:buffer'
import { realpathSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = realpathSync.native(dirname(fileURLToPath(import.meta.url)))
const MARKET_PROXY_HOSTS = new Set([
  'polling.finance.naver.com',
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
  'stooq.com',
])

const marketProxyPlugin = () => ({
  name: 'market-proxy',
  configureServer(server) {
    server.middlewares.use('/api/market-proxy', async (request, response) => {
      try {
        if (request.method !== 'GET') {
          response.statusCode = 405
          response.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        const requestUrl = new URL(request.url || '', 'http://localhost')
        const target = new URL(requestUrl.searchParams.get('url') || '')

        if (
          target.protocol !== 'https:'
          || !MARKET_PROXY_HOSTS.has(target.hostname)
          || Boolean(target.username || target.password)
          || (target.port && target.port !== '443')
        ) {
          response.statusCode = 400
          response.end(JSON.stringify({ error: 'Unsupported market data host' }))
          return
        }

        const upstream = await fetch(target, {
          redirect: 'error',
          headers: {
            Accept: 'application/json,text/plain,*/*',
            'User-Agent': 'Mozilla/5.0 (compatible; MyPortfolio/1.0)',
          },
        })
        const body = await upstream.arrayBuffer()

        response.statusCode = upstream.status
        response.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream')
        response.setHeader('Cache-Control', 'no-store')
        response.end(Buffer.from(body))
      } catch {
        response.statusCode = 502
        response.end(JSON.stringify({ error: 'Market data proxy failed' }))
      }
    })
  },
})

// https://vite.dev/config/
export default defineConfig({
  root: projectRoot,
  plugins: [react(), marketProxyPlugin()],
  build: {
    rollupOptions: {
      input: {
        app: 'index.html',
      },
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/firebase/') || id.includes('/node_modules/@firebase/')) return 'firebase'
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/')) return 'react'
          if (id.includes('/node_modules/lucide-react/')) return 'icons'
          return undefined
        },
      },
    },
  },
})
