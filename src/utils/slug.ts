import { createHash } from 'node:crypto'

/**
 * Converts a spec relative path to a safe directory name.
 * e.g. "cypress/e2e/auth/login.cy.ts" → "cypress-e2e-auth-login-cy-ts"
 * L7: NFKC normalization prevents homoglyph attacks (e.g. ｆｏｏ → foo equivalent)
 * L6: control char stripping prevents null-byte DoS on fs calls
 */
export function specSlug(relative: string): string {
  return relative
    .normalize('NFKC')
    .replace(/[\x00-\x1f\x7f-\x9f]/g, '') // L6: strip C0/C1 control chars incl. null byte
    .replace(/[/\\]/g, '-')
    .replace(/[^a-z0-9-]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 200)
}

/**
 * Converts a test title to a safe filename with a SHA-256 hash suffix to prevent collisions.
 * e.g. "should show error on bad credentials" → "should-show-error-on-bad-creden-a1b2c3d4.html"
 * L7: NFKC normalization applied before hashing so canonically-equivalent titles map to same file.
 * L6: control char stripping prevents null-byte DoS on fs calls.
 */
export function testFilename(title: string): string {
  const normalized = title.normalize('NFKC').replace(/[\x00-\x1f\x7f-\x9f]/g, '')
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 8)
  const safe = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  return `${safe}-${hash}.html`
}
