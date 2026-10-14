import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorMessage } from './error-message';

test('Uses the server explanation without the HTTP prefix', () => {
  const reason = Object.assign(new Error('HTTP 400 Bad Request: Wait for your turn.'), { data: { error: 'Wait for your turn.' } });
  assert.equal(errorMessage(reason, 'fallback'), 'Wait for your turn.');
});
test('Strips the HTTP prefix when the body has no error field', () => {
  assert.equal(errorMessage(new Error('HTTP 502 Bad Gateway: Proxy error'), 'fallback'), 'Proxy error');
});
test('Falls back when only a status line or nothing useful is available', () => {
  assert.equal(errorMessage(new Error('HTTP 500 Internal Server Error'), 'Try again.'), 'Try again.');
  assert.equal(errorMessage(Object.assign(new Error('HTTP 500 Internal Server Error'), { data: { error: '  ' } }), 'Try again.'), 'Try again.');
  assert.equal(errorMessage('nope', 'Try again.'), 'Try again.');
});
test('Keeps ordinary error messages, such as network failures', () => {
  assert.equal(errorMessage(new TypeError('Failed to fetch'), 'fallback'), 'Failed to fetch');
});
