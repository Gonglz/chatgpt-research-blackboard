import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const pathUrl = (path) => new URL(path, root);
const read = (path) => readFileSync(pathUrl(path), 'utf8');

const manifest = JSON.parse(read('manifest.json'));
const permissions = new Set(manifest.permissions || []);

for (const permission of ['webRequest', 'tabs']) {
  assert.equal(
    permissions.has(permission),
    false,
    `manifest must not request ${permission}`
  );
}

assert.deepEqual(
  [...permissions].sort(),
  ['sidePanel', 'scripting', 'storage'].sort(),
  'manifest permissions should stay at the minimum functional Research Blackboard set'
);

assert.equal(
  existsSync(pathUrl('src/background/auth/token-capture.js')),
  false,
  'legacy background token-capture module must stay deleted'
);
assert.equal(
  existsSync(pathUrl('src/content/auth/token-manager.js')),
  false,
  'legacy content token-manager module must stay deleted'
);
assert.equal(
  existsSync(pathUrl('src/content/index.js')),
  false,
  'legacy Graph Navigator content entrypoint must stay deleted'
);

const tabMessaging = read('src/shared/tab-messaging.js');
assert.equal(
  /chrome\.scripting|executeScript/.test(tabMessaging),
  false,
  'tab messaging must not dynamically inject content scripts as a fallback'
);

const sourceJump = read('src/sidepanel/utils/researchSourceJump.js');
assert.equal(
  /chrome\.scripting\.executeScript/.test(sourceJump),
  true,
  'source navigation currently relies on scripting for exact DOM source location'
);
assert.equal(
  permissions.has('scripting'),
  true,
  'manifest must declare scripting while source navigation uses chrome.scripting.executeScript'
);
assert.equal(
  /jumpToResearchHighlightSource/.test(sourceJump) && /research-blackboard-exact-highlight/.test(sourceJump),
  true,
  'exact Highlight source jump and temporary source highlighting must stay present'
);
assert.equal(
  /chrome\.tabs\.update/.test(sourceJump),
  true,
  'project-aware cross-chat source navigation must stay present'
);

const constants = read('src/shared/constants.js');
assert.equal(
  /\/backend-api\//.test(constants),
  false,
  'shared constants must not expose ChatGPT private backend-api routes'
);
assert.equal(
  /GET_TOKEN_STATUS|CLEAR_TOKEN|TOKEN_UPDATED/.test(constants),
  false,
  'legacy token message types must stay removed'
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

const runtime = read('src/content/research-runtime.js');
assert.equal(
  /loadToken|hasToken|initTokenListener|document\.cookie|authorization/i.test(runtime),
  false,
  'Research Blackboard runtime must not contain credential bootstrap logic'
);
assert.equal(
  /setupFloatingHotkeys|toggleFloatingPanel|toggleClickThrough|toggleLock/.test(runtime),
  false,
  'Research Blackboard runtime must not include the legacy floating-panel hotkey path'
);
assert.equal(
  /navigateToMessage/.test(runtime),
  false,
  'DOM-only runtime must not drive hidden ChatGPT branch navigation'
);

const build = read('build.js');
assert.equal(
  build.includes("entryPoints: ['src/content/research-runtime.js']"),
  true,
  'dist/content.js must be built from the DOM-only Research Blackboard runtime'
);
assert.equal(
  build.includes("entryPoints: ['src/content/index.js']"),
  false,
  'build must not reference the removed legacy content entrypoint'
);

console.log('✓ privacy + source-navigation regression tests passed');
