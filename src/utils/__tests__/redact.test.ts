import { describe, it, expect } from 'vitest'
import { redactSecrets } from '../redact.js'

describe('redactSecrets', () => {
  it('redacts standard JWT (header.payload.signature)', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjF9.abc123def456'
    expect(redactSecrets(`Bearer ${jwt}`)).toContain('[jwt-redacted]')
    expect(redactSecrets(`Bearer ${jwt}`)).not.toContain(jwt)
  })

  it('redacts unsigned JWT (empty signature segment)', () => {
    const jwt = 'eyJhbGciOiJub25lIn0.eyJ1c2VySWQiOjF9.'
    const result = redactSecrets(`received ${jwt} in response`)
    expect(result).toContain('[jwt-redacted]')
    expect(result).not.toContain('eyJ1c2VySWQiOjF9')
  })

  it('redacts JWT without signature segment at all', () => {
    const jwt = 'eyJhbGciOiJub25lIn0.eyJ1c2VySWQiOjF9'
    const result = redactSecrets(`found ${jwt} leaked`)
    expect(result).toContain('[jwt-redacted]')
    expect(result).not.toContain(jwt)
  })

  it('redacts JSON-formatted secrets ("password":"secret123")', () => {
    const input = '{"password":"secret123","user":"admin"}'
    const result = redactSecrets(input)
    expect(result).toContain('"password":"[redacted]"')
    expect(result).not.toContain('secret123')
    expect(result).toContain('"user":"admin"')
  })

  it.each(['token', 'credential', 'passwd', 'auth', 'key', 'secret', 'bearer'])(
    'redacts JSON secret with key "%s"',
    (key) => {
      const input = `{"${key}":"longvalue99"}`
      const result = redactSecrets(input)
      expect(result).toContain(`"${key}":"[redacted]"`)
    },
  )

  it('redacts key=value secret pairs (password=abc)', () => {
    const result = redactSecrets('password=SuperSecret123')
    expect(result).toContain('password=[redacted]')
    expect(result).not.toContain('SuperSecret123')
  })

  it('redacts key: value secret pairs (token: xyz)', () => {
    const result = redactSecrets('token: abc-xyz-secret')
    expect(result).toContain('token: [redacted]')
    expect(result).not.toContain('abc-xyz-secret')
  })

  it('redacts short 3-char secret values', () => {
    const result = redactSecrets('password=ab3')
    expect(result).toContain('password=[redacted]')
    expect(result).not.toContain('ab3')
  })

  it('redacts Bearer authorization headers', () => {
    const result = redactSecrets('Authorization: Bearer eyAbCdEf1234567890')
    expect(result).toContain('Bearer [redacted]')
    expect(result).not.toContain('eyAbCdEf1234567890')
  })

  it('redacts Bearer headers containing = chars', () => {
    const result = redactSecrets('Bearer abc123+def/ghi==jkl.mno')
    expect(result).toContain('Bearer [redacted]')
  })

  it.each([
    ['postgres', 'postgresql://user:pass@localhost:5432/db'],
    ['mysql', 'mysql://root:secret@db.host:3306/app'],
    ['mongodb', 'mongodb://admin:pass@mongo:27017/test'],
    ['mongodb+srv', 'mongodb+srv://admin:pass@cluster0.example.net/mydb'],
    ['redis', 'redis://default:pass@host:6379/0'],
    ['rediss', 'rediss://default:pass@host:6380/0'],
    ['amqp', 'amqp://guest:guest@rabbit:5672/vhost'],
    ['amqps', 'amqps://user:pass@rabbit:5671/vhost'],
    ['mssql', 'mssql://sa:pass@sqlserver:1433/master'],
  ])('redacts %s connection string', (_name, connStr) => {
    const result = redactSecrets(`DB: ${connStr}`)
    expect(result).toContain('[connection-string-redacted]')
    expect(result).not.toContain(connStr)
  })

  it('passes normal text through unchanged', () => {
    const input = 'AssertionError: expected 42 to equal 43'
    expect(redactSecrets(input)).toBe(input)
  })
})
