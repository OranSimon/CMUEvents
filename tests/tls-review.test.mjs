import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dispatcherFor, verifiedIntermediate } from '../src/lib/tls.mjs';

const pem = readFileSync(new URL('../config/certificates/incommon-rsa-server-ca-2.pem', import.meta.url), 'utf8');
const fingerprint = '87E01CC4DD0C9D92A3DBD49092FF13F9CD387445CDC57E5B984E1B7721B5B029';

test('missing Eberly intermediate must match reviewed fingerprint and existing trusted root', () => {
  assert.match(verifiedIntermediate(pem, fingerprint, new Date('2026-10-21')), /BEGIN CERTIFICATE/);
  assert.throws(() => verifiedIntermediate(pem, '0'.repeat(64)), /fingerprint/);
  assert.throws(() => verifiedIntermediate(pem, fingerprint, new Date('2033-01-01')), /currently valid/);
  assert.equal(dispatcherFor('unrelated.example'), undefined);
});
