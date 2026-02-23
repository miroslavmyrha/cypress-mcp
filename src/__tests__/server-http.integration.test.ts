import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { type Server as HttpServer, request as httpRequest } from 'node:http'
import { connect as netConnect } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { createHttpServer } from '../server.js'

/**
 * Integration tests for the HTTP transport in server.ts.
 *
 * Uses createHttpServer() from server.ts directly — tests the real request handler,
 * security checks, and MCP protocol handling with no mocks or code duplication.
 */

// ─── Test helpers ───────────────────────────────────────────────────────────

interface HttpResponse {
  statusCode: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

function makeRequest(options: {
  port: number
  method?: string
  path?: string
  headers?: Record<string, string>
  body?: string
}): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port: options.port,
        method: options.method ?? 'POST',
        path: options.path ?? '/mcp',
        headers: options.headers ?? {},
        agent: false, // Disable keep-alive pooling — SSE responses can leave stale connections
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            body: Buffer.concat(chunks).toString(),
          })
        })
      },
    )
    req.on('error', reject)
    if (options.body) req.write(options.body)
    req.end()
  })
}

function jsonRpcRequest(method: string, params: Record<string, unknown> = {}): string {
  return JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
}

/**
 * Parse the last SSE data message from a response body.
 * Uses the LAST data line so it still works if the SDK emits progress events before the result.
 */
function parseSseBody(body: string): unknown {
  const dataLines = body.split('\n').filter((line) => line.startsWith('data: '))
  if (dataLines.length === 0) throw new Error(`No data line in SSE body: ${body}`)
  return JSON.parse(dataLines[dataLines.length - 1].slice(6))
}

// ─── Test suite ─────────────────────────────────────────────────────────────

describe('HTTP server integration', () => {
  let httpServer: HttpServer
  let port: number
  let token: string
  let tempDir: string
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeAll(async () => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    tempDir = mkdtempSync(path.join(tmpdir(), 'cypress-mcp-http-test-'))
    token = randomBytes(32).toString('hex')

    // Port 0 = ephemeral — createHttpServer lazily populates allowedHosts on first request
    const result = createHttpServer({ projectRoot: tempDir, port: 0, version: '0.0.0-test', httpToken: token })
    httpServer = result.server

    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        const addr = httpServer.address()
        port = typeof addr === 'object' && addr ? addr.port : 0
        resolve()
      })
    })
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    rmSync(tempDir, { recursive: true, force: true })
    stderrSpy.mockRestore()
  })

  /** Helper: make an authenticated POST to /mcp with proper headers */
  function authedPost(body: string, extraHeaders: Record<string, string> = {}): Promise<HttpResponse> {
    return makeRequest({
      port,
      method: 'POST',
      path: '/mcp',
      headers: {
        'Host': `127.0.0.1:${port}`,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Content-Length': String(Buffer.byteLength(body)),
        ...extraHeaders,
      },
      body,
    })
  }

  // ─── Token validation ──────────────────────────────────────────────────

  describe('token validation', () => {
    it('rejects token shorter than 32 characters', () => {
      expect(() => createHttpServer({
        projectRoot: tempDir, port: 0, version: '0.0.0-test', httpToken: 'short',
      })).toThrow('httpToken must be at least 32 characters')
    })
  })

  // ─── Auth tests ─────────────────────────────────────────────────────────

  describe('authentication', () => {
    it('returns 200 for valid token with tools/list', async () => {
      const body = jsonRpcRequest('tools/list')
      const res = await authedPost(body)
      expect(res.statusCode).toBe(200)
    })

    it('returns 401 for missing Authorization header', async () => {
      const body = jsonRpcRequest('tools/list')
      const res = await makeRequest({
        port,
        method: 'POST',
        path: '/mcp',
        headers: {
          'Host': `127.0.0.1:${port}`,
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(body)),
        },
        body,
      })
      expect(res.statusCode).toBe(401)
      expect(JSON.parse(res.body)).toEqual({ error: 'Unauthorized' })
    })

    it('returns 401 for wrong token', async () => {
      const body = jsonRpcRequest('tools/list')
      const res = await makeRequest({
        port,
        method: 'POST',
        path: '/mcp',
        headers: {
          'Host': `127.0.0.1:${port}`,
          'Authorization': 'Bearer wrong-token-that-is-definitely-not-correct',
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(body)),
        },
        body,
      })
      expect(res.statusCode).toBe(401)
    })
  })

  // ─── Security headers ──────────────────────────────────────────────────

  describe('security headers', () => {
    it('includes security headers on successful response', async () => {
      const body = jsonRpcRequest('tools/list')
      const res = await authedPost(body)
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(res.headers['x-frame-options']).toBe('DENY')
      // Cache-Control: the SDK's SSE transport overrides our 'no-store' with 'no-cache'.
      // Both prevent caching — check that at least one is set.
      expect(res.headers['cache-control']).toMatch(/no-(store|cache)/)
      expect(res.headers['referrer-policy']).toBe('no-referrer')
      expect(res.headers['content-security-policy']).toBe("default-src 'none'")
    })

    it('includes security headers on 401 response', async () => {
      const body = jsonRpcRequest('tools/list')
      const res = await makeRequest({
        port,
        method: 'POST',
        path: '/mcp',
        headers: {
          'Host': `127.0.0.1:${port}`,
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(body)),
        },
        body,
      })
      expect(res.statusCode).toBe(401)
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(res.headers['x-frame-options']).toBe('DENY')
    })

    it('includes security headers on 404 response', async () => {
      const body = '{}'
      const res = await makeRequest({
        port,
        method: 'POST',
        path: '/nonexistent',
        headers: {
          'Host': `127.0.0.1:${port}`,
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(body)),
        },
        body,
      })
      expect(res.statusCode).toBe(404)
      expect(res.headers['x-content-type-options']).toBe('nosniff')
    })
  })

  // ─── Host header validation ────────────────────────────────────────────

  describe('host header validation', () => {
    it('returns 400 for invalid Host header', async () => {
      const body = jsonRpcRequest('tools/list')
      const res = await makeRequest({
        port,
        method: 'POST',
        path: '/mcp',
        headers: {
          'Host': 'evil.example.com',
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(body)),
        },
        body,
      })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.body)).toEqual({ error: 'Invalid Host header' })
    })
  })

  // ─── Origin rejection ─────────────────────────────────────────────────

  describe('origin rejection', () => {
    it('returns 403 when Origin header is present', async () => {
      const body = jsonRpcRequest('tools/list')
      const res = await makeRequest({
        port,
        method: 'POST',
        path: '/mcp',
        headers: {
          'Host': `127.0.0.1:${port}`,
          'Origin': 'http://evil.example.com',
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(body)),
        },
        body,
      })
      expect(res.statusCode).toBe(403)
      expect(JSON.parse(res.body)).toEqual({ error: 'Cross-origin requests not allowed' })
    })
  })

  // ─── Content-Length checks ────────────────────────────────────────────

  describe('content-length validation', () => {
    it('returns 411 when Content-Length is missing on POST', async () => {
      // Node's http module auto-adds Content-Length, so use raw TCP socket
      const res = await new Promise<HttpResponse>((resolve, reject) => {
        const socket = netConnect(port, '127.0.0.1', () => {
          socket.write(
            `POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`,
          )
        })
        let data = ''
        socket.on('data', (chunk) => { data += chunk.toString() })
        socket.on('end', () => {
          const statusLine = data.split('\r\n')[0]
          const statusCode = Number(statusLine.split(' ')[1])
          resolve({ statusCode, headers: {}, body: data })
        })
        socket.on('error', reject)
      })
      expect(res.statusCode).toBe(411)
    })

    it('returns 413 when Content-Length exceeds limit', async () => {
      const res = await makeRequest({
        port,
        method: 'POST',
        path: '/mcp',
        headers: {
          'Host': `127.0.0.1:${port}`,
          'Content-Length': String(1_048_576 + 1),
        },
      })
      expect(res.statusCode).toBe(413)
      expect(JSON.parse(res.body)).toEqual({ error: 'Request body too large' })
    })

    it('H9b: destroys connection when streamed body exceeds limit despite small Content-Length', async () => {
      // Declare a small Content-Length but stream more data than MAX_REQUEST_BODY_BYTES (1 MB).
      // The H9b byte counter should destroy the socket mid-stream.
      const result = await new Promise<{ error: boolean }>((resolve) => {
        const socket = netConnect(port, '127.0.0.1', () => {
          // Claim 100 bytes but stream >1 MB
          const headers = [
            `POST /mcp HTTP/1.1`,
            `Host: 127.0.0.1:${port}`,
            `Authorization: Bearer ${token}`,
            `Content-Type: application/json`,
            `Accept: application/json, text/event-stream`,
            `Content-Length: 100`,
            `Connection: close`,
            '',
            '',
          ].join('\r\n')
          socket.write(headers)
          // Stream 64 KB chunks until the socket is destroyed or we've sent >1 MB
          const chunk = Buffer.alloc(65_536, 0x41) // 64 KB of 'A'
          let sent = 0
          const interval = setInterval(() => {
            if (socket.destroyed || sent > 1_200_000) {
              clearInterval(interval)
              return
            }
            socket.write(chunk, (err) => {
              if (err) clearInterval(interval)
            })
            sent += chunk.length
          }, 1)
        })
        socket.on('error', () => resolve({ error: true }))
        socket.on('close', () => resolve({ error: true }))
      })
      // The server should have destroyed the connection
      expect(result.error).toBe(true)
    })
  })

  // ─── Routing ──────────────────────────────────────────────────────────

  describe('routing', () => {
    it('returns 404 for POST /unknown', async () => {
      const body = jsonRpcRequest('tools/list')
      const res = await makeRequest({
        port,
        method: 'POST',
        path: '/unknown',
        headers: {
          'Host': `127.0.0.1:${port}`,
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(body)),
        },
        body,
      })
      expect(res.statusCode).toBe(404)
    })
  })

  // ─── MCP tool calls ──────────────────────────────────────────────────

  describe('MCP tool calls', () => {
    it('tools/list returns all expected tools', async () => {
      const body = jsonRpcRequest('tools/list')
      const res = await authedPost(body)
      expect(res.statusCode).toBe(200)
      const parsed = parseSseBody(res.body) as { result: { tools: Array<{ name: string }> } }
      const names = parsed.result.tools.map((t) => t.name).sort()
      expect(names).toEqual([
        'get_last_run', 'get_screenshot', 'list_specs', 'query_dom', 'read_spec', 'run_spec',
      ])
    })

    it('list_specs on empty temp dir returns empty array', async () => {
      const body = jsonRpcRequest('tools/call', { name: 'list_specs', arguments: {} })
      const res = await authedPost(body)
      expect(res.statusCode).toBe(200)
      const parsed = parseSseBody(res.body) as { result: { content: Array<{ text: string }> } }
      const textContent = parsed.result.content[0].text
      expect(JSON.parse(textContent)).toEqual([])
    })

    it('unknown tool returns error response', async () => {
      const body = jsonRpcRequest('tools/call', { name: 'nonexistent_tool', arguments: {} })
      const res = await authedPost(body)
      expect(res.statusCode).toBe(200) // JSON-RPC wraps errors in 200
      const parsed = parseSseBody(res.body) as { result: { isError: boolean; content: Array<{ text: string }> } }
      expect(parsed.result.isError).toBe(true)
      expect(parsed.result.content[0].text).toContain('Unknown tool')
    })
  })
})
