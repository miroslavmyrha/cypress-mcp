/// <reference types="cypress" />
// cypress-mcp support — browser side
// Import in cypress/support/e2e.ts:
//   import 'cypress-mcp/support'
// M7: safe JSON serialization — inlined to avoid fragile cross-directory import
// (../src/utils/safe-stringify.js only works through tsup bundler, not ts-node)
// Handles Symbol/Function/undefined (JSON.stringify returns undefined, not a string)
function safeStringify(a: unknown): string {
  try {
    return JSON.stringify(a) ?? '[Unserializable]'
  } catch {
    return '[Unserializable]'
  }
}

interface CommandEntry {
  name: string
  message: string
}

interface NetworkError {
  method: string
  url: string
  status: number
}

// Commands that add noise without useful debugging info
const SKIP_COMMANDS = new Set(['server', 'route', 'spy', 'stub', 'log', 'wrap', 'window'])

// DOM snapshot capped to avoid filling Claude's context window
const DOM_SNAPSHOT_MAX_BYTES = 100_000

// Cap error arrays to prevent memory DoS from floods of errors in the app under test
const MAX_CONSOLE_ERRORS = 20
const MAX_NETWORK_ERRORS = 20
const MAX_ERROR_MESSAGE_LENGTH = 500
const MAX_COMMAND_LOG = 500
const MAX_URL_LENGTH = 2_000 // L5: cap network error URLs

// Finding #16: Redact sensitive commands at capture time, not just read time
const REDACT_IN_LOG = new Set(['type', 'clear', 'request', 'setCookie', 'session', 'invoke', 'its'])

// Finding #4: Sanitize DOM snapshots to remove passwords, tokens, CSRF, and script contents
function sanitizeDom(html: string): string {
  return html
    // Redact password input values (order-independent: handles value before or after type)
    // Decode HTML entities in type attribute to prevent bypass via &#112;assword
    .replace(/<input\b[^>]*>/gi, (tag) => {
      const decoded = tag.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
      if (/type\s*=\s*["']?password["']?/i.test(decoded)) {
        return tag.replace(/\bvalue\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/i, 'value="[redacted]"')
      }
      return tag
    })
    // Redact hidden input values (CSRF tokens, etc.) (order-independent)
    .replace(/<input\b[^>]*>/gi, (tag) => {
      const decoded = tag.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
      if (/type\s*=\s*["']?hidden["']?/i.test(decoded)) {
        return tag.replace(/\bvalue\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/i, 'value="[redacted]"')
      }
      return tag
    })
    // Redact textarea content
    .replace(/<textarea\b[^>]*>[\s\S]*?<\/textarea>/gi, '<textarea>[redacted]</textarea>')
    // Redact style tag contents
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '<style>[redacted]</style>')
    // Redact script tag contents
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script>[redacted]</script>')
    // Redact noscript tag contents
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '<noscript>[redacted]</noscript>')
    // Redact data attributes that look like tokens/secrets
    .replace(/\b(data-(?:token|secret|key|auth|api-key|csrf|password|access-token|jwt|session|credential|apikey|private))\s*=\s*["'][^"']*["']/gi, '$1="[redacted]"')
}

// Finding #12: Sanitize URLs that contain sensitive query parameters (including fragment params)
const SENSITIVE_URL_PARAMS = /[?&#](token|access_token|api_key|key|secret|password|auth|authorization|code|session|refresh_token|api-key|apiKey|jwt|credentials|bearer|oauth_token|private_token|passwd|pass|apitoken)[=][^&#]*/gi

function sanitizeUrl(url: string): string {
  return url.replace(SENSITIVE_URL_PARAMS, (match, param) => {
    const separator = match[0] // '?', '&', or '#'
    return `${separator}${param}=[redacted]`
  })
}

// Finding #13: Redact JWTs, connection strings, and other secrets from log messages
// Canonical source: src/utils/redact.ts — inlined due to ts-node constraint
// Fix #4: Relaxed JWT regex — + instead of {10,}, optional signature for alg:none tokens
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)?/g
// Fix #2: JSON-aware pattern catches "password":"secret123" format (must run before general pattern)
const SECRET_JSON_PATTERN = /"(password|secret|token|key|auth|bearer|passwd|credential)"\s*:\s*"[^"]{3,}"/gi
const SECRET_PATTERN = /(password|secret|token|key|auth|bearer|passwd|credential)\s*[=:]\s*["']?[^\s"',}\]]{3,}/gi

const BEARER_HEADER_PATTERN = /\bBearer\s+[A-Za-z0-9_\-/.+=]{10,}/gi
const CONNECTION_STRING_PATTERN = /(?:postgres|mysql|mongo(?:db(?:\+srv)?)?|rediss?|amqps?|mssql)(?:ql)?:\/\/[^\s]+/gi

function redactSecrets(msg: string): string {
  return msg
    .replace(JWT_PATTERN, '[jwt-redacted]')
    .replace(SECRET_JSON_PATTERN, '"$1":"[redacted]"')
    .replace(SECRET_PATTERN, '$1=[redacted]')
    .replace(BEARER_HEADER_PATTERN, 'Bearer [redacted]')
    .replace(CONNECTION_STRING_PATTERN, '[connection-string-redacted]')
}

const commandLog: CommandEntry[] = []
let consoleErrors: string[] = []
let networkErrors: NetworkError[] = []


Cypress.on('log:added', (log: { name: string; message?: string }) => {
  if (!SKIP_COMMANDS.has(log.name) && commandLog.length < MAX_COMMAND_LOG) {
    commandLog.push({
      name: log.name,
      message: REDACT_IN_LOG.has(log.name)
        ? '[redacted]'
        : (log.message ?? '').slice(0, MAX_ERROR_MESSAGE_LENGTH),
    })
  }
})

Cypress.on('window:before:load', (win) => {
  const origError = win.console.error.bind(win.console)
  win.console.error = (...args: unknown[]) => {
    origError(...args)
    if (consoleErrors.length < MAX_CONSOLE_ERRORS) {
      // M7: truncate each arg individually to bound peak memory before joining
      const msg = redactSecrets(
        args
          .map((a) => (typeof a === 'string' ? a : safeStringify(a)).slice(0, MAX_ERROR_MESSAGE_LENGTH))
          .join(' ')
          .slice(0, MAX_ERROR_MESSAGE_LENGTH)
      )
      consoleErrors.push(msg)
    }
  }

  // AUTWindow types don't expose addEventListener — use minimal local interface to avoid DOM lib
  interface WindowLike {
    addEventListener(type: string, listener: (event: { reason?: unknown }) => void): void
  }
  ;(win as unknown as WindowLike).addEventListener('unhandledrejection', (event) => {
    if (consoleErrors.length < MAX_CONSOLE_ERRORS) {
      const reason = event.reason instanceof Error ? event.reason.message : String(event.reason)
      const msg = redactSecrets(`Unhandled rejection: ${reason}`)
      consoleErrors.push(msg.slice(0, MAX_ERROR_MESSAGE_LENGTH))
    }
  })
})

beforeEach(() => {
  commandLog.splice(0) // M1: defensive reset — guards against afterEach being skipped on crash/abort
  consoleErrors = []
  networkErrors = []

  cy.intercept({ url: '**' }, (req) => {
    req.continue((res) => {
      if (res.statusCode >= 400 && networkErrors.length < MAX_NETWORK_ERRORS) {
        networkErrors.push({
          method: req.method,
          url: sanitizeUrl(req.url).slice(0, MAX_URL_LENGTH), // L5: prevent unbounded URL storage
          status: res.statusCode,
        })
      }
    })
  })
})

afterEach(function () {
  const commands = commandLog.splice(0)
  const capturedConsoleErrors = [...consoleErrors]
  const capturedNetworkErrors = [...networkErrors]
  // Use Mocha's this.currentTest (has .state) instead of Cypress.currentTest (no .state in types)
  const failed = this.currentTest?.state === 'failed'
  const testTitle = Cypress.currentTest.titlePath.join(' > ')

  if (failed) {
    cy.document().then((doc) => {
      const raw = doc.body.outerHTML
      const domSnapshot = sanitizeDom(
        raw.length > DOM_SNAPSHOT_MAX_BYTES
          ? `${raw.slice(0, DOM_SNAPSHOT_MAX_BYTES)}<!-- truncated -->`
          : raw
      )

      cy.task(
        'mcpSaveTestLog',
        {
          testTitle,
          commands,
          domSnapshot,
          consoleErrors: capturedConsoleErrors,
          networkErrors: capturedNetworkErrors,
        },
        { log: false },
      )
    })
  } else {
    cy.task(
      'mcpSaveTestLog',
      {
        testTitle,
        commands,
        domSnapshot: null,
        consoleErrors: capturedConsoleErrors,
        networkErrors: capturedNetworkErrors,
      },
      { log: false },
    )
  }
})
