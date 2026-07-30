const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs
  .readFileSync(path.join(__dirname, '../src/renderer/overlay.html'), 'utf8')
  .replaceAll('\r\n', '\n');
const css = fs.readFileSync(path.join(__dirname, '../src/renderer/overlay.css'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../src/renderer/overlay.js'), 'utf8');

test('annotation popovers live outside the toolbar coordinate context', () => {
  const toolbarStart = html.indexOf('<div class="toolbar"');
  const toolbarEnd = html.indexOf(
    '\n    </div>\n\n    <div class="popover color-popover"',
    toolbarStart,
  );
  assert.ok(toolbarStart >= 0 && toolbarEnd > toolbarStart);
  const toolbarMarkup = html.slice(toolbarStart, toolbarEnd);
  assert.doesNotMatch(toolbarMarkup, /id="color-popover"/);
  assert.doesNotMatch(toolbarMarkup, /id="size-popover"/);
  assert.match(css, /\.popover\s*{[\s\S]*?position:\s*fixed;[\s\S]*?z-index:\s*60;/);
});

test('custom color uses a visual in-app color field that stays above the capture overlay', () => {
  assert.match(html, /id="custom-color-button"[\s\S]*?aria-expanded="false"/);
  assert.match(html, /id="custom-color-button"[\s\S]*?class="custom-color-rainbow"/);
  assert.match(html, /id="custom-color-panel"[\s\S]*?id="custom-color-field"[\s\S]*?id="custom-color-hue"[\s\S]*?id="custom-color-hex"/);
  assert.doesNotMatch(html, /type="color"/);
  assert.match(css, /\.custom-color-field\s*{[\s\S]*?linear-gradient\(to top, #000, transparent\)/);
  assert.match(css, /\.custom-color-rainbow\s*{[\s\S]*?conic-gradient\(/);
  assert.match(script, /function hsvToHex\(/);
  assert.match(script, /function setCustomColorFromPointer\(/);
  assert.doesNotMatch(script, /\.showPicker\(/);
});

test('color selection ring follows the circular swatch and pointer opening does not steal focus', () => {
  assert.match(css, /button\[data-color\]\.is-selected::before\s*{[\s\S]*?var\(--primary-bright\)/);
  assert.doesNotMatch(script, /popover\.querySelector\('button, input'\)\?\.focus\(\)/);
});

test('popover clamping uses the actual CSS viewport', () => {
  assert.match(script, /const viewportWidth = document\.documentElement\.clientWidth/);
  assert.match(script, /const viewportHeight = document\.documentElement\.clientHeight/);
});
