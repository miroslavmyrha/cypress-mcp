// M7: safe JSON serialization for values that may contain circular references.
// Vue reactive proxies, React fibers, and complex browser objects can cause
// JSON.stringify to throw — this prevents TypeError from crashing the afterEach hook.
// Also handles Symbol/Function/undefined which JSON.stringify returns undefined for (not a string).
export function safeStringify(a: unknown): string {
  try {
    return JSON.stringify(a) ?? '[Unserializable]'
  } catch {
    return '[Unserializable]'
  }
}
