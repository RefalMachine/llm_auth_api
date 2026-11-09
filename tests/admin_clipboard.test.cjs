const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../templates/admin.html'), 'utf8');
const source = html.slice(html.indexOf('function copyKeyFallback('), html.indexOf('let availableModels'));

function setup({clipboard, fallback = true, fallbackThrows = false} = {}) {
  const calls = {fallback: 0, removed: 0, restoredFocus: 0, prompts: [], flashes: [], timers: []};
  const key = 'full-key-with-\'quotes"-and-<markup>-beyond-the-preview';
  const btn = {textContent: 'Copy key', disabled: false};
  let textarea;
  const context = vm.createContext({
    navigator: {clipboard},
    document: {
      activeElement: {focus() {calls.restoredFocus++;}},
      createElement() {
        textarea = {
          style: {},
          focus() {},
          select() {},
          setSelectionRange(start, end) {calls.selection = [start, end];},
          remove() {calls.removed++;},
        };
        return textarea;
      },
      body: {appendChild() {}},
      execCommand(command) {
        assert.equal(command, 'copy');
        assert.equal(textarea.value, key);
        calls.fallback++;
        if (fallbackThrows) throw new Error('Copy blocked');
        return fallback;
      },
    },
    window: {prompt(message, value) {calls.prompts.push(value);}},
    flash(message, ok) {calls.flashes.push(ok);},
    setTimeout(callback) {calls.timers.push(callback);},
  });
  vm.runInContext(source, context);
  return {calls, key, btn, copy: () => context.copyKey(key, btn)};
}

test('copies the full key through Clipboard API and restores the button', async () => {
  let written;
  const h = setup({clipboard: {writeText: async key => {written = key;}}});
  await h.copy();
  assert.equal(written, h.key);
  assert.equal(h.calls.fallback, 0);
  assert.equal(h.btn.textContent, 'Copied!');
  assert.equal(h.btn.disabled, true);
  h.calls.timers[0]();
  assert.equal(h.btn.textContent, 'Copy key');
  assert.equal(h.btn.disabled, false);
});

for (const [name, clipboard] of [
  ['missing API (HTTP)', undefined],
  ['missing writeText method', {}],
  ['rejected writeText', {writeText: () => Promise.reject(new Error('Denied'))}],
  ['synchronously throwing writeText', {writeText() {throw new Error('Denied');}}],
]) {
  test(`${name}: falls back and cleans up`, async () => {
    const h = setup({clipboard});
    await h.copy();
    assert.equal(h.calls.fallback, 1);
    assert.equal(h.calls.removed, 1);
    assert.equal(h.calls.restoredFocus, 1);
    assert.deepEqual(h.calls.selection, [0, h.key.length]);
    assert.equal(h.btn.textContent, 'Copied!');
    assert.deepEqual(h.calls.prompts, []);
  });
}

for (const fallbackThrows of [false, true]) {
  test(`failed fallback (${fallbackThrows ? 'exception' : 'false'}): offers manual copy without claiming success`, async () => {
    const h = setup({fallback: false, fallbackThrows});
    await h.copy();
    assert.equal(h.btn.textContent, 'Copy key');
    assert.equal(h.btn.disabled, false);
    assert.deepEqual(h.calls.prompts, [h.key]);
    assert.deepEqual(h.calls.flashes, [false]);
    assert.equal(h.calls.removed, 1);
    assert.equal(h.calls.restoredFocus, 1);
    assert.equal(h.calls.timers.length, 0);
  });
}

test('repeated clicks do not copy twice or lose the original label', async () => {
  let resolve;
  let writes = 0;
  const h = setup({clipboard: {writeText() {
    writes++;
    return new Promise(done => {resolve = done;});
  }}});
  const pending = h.copy();
  await h.copy();
  assert.equal(writes, 1);
  resolve();
  await pending;
  await h.copy();
  assert.equal(writes, 1);
  h.calls.timers[0]();
  assert.equal(h.btn.textContent, 'Copy key');
  assert.equal(h.btn.disabled, false);
});
