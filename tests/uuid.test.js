import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from '../src/uuid.js';

test('uses the native UUID method when available', t => {
  t.mock.method(globalThis.crypto, 'randomUUID', () => 'native-uuid');
  assert.equal(randomUUID(), 'native-uuid');
});

test('generates unique RFC 4122 version 4 UUIDs without randomUUID on HTTP', t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  Object.defineProperty(globalThis, 'crypto', {configurable: true, value: {getRandomValues}});
  t.after(() => Object.defineProperty(globalThis, 'crypto', descriptor));
  const ids = Array.from({length: 1000}, () => randomUUID());
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(new Set(ids).size, ids.length);
});
