/** Extract a human-readable message from an unknown error value */
export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Extract the Node.js errno code (e.g. 'ENOENT', 'EACCES') from an unknown error */
export function getErrnoCode(err: unknown): string | undefined {
  if (err instanceof Error && 'code' in err) {
    return (err as NodeJS.ErrnoException).code
  }
  return undefined
}
