import { describe, it, expect } from 'vitest'
import { safeStringify } from '../safe-stringify.js'

describe('safeStringify — M7 circular reference protection', () => {
  it('returns JSON string for plain serializable values', () => {
    expect(safeStringify({ a: 1, b: 'x' })).toBe('{"a":1,"b":"x"}')
  })

  it('returns [Unserializable] for circular references (Vue proxy / React fiber protection)', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(safeStringify(circular)).toBe('[Unserializable]')
  })

  it('does not throw — always returns a string', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => safeStringify(circular)).not.toThrow()
    expect(typeof safeStringify(circular)).toBe('string')
  })
})
