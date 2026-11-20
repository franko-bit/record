const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { parseRecords } = require('../yaml');

test('parses all bundled recording lists', () => {
  const root = path.join(__dirname, '..');
  const files = fs.readdirSync(root).filter(name => /^unit_.*\.yaml$/i.test(name));
  assert.equal(files.length, 17);
  for (const file of files) {
    assert.ok(parseRecords(fs.readFileSync(path.join(root, file), 'utf8')).length > 0, file);
  }
});

test('preserves escaped and apostrophe-quoted text and ignores comments', () => {
  assert.deepEqual(parseRecords([
    'records:',
    '  - "a\\nb" # inline comment',
    "  - 'patient''s words'",
    '  - plain sentence # comment'
  ].join('\n')), ['a\nb', "patient's words", 'plain sentence']);
});

test('parses legacy top-level YAML lists such as project.yaml', () => {
  assert.deepEqual(parseRecords([
    '# --- Project items ---',
    '- "Zero"',
    "- 'Patient''s words'",
    '- Plain sentence # inline comment'
  ].join('\n')), ['Zero', "Patient's words", 'Plain sentence']);
});

test('reports invalid or empty recording lists', () => {
  assert.throws(() => parseRecords('items:\n  - hello'), /records:/);
  assert.throws(() => parseRecords('records:\n  # no items'), /empty/);
  assert.throws(() => parseRecords('records:\n  - "unterminated'), /Invalid quoted string/);
});
