const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../src/renderer/overlay.html'), 'utf8');
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

test('custom color uses an in-app panel that stays above the capture overlay', () => {
  assert.match(html, /id="custom-color-button"[\s\S]*?aria-expanded="false"/);
  assert.match(html, /id="custom-color-panel"[\s\S]*?id="custom-color-hue"[\s\S]*?id="custom-color-hex"/);
  assert.doesNotMatch(html, /type="color"/);
  assert.match(css, /\.custom-color-panel\s*{[\s\S]*?width:\s*276px;/);
  assert.match(script, /function hslToHex\(/);
  assert.doesNotMatch(script, /\.showPicker\(/);
});
