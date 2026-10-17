# Tinkercad-style 3D shape editor — features batch 2 (implementation plan)

Date: 2026-10-18
Spec: `docs/superpowers/specs/2026-10-18-tinkercad-3d-features-design.md`

## Scope check

The spec covers five clusters (multi-select, align/distribute, CSG group/holes,
properties, PNG/autosave, precise transforms). They are **not** independent:
all five read or write the same `state.selection` set and all edit the same
`src/app.js` render/pointer/UI code. A standalone per-cluster plan could not
ship working software alone. Therefore this is **one plan with ordered phases**.
Each phase ends green (`node test/*.test.mjs`) and is separately committable.

## How to use this plan

- Work top to bottom. Each task is one red→green→commit cycle.
- Test pattern in this repo: node `assert/strict`, a `failures` counter, a
  `check(name, fn)` wrapper, `console.log('  ok  ' + name)`, and a
  `process.exit(failures ? 1 : 0)` at the end. Copy the header from
  `test/geometry.test.mjs:1-38` or `test/history.test.mjs`.
- Run `node test/geometry.test.mjs && node test/history.test.mjs` before every
  commit; they must stay green (46 + 12 checks).
- Serve for browser checks: `(cd /home/abhishek-parmar/tinkercad-3d && ./serve.sh > /tmp/opencode/serve.log 2>&1 &)` then `http://127.0.0.1:8137/`.
- Ponytail rules hold: shortest working diff, `ponytail:` comment at each
  accepted ceiling, one runnable check per non-trivial unit.

## Target file structure

```
tinkercad-3d/
  index.html              + align/distribute buttons, colour picker, opacity
                            range, name input, PNG button, rotation-step select
  src/selection.js        NEW pure: normalizeSelection, toggleSelection, primary
  src/csg.js              NEW pure: Plane/Polygon/Node, union/subtract/intersect,
                            trianglesToMesh / meshToTriangles
  src/geometry.js         + alignAxis, distributeAxis, aabbCentre helpers
  src/app.js              selection set, uAlpha + translucent pass, properties,
                            PNG, autosave, scrub, group/ungroup wiring,
                            mesh self-carry + lazy resolver, Uint32 indices
  test/selection.test.mjs NEW (phase 1)
  test/csg.test.mjs       NEW (phase 6)
  test/geometry.test.mjs  unchanged, stays green
  test/history.test.mjs   unchanged, stays green
```

Responsibility map (so nothing is put in the wrong file):

- `src/selection.js` — index-set arithmetic only. No scene, no DOM.
- `src/csg.js` — geometry booleans only. No DOM, no WebGL, no scene shape.
- `src/geometry.js` — pure math/geometry used by both app and tests.
- `src/app.js` — everything stateful, DOM, GL, and the wiring between the above.

---

## Phase 0 — Foundations (do first: every later phase depends on it)

### Task 0.1 — Mesh shapes self-carry their data (fixes the vanish bug)

**Why:** `meshCache` (`src/app.js:218`) is memory-only but `saveScene`
(`src/app.js:553`) saves only `state.scene`; a reloaded imported/grouped shape
resolves a dead `meshKey` and the draw loop `continue`s it. Grouped shapes would
fail identically, so CSG (phase 6) cannot ship without this.

**Files:** `src/app.js`, `test/persistence.test.mjs` (NEW).

1. Test target: `src/app.js` is not node-importable (DOM/GL at load). So test
   the pure part in a new module `src/meshstore.js`:
   - `resolveMesh(shape, gpu)` returns the cached entry for `shape.mesh`
     (object identity) or `undefined` when `shape.mesh` is absent;
   - `serializeShape(shape)` / `reviveShape(shape)` round-trip `shape.mesh`
     through `JSON.parse(JSON.stringify(...))` preserving `positions`,
     `normals`, `indices` arrays.
2. Write `test/persistence.test.mjs` first: build a shape with
   `mesh = { positions: [...], normals: [...], indices: [...] }`, round-trip it
   through `serializeShape`→`reviveShape`, assert the mesh arrays are equal and
   `resolveMesh` returns the registered object after `resolveMesh.register`.
   Run → red.
3. Create `src/meshstore.js` with a `WeakMap`-backed cache keyed on the mesh
   object; `resolveMesh`, `serializeShape`, `reviveShape`. Green.
4. In `src/app.js`: `importMesh` sets `shape.mesh = {...}` (not `meshKey`);
   the draw loop calls `resolveMesh(shape, ...)` and lazily registers a GPU
   buffer on first use; delete the string-keyed `registerMesh` growth path.
5. Run all three test files; commit `fix: mesh shapes carry their own data`.

### Task 0.2 — Uint32 indices above the 16-bit cap

**Files:** `src/app.js` (`createMesh`, ~134).

1. Extend `test/geometry.test.mjs`? No — `createMesh` is GL-bound. Assert the
   *decision* instead in `src/meshstore.js`: `indexArrayType(vertexCount)`
   returns `Uint16Array` for `<= 65535` else `Uint32Array`.
2. Red test in `test/persistence.test.mjs`. Implement `indexArrayType`. Green.
3. `createMesh` uses `indexArrayType(positions.length / 3)` and passes
   `UNSIGNED_SHORT`/`UNSIGNED_INT` to `drawElements` accordingly. Commit.

---

## Phase 1 — Selection model

### Task 1.1 — `src/selection.js`

**Files:** `src/selection.js` (NEW), `test/selection.test.mjs` (NEW).

1. Red tests, exact API:
   - `normalizeSelection([5, 1, 1, 9], 4)` → `[1]` (sort, dedupe, drop `>= len`).
   - `normalizeSelection([-1, 0, 2], 3)` → `[0, 2]`.
   - `toggleSelection([0, 2], 1)` → `[0, 1, 2]`; `toggleSelection([0, 1, 2], 1)` → `[0, 2]`.
   - `primaryIndex([])` → `-1`; `primaryIndex([0, 3])` → `3`.
   - `hasIndex([0, 2], 2)` → `true`, `hasIndex([], 0)` → `false`.
   Run → red.
2. Implement the module (~30 lines, pure). Green. Commit `feat: selection set`.

### Task 1.2 — Wire the set through `src/app.js`

**Files:** `src/app.js`.

1. Add `selection: []` to `state` (`src/app.js:56-62`); replace stored
   `selected` with a getter `get selected() { return primaryIndex(state.selection); }`
   on `state` (object getter keeps every `state.scene[state.selected]` read
   working unchanged).
2. `pointerdown` (~389): plain click → `selection = [hit]`; with
   `event.ctrlKey || event.metaKey` → `selection = toggleSelection(selection, hit)`;
   empty space → `[]`. **Guard:** the ctrl/meta branch must `return` before the
   drag-start so a modify-click never begins an orbit or a move.
3. Every structural change calls `state.selection = normalizeSelection(state.selection, state.scene.length)`:
   `addShape` (481), `deleteSelected` (487), `duplicateSelected` (518),
   load (557), `importStl` (627). Delete must delete *all* selected, not one.
4. `syncUi` / `frameSelected` / coords handlers operate on the primary but the
   hint shows `N selected` when `selection.length > 1`.
5. Browser check: ctrl+click two shapes → both outlined; delete removes both.
   Commit `feat: multi-select`.

---

## Phase 2 — Align and distribute

### Task 2.1 — Pure helpers in `src/geometry.js`

**Files:** `src/geometry.js`, `test/geometry.test.mjs`.

1. Red tests appended to `test/geometry.test.mjs` (keeps its count rising):
   - `alignAxis([{min:0,max:2},{min:10,max:12}], 'x', 'min')` → target `0`,
     delta per shape `[0, -10]` (second shape's min moves to 0).
   - `alignAxis(..., 'centre')` uses combined-bounds centre;
     `alignAxis(..., 'max')` uses the max.
   - `distributeAxis(centres=[0,1,10])` → `[0, 4.5, 9]` with extremes fixed;
     `distributeAxis([0,10])` → unchanged (needs ≥3);
     ties keep order.
2. Implement `alignAxis(bounds, axis, mode)` returning per-shape deltas, and
   `distributeAxis(centres, axis)` returning new centres. `aabbFor` already
   gives world bounds (`src/geometry.js` ~268). Green. Commit `feat: align math`.

### Task 2.2 — Toolbar buttons + wiring

**Files:** `index.html`, `src/app.js`.

1. `index.html`: a `.sep` then six `data-align="min|centre|max: x|y|z"` buttons
   and three `data-distribute="x|y|z"` buttons.
2. `src/app.js`: handler collects `selection`, builds world AABBs via `aabbFor`,
   calls the helpers, applies `position[axis] += delta`, then one `snapshot()`.
   No-op below 2 shapes for align, below 3 for distribute. Selection unchanged.
3. Browser check: three shapes at varying X → Align min X stacks their left
   edges; Distribute X spaces them. Commit `feat: align and distribute`.

---

## Phase 3 — Properties (colour, opacity, name) + translucent rendering

### Task 3.1 — `uAlpha` + two-pass translucent draw

**Files:** `src/app.js` (shaders 77+, draw loop 320).

1. Add `uniform float uAlpha;` and `fragColor = vec4(shaded, uAlpha);`.
2. Draw opaque shapes first (alpha 1). If any selected shape has
   `opacity < 1`: `gl.enable(BLEND)`, set the standard src-alpha blend, sort
   translucent shapes back-to-front by eye distance, draw them with
   `depthMask(false)`, then `depthMask(true)` and disable blend.
   Add `// ponytail: per-shape sort, not per-triangle; intersecting translucent shapes can show ordering artifacts.`
3. Selection outline draws once per selected index (Phase 1 already loops).
4. Browser check with a manual opacity edit. Commit `feat: translucent rendering`.

### Task 3.2 — Colour picker, opacity range, name input

**Files:** `index.html`, `src/app.js`.

1. `index.html`: `<input id="color" type="color">` after the swatches;
   `<input id="opacity" type="range" min="0" max="1" step="0.05" value="1">`;
   `<input id="name" type="text">` in the coords bar.
2. `src/app.js`: colour change → write `shape.color` on every selected shape as
   rgb `0..1` (same path as swatches); opacity change → `shape.opacity`, used by
   the draw; name input → `shape.name`; hint shows primary `name` else type
   plus extents. All no-op with an empty selection.
3. One `snapshot()` per settled edit (on `change`, not every `input`, for the
   range to avoid undo spam). Commit `feat: shape properties`.

---

## Phase 4 — PNG export and autosave

### Task 4.1 — PNG export

**Files:** `src/app.js` (context at 35, toolbar button).

1. Context: `getContext('webgl2', { antialias: true, preserveDrawingBuffer: true })`
   with `// ponytail: always-on preserveDrawingBuffer; small permanent draw cost, simplest reliable capture.`
2. `#png` button → `canvas.toBlob(blob => download(blob, 'scene.png'))`.
   No-op if the canvas/context is unavailable.
3. Browser check: click PNG, assert no page error. Commit `feat: PNG export`.

### Task 4.2 — Autosave

**Files:** `src/app.js` (`SAVE_KEY` 550, save/load 553/557).

1. After every `snapshot()`, debounce ~500 ms and write `state.scene` to
   `SAVE_KEY` inside `try/catch` (quota must not break editing).
2. Boot: after first scene init, if `SAVE_KEY` present, restore it (same path as
   Load). No new key, no new UI.
3. Browser check: edit, reload, scene restored including any grouped mesh.
   Commit `feat: autosave`.

---

## Phase 5 — Precise transforms (scrub, step, uniform lock)

### Task 5.1 — Scrub on drag

**Files:** `index.html` (inputs already exist), `src/app.js` (coords handlers 571-602).

1. `pointerdown` on a `#coords input` → capture pointer, record start X and
   value; `pointermove` → `value += round(dx / 4) * step` (whole field steps);
   `pointerup` → commit + one `snapshot()`.
   Add `// ponytail: scrub moves in whole field steps; typed arbitrary values still work.`
2. No-op with empty selection.

### Task 5.2 — Rotation step + uniform lock

**Files:** `index.html`, `src/app.js`.

1. `<select id="rot-step">` with 5/15/45; drives the rot inputs' `step` and the
   `R`/`X`/`Z` key increment.
2. `<label><input id="uniform" type="checkbox"> Uniform</label>`; when checked,
   editing any size field sets the other two to the same value.
3. Browser check: scrub a pos field, change rot step, toggle uniform.
   Commit `feat: precise transforms`.

---

## Phase 6 — CSG group and holes

### Task 6.1 — `src/csg.js` BSP core

**Files:** `src/csg.js` (NEW), `test/csg.test.mjs` (NEW).

1. Red tests (spec §Verification 2):
   - subtract a unit cube from a 3×3×3 cube → expected volume ± tolerance;
   - union of two identical cubes → volume of one (coplanar-identical);
   - subtract two disjoint solids → first unchanged in volume;
   - two boxes butted flush (coincident faces) does not throw and yields
     positive volume;
   - a boolean yielding zero triangles reports empty (caller can abort).
2. Implement `Plane` (from 3 points, `EPSILON = 1e-5`), `Polygon`, `Node`
   (`splitPolygon`, `invert`, `clipTo`, `build`), `union`/`subtract`/`intersect`
   over triangle soup, plus `trianglesToMesh` / `meshToTriangles`.
   Volume helper in the test via signed tetrahedron sums (reuse the pattern at
   `test/geometry.test.mjs:58`).
3. Green. Commit `feat: BSP CSG`.

### Task 6.2 — `groupSelected` / `ungroupSelected`

**Files:** `src/app.js`, `index.html`.

1. `G` / `#group` → `groupSelected()` per spec steps 1-6: require ≥1 solid;
   world-triangles via model matrix; union solids, union holes, subtract; recentre
   by bounds centre `c` (translate verts `-c`, `position = c`); bake one shape at
   identity transform with `importedSize`, colour from first solid, `group` =
   sources; replace, select, snapshot.
2. `Shift+G` / `#ungroup` → splice group, push `group` sources back, select, snapshot.
3. `H` / `#hole` → toggle `isHole` on selection.
4. Fallback: on throw or zero triangles, leave originals untouched and show a
   hint. A selection of only holes is refused with a hint.
5. Browser check via REA (spec §Verification 3): add three shapes, ctrl+click to
   multi-select, align, group two with one as a hole, set opacity, rename,
   export PNG, reload and confirm restore. Assert zero page errors and a
   non-blank canvas. Commit `feat: group and holes`.

---

## Final verification

1. `node test/geometry.test.mjs && node test/history.test.mjs && node test/selection.test.mjs && node test/persistence.test.mjs && node test/csg.test.mjs` — all green.
2. REA browser pass through every new control, zero page errors, non-blank canvas.
3. Commit the spec (currently untracked) alongside the plan.
4. Push to `origin/master`.
