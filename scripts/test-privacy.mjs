import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const manifest = JSON.parse(read('manifest.json'));
const permissions = new Set(manifest.permissions || []);

assert.equal(
  permissions.has('webRequest'),
  false,
  'manifest must not request webRequest after token capture removal'
);

const tokenCapture = read('src/background/auth/token-capture.js');
assert.equal(
  tokenCapture.includes('chrome.webRequest'),
  false,
  'background auth compatibility code must not register webRequest listeners'
);
assert.equal(
  /requestHeaders|onSendHeaders/.test(tokenCapture),
  false,
  'background auth compatibility code must not inspect request headers'
);

const tokenManager = read('src/content/auth/token-manager.js');
assert.equal(
  tokenManager.includes('document.cookie'),
  false,
  'content auth compatibility code must not read ChatGPT cookies'
);
assert.equal(
  /authorization\s*['"\]]?\s*[:=]/i.test(tokenManager),
  false,
  'content auth compatibility code must not construct authorization headers'
);

const conversation = read('src/content/api/conversation.js');
assert.equal(
  /\/backend-api\//.test(conversation),
  false,
  'conversation bootstrap must not call ChatGPT internal backend-api endpoints'
);
assert.equal(
  /\bfetch\s*\(/.test(conversation),
  false,
  'conversation bootstrap must be DOM-only and make no network fetches'
);

console.log('✓ privacy boundary regression tests passed');
