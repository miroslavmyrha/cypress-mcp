export const LAST_RUN_FILE = '.cypress-mcp/last-run.json'
export const OUTPUT_DIR_NAME = '.cypress-mcp'
export const SNAPSHOTS_SUBDIR = 'snapshots'
export const MAX_LAST_RUN_BYTES = 5 * 1_024 * 1_024 // 5 MB
export const REDACT_COMMANDS = new Set([
  'type', 'clear', 'request', 'setCookie', 'session', 'invoke', 'its',
])

// ─── Spec file extensions ────────────────────────────────────────────────────
// Single source of truth for supported Cypress spec extensions.
// Used by list-specs (glob), read-spec (extension check), and run-spec (regex).
export const SPEC_EXTENSIONS = [
  '.cy.ts', '.cy.js', '.cy.tsx', '.cy.jsx',
  '.spec.ts', '.spec.js', '.spec.tsx', '.spec.jsx',
]
export const SPEC_EXTENSION_RE = /\.(cy|spec)\.(ts|js|tsx|jsx)$/
export const DEFAULT_SPEC_PATTERNS = [
  '**/*.cy.ts', '**/*.cy.js', '**/*.cy.tsx', '**/*.cy.jsx',
  '**/*.spec.ts', '**/*.spec.js', '**/*.spec.tsx', '**/*.spec.jsx',
]

// ─── Shared messages ────────────────────────────────────────────────────────
export const NO_RESULTS_MESSAGE = 'No test results yet. Run Cypress tests first (cypress open or cypress run).'

// ─── Valid transports ───────────────────────────────────────────────────────
export const VALID_TRANSPORTS = ['stdio', 'http'] as const
export type TransportType = (typeof VALID_TRANSPORTS)[number]

// ─── Shared validation limits ────────────────────────────────────────────────
// Used across arg-schemas.ts, plugin/index.ts, and support/index.ts Zod schemas
export const MAX_TEST_TITLE_LENGTH = 500
export const MAX_SPEC_PATH_LENGTH = 2_048
export const MAX_SELECTOR_LENGTH = 512
export const MAX_MESSAGE_LENGTH = 1_000
export const MAX_URL_LENGTH = 2_048
export const MAX_COMMANDS_PER_TEST = 200
