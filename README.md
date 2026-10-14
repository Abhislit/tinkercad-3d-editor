# 3D shape editor

A small Tinkercad-style 3D shape editor: place box, sphere and cylinder shapes on a
ground plane, orbit the camera, select and transform them, and export the scene as
a binary STL for 3D printing.

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
| Rotate | `R` / `Shift+R` (15° steps) |
| Scale | `[` and `]` (±10%) |
| Colour | `1`–`8`, or the swatches |
| Delete | `Delete` / `Backspace` |
| Add shape | Box / Sphere / Cylinder buttons |
| Export | Export STL |

## Tests

```sh
node test/geometry.test.mjs
```

Covers the matrix helpers (including the 4x4 inverse used by ray picking), primitive
tessellation, signed volumes, winding direction, world-space bounds, ray picking and
the STL byte layout.

## Layout

- `src/geometry.js` — pure math: matrices, primitives, bounds, picking, STL bytes.
  No DOM, no WebGL, fully testable.
- `src/app.js` — scene state, camera, WebGL2 rendering and DOM wiring.
- `test/geometry.test.mjs` — node `assert` self-check, no test framework.