import test from 'node:test'
import assert from 'node:assert/strict'

import { checkEndpoint } from '../../plugin/src/host/http.js'

const OPEN = { allowedHosts: [], trustedLocalEndpoints: [] }

test('a public https endpoint is accepted', () => {
  const result = checkEndpoint('https://api.anthropic.com/v1', OPEN)
  assert.equal(result.ok, true)
  assert.equal(result.host, 'api.anthropic.com')
})

test('plain http to a public host is refused', () => {
  const result = checkEndpoint('http://api.example.com/v1', OPEN)
  assert.equal(result.ok, false)
  assert.equal(result.category, 'ENDPOINT_NOT_ALLOWED')
  assert.match(result.reason, /plain http/)
})

test('loopback and private addresses need an explicit trusted-local grant', () => {
  for (const url of ['http://127.0.0.1:8080/v1', 'http://localhost:11434/v1', 'http://192.168.1.10:8000/v1', 'http://10.0.0.5/v1', 'http://172.16.4.4/v1', 'http://[::1]:8080/v1']) {
    const refused = checkEndpoint(url, OPEN)
    assert.equal(refused.ok, false, `expected refusal for ${url}`)
    assert.equal(refused.category, 'ENDPOINT_NOT_ALLOWED')
  }
  const trusted = checkEndpoint('http://127.0.0.1:8080/v1', { allowedHosts: [], trustedLocalEndpoints: ['127.0.0.1'] })
  assert.equal(trusted.ok, true)
})

test('an allow list narrows the endpoints that may receive a credential', () => {
  const refused = checkEndpoint('https://api.openai.com/v1', { allowedHosts: ['api.anthropic.com'], trustedLocalEndpoints: [] })
  assert.equal(refused.ok, false)
  assert.match(refused.reason, /not in security.allowedHosts/)

  const accepted = checkEndpoint('https://sub.api.anthropic.com/v1', { allowedHosts: ['api.anthropic.com'], trustedLocalEndpoints: [] })
  assert.equal(accepted.ok, true)
})

test('embedded credentials, query strings and fragments are refused', () => {
  assert.equal(checkEndpoint('https://user:pass@api.example.com/v1', OPEN).ok, false)
  assert.equal(checkEndpoint('https://api.example.com/v1?key=abc', OPEN).ok, false)
  assert.equal(checkEndpoint('https://api.example.com/v1#frag', OPEN).ok, false)
})

test('malformed and non-http URLs are refused with INVALID_ENDPOINT', () => {
  for (const url of ['', '   ', 'not a url', 'ftp://api.example.com', 'file:///etc/passwd', 'api.example.com/v1']) {
    const result = checkEndpoint(url, OPEN)
    assert.equal(result.ok, false, `expected refusal for ${JSON.stringify(url)}`)
    assert.equal(result.category, 'INVALID_ENDPOINT')
  }
})

test('the endpoint host is reported without path or query, for the audit card', () => {
  const result = checkEndpoint('https://api.example.com/some/deep/path/v1', OPEN)
  assert.equal(result.host, 'api.example.com')
  assert.equal(result.url.pathname, '/some/deep/path/v1')
})
