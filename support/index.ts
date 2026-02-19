/// <reference types="cypress" />
// cypress-mcp support — browser side
// Import in cypress/support/e2e.ts:
//   import 'cypress-mcp/support'
import { safeStringify } from '../src/utils/safe-stringify.js'

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
const MAX_URL_LENGTH = 2_000 // L5: cap network error URLs

const commandLog: CommandEntry[] = []
let consoleErrors: string[] = []
let networkErrors: NetworkError[] = []


Cypress.on('log:added', (log: { name: string; message?: string }) => {
  if (!SKIP_COMMANDS.has(log.name)) {
    commandLog.push({ name: log.name, message: log.message ?? '' })
  }
})

Cypress.on('window:before:load', (win) => {
  const origError = win.console.error.bind(win.console)
  win.console.error = (...args: unknown[]) => {
    origError(...args)
    if (consoleErrors.length < MAX_CONSOLE_ERRORS) {
      // M7: truncate each arg individually to bound peak memory before joining
      const msg = args
        .map((a) => (typeof a === 'string' ? a : safeStringify(a)).slice(0, MAX_ERROR_MESSAGE_LENGTH))
        .join(' ')
        .slice(0, MAX_ERROR_MESSAGE_LENGTH)
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
      const msg = `Unhandled rejection: ${reason}`
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
          url: req.url.slice(0, MAX_URL_LENGTH), // L5: prevent unbounded URL storage
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
      const domSnapshot =
        raw.length > DOM_SNAPSHOT_MAX_BYTES
          ? `${raw.slice(0, DOM_SNAPSHOT_MAX_BYTES)}<!-- truncated -->`
          : raw

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
