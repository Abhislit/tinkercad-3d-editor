# 3D shape editor

A small Tinkercad-style 3D shape editor: place shapes on a ground plane, orbit the
camera, select and transform them, group and cut them with real mesh booleans, undo
and redo, and export the scene as a binary STL or a PNG.

Eight primitives: box, sphere, cylinder, cone, pyramid, torus, capsule and a hollow
tube. For every one of them `size` is the full extent, so a size-2 shape measures 2
units across whichever axis you look at.

No dependencies, no build step. Plain ES modules, WebGL2 and one shader.

## Run it

```sh
./serve.sh          # http://127.0.0.1:8137/  (PORT=xxxx to change the port)
```

A real HTTP origin is required — ES modules do not load over `file://`.

## Controls

| Action | Input |
|---|---|
| Orbit | drag |
| Pan | shift-drag |
| Zoom | wheel |
| Select | click a shape |
| Add to / remove from selection | `Ctrl`-click (or `Cmd`-click) |
| Move | drag the selected shape |
| Rotate | `R` (Y), `X`, `Z` — add `Shift` to reverse |
| Scale | `[` and `]` (±10%) |
| Colour | `1`–`8`, or the swatches, or the colour picker |
| Opacity | the `Opacity` slider (translucent shapes render sorted back-to-front) |
| Nudge | arrows move X/Z, `PageUp`/`PageDown` move Y — 0.1 per step, `Shift` for 1.0 |
| Delete | `Delete` / `Backspace` |
| Duplicate | `Ctrl+D` |
| Align / distribute | the `X/Y/Z min/mid/max` and `Dist X/Y/Z` buttons |
| Group (boolean) | `G` — union solids, subtract holes, bake to one shape |
| Ungroup | `Shift+G` — restore a group's source shapes |
| Mark hole | `H` — toggle the selection between solid and hole |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z` (also `Ctrl+Y`) |
| Add shape | any of the eight primitive buttons |
| Import | `Import STL` — binary or ASCII, centred on the origin, real units kept |
| Frame selection | `F` |
| Exact position | the X / Y / Z number fields — drag to scrub, or type |
| Exact size | the Size X/Y/Z fields — `Uniform` keeps all three equal |
| Rotation step | the `Step` menu — 5°, 15° (default) or 45° |
| Snap to grid | `Snap` button — drag positions snap to 0.5 |
| Save / load | `Save` / `Load` — stores the scene in localStorage; autosaves too |
| Export | `Export STL`, `PNG` |

## Tests

```sh
node test/geometry.test.mjs && node test/history.test.mjs \
  && node test/selection.test.mjs && node test/persistence.test.mjs \
  && node test/csg.test.mjs
```

Covers the matrix helpers (including the 4x4 inverse used by ray picking), every
primitive's tessellation, signed volume and winding direction, world-space bounds,
ray picking, the STL byte layout, the undo/redo stack, multi-select arithmetic,
mesh round-tripping through JSON save/load, and the BSP booleans (union, subtract
and intersect, including coincident and disjoint cases).

## STL import

`Import STL` reads binary and ASCII STL. The part is centred on the origin so
rotation turns it about its own middle, and it keeps its original units — the
`size` fields then act as a scale multiplier rather than silently resizing the
model. Imported files cannot be trusted to carry usable normals, so flat normals
are recomputed from the triangle winding. Anything that is not recognisably STL is
rejected instead of imported as garbage.

## Axes

The viewport draws the world axes through the origin — +X red, +Y green, +Z blue,
each three units long with a dim negative stub. The X/Y/Z fields under the canvas
show the selected shape's exact position and accept typed values; they step by 0.5
with the arrow keys and fall back to the current value on anything non-numeric, so
a stray keystroke cannot push NaN into the render or the STL.

## Layout

- `src/geometry.js` — pure math: matrices, primitives, bounds, picking, STL bytes.
  No DOM, no WebGL, fully testable.
- `src/meshstore.js` — a shape's mesh data plus its lazily built GPU buffers.
- `src/selection.js` — multi-select index arithmetic.
- `src/csg.js` — BSP booleans (union / subtract / intersect) over triangle soup.
- `src/app.js` — scene state, camera, WebGL2 rendering and DOM wiring.
- `src/history.js` — undo/redo over deep scene snapshots.
- `test/*.test.mjs` — node `assert` self-checks, no test framework.

## Group and holes

`G` runs a real boolean on the selection: the solids are unioned, the holes are
unioned into one cutter, and the cutter is subtracted. The result is baked into a
single mesh shape — world-space BSP output is recentred on its own bounds centre so
the identity transform does not offset it twice — and it keeps the source shapes so
`Shift+G` can put them back. Mark a shape as a hole with `H`.

Exactly coincident faces are the hard case for BSP, since two shapes butted flush
share a face; a small epsilon in the split absorbs the common cases. If a boolean
throws or comes back empty the originals are left untouched and the hint bar says
so — grouping never loses data.