import assert from 'node:assert/strict';

import { createHistory } from '../src/history.js';

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

const scene = (n) => Array.from({ length: n }, (_, i) => ({ id: i, position: [i, 0, 0] }));

// Mirrors the app: push() records the state before each mutation, so undo and
// redo are handed the live scene.
function harness(initial = scene(0)) {
  let live = initial;
  const history = createHistory(live);
  return {
    history,
    add(n) {
      history.push(live);
      live = scene(n);
      return live;
    },
    undo() {
      live = history.undo(live);
      return live;
    },
    redo() {
      live = history.redo(live);
      return live;
    },
    get live() {
      return live;
    },
  };
}

check('a fresh history starts with no past and no future', () => {
  const h = createHistory(scene(0));
  assert.equal(h.canUndo(), false);
  assert.equal(h.canRedo(), false);
});

check('undo returns the state that existed before the last change', () => {
  const t = harness();
  t.add(1);
  t.add(2);
  assert.equal(t.undo().length, 1);
});

check('redo replays what undo rolled back', () => {
  const t = harness();
  t.add(1);
  t.add(2);
  t.undo();
  assert.equal(t.redo().length, 2);
});

check('a new change after an undo discards the redo branch', () => {
  const t = harness();
  t.add(1);
  t.add(2);
  t.undo();
  t.add(3);
  assert.equal(t.history.canRedo(), false);
});

check('undo past the beginning returns the initial snapshot', () => {
  const h = createHistory(scene(4));
  assert.equal(h.undo(scene(4)).length, 4);
  assert.equal(h.canUndo(), false);
});

check('redo past the end returns the current state', () => {
  const h = createHistory(scene(1));
  assert.equal(h.redo(scene(1)).length, 1);
});

check('three adds then three undos walks back one state at a time', () => {
  const t = harness();
  t.add(1);
  t.add(2);
  t.add(3);
  assert.equal(t.undo().length, 2);
  assert.equal(t.undo().length, 1);
  assert.equal(t.undo().length, 0);
  assert.equal(t.history.canUndo(), false);
});

check('redo after a full undo returns the same states', () => {
  const t = harness();
  t.add(1);
  t.add(2);
  t.add(3);
  t.undo();
  t.undo();
  t.undo();
  assert.equal(t.redo().length, 1);
  assert.equal(t.redo().length, 2);
  assert.equal(t.redo().length, 3);
  assert.equal(t.history.canRedo(), false);
});

check('the stack is capped at the limit', () => {
  const h = createHistory(scene(0), 3);
  for (let i = 1; i <= 10; i++) h.push(scene(i));
  let undone = 0;
  while (h.canUndo()) {
    h.undo(scene(10));
    undone++;
  }
  assert.equal(undone, 3, `undid ${undone} times, expected the cap of 3`);
});

check('snapshots are deep copies, so later mutation cannot rewrite history', () => {
  const original = scene(2);
  const h = createHistory(original, 10);
  h.push(original);
  original[0].position[0] = 999;
  const restored = h.undo(original);
  assert.notEqual(restored[0], original[0], 'undo returned the same array reference');
  assert.equal(restored[0].position[0], 0);
});

check('reset clears both stacks', () => {
  const h = createHistory(scene(1));
  h.push(scene(2));
  h.reset(scene(5));
  assert.equal(h.canUndo(), false);
  assert.equal(h.canRedo(), false);
  assert.equal(h.undo(scene(5)).length, 5);
});

if (failures) {
  console.error(`history: ${failures} failing`);
  process.exit(1);
}
console.log('history ok');