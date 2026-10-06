/**
 * A minimal static server for `dist`, so the built extension can be loaded in
 * an ordinary browser for checks that the dev server (which serves source)
 * cannot answer.
 *
 * Extension pages cannot be opened over `file://` — module scripts are blocked
 * by CORS there — and the built bundle is the thing that ships, so it is the
 * thing worth loading.
 *
 *   node tools/serve-dist.mjs [root] [port]
 */

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const root = process.argv[2] ?? 'dist'
const port = Number(process.argv[3] ?? 5190)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
  const relative = normalize(path).replace(/^[\\/]+/, '') || 'index.html'

  try {
    const body = await readFile(join(root, relative))
    response.writeHead(200, { 'content-type': TYPES[extname(relative)] ?? 'application/octet-stream' })
    response.end(body)
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`serving ${root} at http://127.0.0.1:${port}/`)
})
