import { describe, it, expect } from 'vitest'
import { getErrorMessage, getErrnoCode } from '../errors.js'

describe('getErrorMessage', () => {
  it('returns .message for Error instances', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom')
  })

  it('returns .message for Error subclasses', () => {
    expect(getErrorMessage(new TypeError('bad type'))).toBe('bad type')
  })

  it('returns String() for non-Error values', () => {
    expect(getErrorMessage('string error')).toBe('string error')
    expect(getErrorMessage(42)).toBe('42')
    expect(getErrorMessage(null)).toBe('null')
    expect(getErrorMessage(undefined)).toBe('undefined')
  })
})

describe('getErrnoCode', () => {
  it('returns code from NodeJS.ErrnoException', () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    expect(getErrnoCode(err)).toBe('ENOENT')
  })

  it('returns code from Error with EACCES', () => {
    const err = Object.assign(new Error('EACCES'), { code: 'EACCES' })
    expect(getErrnoCode(err)).toBe('EACCES')
  })

  it('returns undefined for Error without code property', () => {
    expect(getErrnoCode(new Error('plain error'))).toBeUndefined()
  })

  it('returns undefined for non-Error values', () => {
    expect(getErrnoCode('string')).toBeUndefined()
    expect(getErrnoCode(42)).toBeUndefined()
    expect(getErrnoCode(null)).toBeUndefined()
    expect(getErrnoCode(undefined)).toBeUndefined()
  })

  it('returns undefined for plain object with code (not an Error)', () => {
    expect(getErrnoCode({ code: 'ENOENT' })).toBeUndefined()
  })
})
