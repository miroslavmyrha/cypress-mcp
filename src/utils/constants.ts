export const LAST_RUN_FILE = '.cypress-mcp/last-run.json'
export const OUTPUT_DIR_NAME = '.cypress-mcp'
export const SNAPSHOTS_SUBDIR = 'snapshots'
export const MAX_LAST_RUN_BYTES = 50 * 1_024 * 1_024 // 50 MB
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

// ─── Shared validation limits ────────────────────────────────────────────────
// Used across arg-schemas.ts and plugin/index.ts Zod schemas
export const MAX_TEST_TITLE_LENGTH = 500
export const MAX_SPEC_PATH_LENGTH = 2_048
export const MAX_SELECTOR_LENGTH = 512
