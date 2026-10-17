import assert from 'node:assert/strict';

import {
  normalizeSelection,
  toggleSelection,
  primaryIndex,
  hasIndex,
} from '../src/selection.js';

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${name}: ${err.message}`);
  }
}

check('normalizeSelection sorts, dedupes and drops indices past the scene', () => {
  assert.deepEqual(normalizeSelection([5, 1, 1, 9], 4), [1]);
});

check('normalizeSelection drops negatives', () => {
  assert.deepEqual(normalizeSelection([-1, 0, 2], 3), [0, 2]);
});

check('toggleSelection adds an absent index', () => {
  assert.deepEqual(toggleSelection([0, 2], 1), [0, 1, 2]);
});

check('toggleSelection removes a present index', () => {
  assert.deepEqual(toggleSelection([0, 1, 2], 1), [0, 2]);
});

check('primaryIndex is -1 when empty and the last index otherwise', () => {
  assert.equal(primaryIndex([]), -1);
  assert.equal(primaryIndex([0, 3]), 3);
});

check('hasIndex reports membership', () => {
  assert.equal(hasIndex([0, 2], 2), true);
  assert.equal(hasIndex([], 0), false);
});

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
