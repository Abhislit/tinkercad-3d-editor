# 3D shape editor

A small Tinkercad-style 3D shape editor: place shapes on a ground plane, orbit the
camera, select and transform them, undo and redo, and export the scene as a binary
STL for 3D printing.

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
| Move | drag the selected shape |
| Rotate | `R` (Y), `X`, `Z` — add `Shift` to reverse |
| Scale | `[` and `]` (±10%) |
| Colour | `1`–`8`, or the swatches |
| Delete | `Delete` / `Backspace` |
| Duplicate | `Ctrl+D` |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z` (also `Ctrl+Y`) |
| Add shape | any of the eight primitive buttons |
| Exact position | the X / Y / Z number fields — arrow keys step by 0.5 |
| Snap to grid | `Snap` button — drag positions snap to 0.5 |
| Save / load | `Save` / `Load` — stores the scene in localStorage |
| Export | Export STL |

## Tests

```sh
node test/geometry.test.mjs && node test/history.test.mjs
```

Covers the matrix helpers (including the 4x4 inverse used by ray picking), every
primitive's tessellation, signed volume and winding direction, world-space bounds,
ray picking, the STL byte layout, and the undo/redo stack.

## Axes

The viewport draws the world axes through the origin — +X red, +Y green, +Z blue,
each three units long with a dim negative stub. The X/Y/Z fields under the canvas
show the selected shape's exact position and accept typed values; they step by 0.5
with the arrow keys and fall back to the current value on anything non-numeric, so
a stray keystroke cannot push NaN into the render or the STL.

## Layout

- `src/geometry.js` — pure math: matrices, primitives, bounds, picking, STL bytes.
  No DOM, no WebGL, fully testable.
- `src/app.js` — scene state, camera, WebGL2 rendering and DOM wiring.
- `src/history.js` — undo/redo over deep scene snapshots.
- `test/geometry.test.mjs`, `test/history.test.mjs` — node `assert` self-checks, no
  test framework.