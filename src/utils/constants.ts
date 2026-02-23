export const LAST_RUN_FILE = '.cypress-mcp/last-run.json'
export const OUTPUT_DIR_NAME = '.cypress-mcp'
export const SNAPSHOTS_SUBDIR = 'snapshots'
export const MAX_LAST_RUN_BYTES = 50 * 1_024 * 1_024 // 50 MB
export const REDACT_COMMANDS = new Set([
  'type', 'clear', 'request', 'setCookie', 'session', 'invoke', 'its',
])
