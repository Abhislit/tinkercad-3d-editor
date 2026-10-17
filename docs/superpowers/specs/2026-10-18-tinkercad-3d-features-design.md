# Tinkercad-style 3D shape editor — features batch 2 (design spec)

Date: 2026-10-18
Status: approved design, pending spec review
Supersedes: the "out of scope" clause of
`2026-10-14-tinkercad-3d-editor-design.md`, which excluded CSG booleans.
Undo/redo was also excluded there and has since shipped.

## Purpose

Extend the existing editor with five clustered capabilities:

1. Multi-select, plus align and distribute — operate on several shapes at once.
2. Group / holes — subtract shapes from shapes with real mesh booleans (BSP CSG).
3. Shape properties — arbitrary colour, opacity, rename.
4. PNG export and autosave.
5. Precise transforms — drag-to-scrub on the numeric fields, selectable rotation
   step, uniform-scale lock.

The editor remains a standalone teaching/reconstruction artifact: no build step,
no runtime dependencies, native ES modules.

## Context

The editor at `~/tinkercad-3d` currently supports 8 primitives, orbit/pan/dolly,
single-shape select/move/rotate/scale/recolour/delete, undo/redo, snap, STL
import and export, and a frame-selected camera. Its scene is an array of
parameterised shapes regenerated from parameters on demand.

Two facts discovered while designing this batch shape the work:

- `snapshot()` records only `state.scene`, and `history` deep-clones it, so
  in-place shape mutation is safe and selection changes are not undoable. This
  is accepted, not changed.
- `meshCache` is in-memory, while `saveScene` serialises only `state.scene`.
  Therefore a saved scene containing an imported STL reloads with a `meshKey`
  that resolves to nothing, and the draw loop skips it — the shape silently
  disappears. Grouped shapes would fail identically. This spec fixes it.

## Scope

In scope:
- Selection as a set of indices; Ctrl/Cmd+click to add or remove.
- Align (min/centre/max on X, Y, Z) and distribute evenly along one axis.
- Boolean group: union solids, subtract holes; ungroup restores sources.
- Colour picker (arbitrary hex), per-shape opacity, per-shape name.
- Export the current viewport as PNG; debounced autosave with restore at boot.
- Scrub the pos/rot/size fields by dragging; rotation step 5/15/45; uniform lock.

Out of scope (unchanged non-goals): per-triangle transparency sorting, marquee
selection, shape hierarchy beyond one flat group/ungroup level, OBJ/3MF, touch
controls, server persistence, physical units.

## Architecture

No new runtime dependencies. One new pure module and its test; the rest is
changes to existing files.

```
tinkercad-3d/
  index.html              new toolbar controls, new coords row entries
  src/geometry.js         unchanged public behaviour; may host CSG mesh helpers
  src/csg.js              NEW: BSP CSG (union/subtract/intersect) over triangles
  src/app.js              selection set, rendering, properties, persistence, UI
  test/geometry.test.mjs  unchanged, must stay green
  test/history.test.mjs   unchanged, must stay green
  test/csg.test.mjs       NEW: node assert self-check for the booleans
```

`src/csg.js` follows the existing split: everything pure and GPU-free lives
where node can test it. It has no DOM or WebGL references.

## Data model

`state` gains a set; shapes gain optional fields. Existing fields are unchanged.

```js
state = {
  scene: [...],
  selection: [i, ...],   // sorted, unique scene indices; [] when nothing selected
  camera: {...}, drag: null, snap: false
}

shape = {
  type, position, rotation, size, color,   // as today
  name: 'Box 1',        // optional; shown in the hint bar when selected
  opacity: 1,           // optional; 0..1, default 1 (opaque)
  isHole: false,        // optional; true marks a CSG cutter for Group
  mesh: {...},          // optional; for type 'mesh' | 'group' — see Persistence
  importedSize: [...],  // optional; as today for 'mesh'
  group: [...]          // optional; source shapes, kept so Ungroup can restore
}
```

`state.selected` is retained as a **computed** value: the last element of
`selection`, or `-1`. It is not stored. Every existing read of
`state.scene[state.selected]` — the outline draw, `pointerdown`, the move drag,
`syncUi`, `frameSelected`, the coords handlers — keeps working unchanged. The
ops that must act on the whole set become loops.

Selection is normalised after any structural change (add, delete, duplicate,
group, ungroup, load, import): drop out-of-range indices, sort, dedupe. Without
this, indices dangle after a delete.

## Rendering

Changes over the current renderer:

- Add a `uAlpha` uniform; `fragColor = vec4(shaded, uAlpha)`.
- Two passes when any shape is translucent: opaques first, then translucents
  sorted back-to-front by distance from the eye, drawn with depth writes off,
  then depth writes restored. Blending enabled. This is sorted per-shape, not
  per-triangle: intersecting translucent shapes can show ordering artifacts.
  Accepted (`ponytail:` note at the site).
- `createMesh` currently builds `Uint16Array` indices, capping a mesh at 65535
  vertices. Switch to `Uint32Array` when the vertex count exceeds 65535;
  WebGL2 supports `UNSIGNED_INT` natively. CSG output can exceed the 16-bit cap.
- The selection outline draws once per selected index.

## Interaction

Additions to the existing control set:

| Action | Input |
|---|---|
| Add to / remove from selection | Ctrl/Cmd + click a shape |
| Replace selection | click a shape |
| Clear selection | click empty space |
| Group (union solids, subtract holes) | `G` or toolbar |
| Ungroup | `Shift+G` or toolbar |
| Mark/unmark hole | `H` or toolbar toggle, applies to selection |
| Align / distribute | toolbar buttons |
| Rename | type in the name field |
| Recolour | colour picker or `1`-`8` |
| Export PNG | toolbar button |
| Scrub a field | drag horizontally on a pos/rot/size input |

Single-key bindings are used for group/ungroup rather than `Ctrl+G`, because
Chrome consumes `Ctrl+G` for find-next and a web page cannot reliably prevent
it. This also matches the existing single-key style (`R`, `X`, `Z`, `F`,
brackets).

Shift-drag remains pan and middle-drag remains pan; the add-to-selection gesture
is Ctrl/Cmd+click precisely because `event.shiftKey` is already pan
(`src/app.js:389`). Empty-space drag still orbits. Modify-key gestures must not
be swallowed by the orbits/drag path.

## Align and distribute

Both operate on `state.selection` and are no-ops below two shapes.

- Align: six toolbar buttons — min/centre/max on X, Y, Z. Compute one target
  coordinate along the chosen axis from all selected world bounds (the min, the
  combined-bounds centre, or the max), then set each shape's `position[axis]` so
  its own bound of the same kind lands on the target. Alignment happens in world
  space, so a rotated shape aligns by its actual AABB, not its local box.
- Distribute: one button per axis. Sort the selection by the chosen axis' bound
  centre, keep the two extremes fixed, and space every interior shape's centre
  evenly between them. Needs at least three shapes to change anything.
- Both snapshot once at the end and leave the selection unchanged.

Ties in distribute sort (equal centres) keep their existing relative order.

## Group and holes (CSG)

`src/csg.js` implements classic BSP booleans over triangle soup:

- `Plane` from three points with `EPSILON = 1e-5`; `Polygon` carrying vertices
  and shared data; `Node` with `splitPolygon`, `invert`, `clipTo`, `build`.
- `union(a, b)`, `subtract(a, b)`, `intersect(a, b)` returning triangle soup.
- Triangle-soup conversion both ways, so `sceneTriangles`-style world geometry
  can enter and a mesh shape can come out.

`groupSelected()`:

1. Collect the selected shapes. Require at least one solid; a selection of only
   holes is refused with a hint.
2. Convert each to world-space triangles by applying its model matrix, so
   position/rotation/size are baked into the result.
3. Union all solids; union all holes; subtract the hole union from the solid
   union (unioning holes first makes overlapping holes behave).
4. Recentre: compute the result's bounds centre `c` (world space), translate
   every vertex by `-c`, and set the shape's `position` to `c`. BSP output is
   in world coordinates, so without this step the model matrix would offset the
   mesh a second time and `aabbFor` would double-count the offset.
5. Bake into one shape at identity transform (`rotation: [0,0,0]`,
   `size: [1,1,1]`), with `importedSize` set from its bounds so `aabbFor` and
   `frameDistance` keep working, colour from the first solid, and `group`
   holding the sources.
6. Replace the selected shapes in the scene with the single result, select it,
   and snapshot.

`ungroupSelected()` splices the group shape out and pushes its stored sources
back in, then selects them and snapshots.

Coplanar faces are the genuine fragility: exactly coincident faces are common
when two shapes are butted flush, and BSP splits can leave slivers. The
`EPSILON` in `splitPolygon` handles the common case; holes are also drawn to
overhang their solid in normal use, which avoids the degenerate case entirely.

**Fallback:** if the boolean throws, or yields zero triangles, the group is
aborted and the original shapes are left exactly as they were, with a hint
message. This must not lose data.

## Properties

- Colour picker: an `<input type="color">` beside the eight swatches; hex is
  converted to `0..1` rgb and written the same way a swatch click is.
- Opacity: a per-shape value, default 1, edited with an
  `<input type="range" min="0" max="1" step="0.05">` beside the colour picker;
  drives `uAlpha` and the translucent draw path above.
- Name: a text input writes `shape.name`; the hint bar shows the name of the
  primary selection, falling back to the type plus extents.

## PNG export and autosave

- PNG: `preserveDrawingBuffer: true` on the WebGL2 context, then
  `canvas.toBlob` and a download. This is one line and the most reliable capture
  route; it costs a little draw performance always. Accepted (`ponytail:` note).
- Autosave: debounced (about 500 ms) write of `state.scene` into the existing
  `SAVE_KEY`, restored at boot behind the same key the Save/Load buttons use.
  One storage key, no new UI, no second restore path.

## Persistence fix

Mesh shapes (`type: 'mesh'` from import, and the new `'group'` results) carry
their own data in `shape.mesh = { positions, normals, indices }` instead of an
opaque `meshKey`. A resolver registers and caches the GPU mesh lazily on first
draw, keyed on the mesh object identity. This makes save/load round-trip a
scene containing imported or grouped meshes, which today it does not, and it
removes the unbounded growth of the old string-keyed cache.

## Error handling

- Group/ungroup with a selection that cannot be grouped: no-op with a hint.
- Boolean failure or empty result: abort, keep originals, show a hint.
- Scrubbing, picking, and colour/opacity edits with an empty selection: no-op.
- A shape whose mesh data is missing on load: skip drawing it (as today) rather
  than throw, but this should no longer occur now that meshes are self-carried.
- Autosave writes are wrapped so a quota error cannot break the edit path.
- PNG export when the canvas is unavailable: no-op.

## Verification

1. `node test/geometry.test.mjs` and `node test/history.test.mjs` — unchanged,
   must stay green (46 + 12 checks).
2. `node test/csg.test.mjs` — NEW. Assertions:
   - `subtract` of a unit cube from a larger cube whose volume is known yields
     the expected volume within tolerance.
   - `union` of two identical cubes yields the volume of one, not two (the
     coplanar-identical case).
   - `subtract` of two disjoint solids returns the first unchanged in volume.
   - A box butted flush against another box (coincident faces) does not throw
     and produces a closed, positive-volume result.
   - Failure path: a boolean that yields zero triangles reports the empty
     result so the caller can abort rather than bake a phantom shape.
3. Headless Chromium via REA's browser capture: add three shapes, Ctrl+click to
   multi-select, align them, group two with one as a hole, set opacity, rename,
   export PNG, reload the page and confirm the scene (including the grouped
   mesh) is restored. Assert zero page errors and a non-blank canvas.

All three must pass before the work is called done.

## Risks

- BSP on coplanar/coincident faces is the highest-risk part; the fallback and
  the "disjoint unchanged" test are the guardrails.
- The selection set touches picking, drawing, undo snapshots and every op; the
  normalisation-after-structural-change rule is what keeps indices valid, and it
  needs a test of its own.
- `preserveDrawingBuffer` always-on is a small, permanent performance cost.
- The two-pass translucent renderer does not sort per triangle; artifacts are
  expected and accepted.

## Deliberate ceilings

- Transparency is sorted per shape, not per triangle.
- Scrub moves in whole field steps; typed arbitrary values still work.
- One level of group/ungroup; no nested groups.
- Autosave shares the manual save key rather than keeping its own history.
