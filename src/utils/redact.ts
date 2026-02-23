// Canonical source for secret redaction patterns.
// Used by src/tools/run-spec.ts, src/plugin/index.ts, and src/support/index.ts.

// Fix #4: Relaxed — optional signature segment catches unsigned JWTs and short segments
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)?/g
// Fix #2: JSON-formatted secrets like "password":"secret123" bypass the key=value SECRET_RE
const SECRET_JSON_RE = /"(password|secret|token|key|auth|bearer|passwd|credential)"\s*:\s*"[^"]{3,}"/gi
const SECRET_RE = /(password|secret|token|key|auth|bearer|passwd|credential)(\s*[=:]\s*)["']?[^\s"',}\]]{3,}/gi
const BEARER_HEADER_RE = /\bBearer\s+[A-Za-z0-9_\-/.+=]{10,}/gi
const CONNECTION_STRING_RE = /(?:postgres|mysql|mongo(?:db(?:\+srv)?)?|rediss?|amqps?|mssql)(?:ql)?:\/\/[^\s]+/gi

export function redactSecrets(text: string): string {
  return text
    .replace(JWT_RE, '[jwt-redacted]')
    .replace(SECRET_JSON_RE, '"$1":"[redacted]"')
    .replace(SECRET_RE, '$1$2[redacted]')
    .replace(BEARER_HEADER_RE, 'Bearer [redacted]')
    .replace(CONNECTION_STRING_RE, '[connection-string-redacted]')
}
