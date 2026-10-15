// Undo/redo over deep scene snapshots. Pure: no DOM, no globals, so it can be
// exercised under plain node.

const clone = (value) => JSON.parse(JSON.stringify(value));

export function createHistory(initial, limit = 50) {
  let past = [clone(initial)];
  let future = [];

  return {
    // Record the state *before* a mutation, so undo returns to it.
    push(state) {
      past.push(clone(state));
      if (past.length > limit + 1) past.shift();
      future = [];
    },

    canUndo: () => past.length > 1,

    canRedo: () => future.length > 0,

    // `current` is the live scene: push() records the state *before* each
    // mutation, so undo has to read the current state out of the caller to
    // park it on the redo stack. Both return a state to apply; at the boundary
    // they return the current state unchanged, so callers need no null check.
    undo(current) {
      if (past.length <= 1) return clone(current);
      future.push(clone(current));
      return clone(past.pop());
    },

    redo(current) {
      if (!future.length) return clone(current);
      const next = future.pop();
      past.push(clone(current));
      return next;
    },

    // Drop all history and start again from `state` (scene load).
    reset(state) {
      past = [clone(state)];
      future = [];
    },

    depth: () => past.length - 1,
  };
}