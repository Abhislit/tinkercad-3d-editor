# Tinkercad-style 3D shape editor — design spec

Date: 2026-10-14
Status: approved design, pending spec review

## Purpose

A browser-based 3D shape editor: place, move, rotate, recolor, scale and delete
box / sphere / cylinder primitives, orbit the camera, export the scene as binary
STL for 3D printing. It is a standalone teaching/reconstruction artifact in the
spirit of Tinkercad's shape-placement editor — **not** a copy of Tinkercad's
code, and not a CSG modeler.

## Context

Tinkercad's real 3D editor is behind Autodesk OAuth login. A REA capture of
`https://www.tinkercad.com/editor` (`ev_28bb1970c38d9870955ef06d69fa83c7abc66cc78b4bbbe31c8a6506e523194f`)
returned HTTP 404 anonymously, so its bundles cannot be fetched, run or
reconstructed without account credentials. This project therefore builds the
equivalent capability from scratch rather than extracting theirs.

## Scope

In scope:
- Primitives: box, sphere, cylinder (parametric, generated procedurally)
- Camera: orbit, pan, dolly
- Selection: click to pick nearest object
- Transform: move on the ground plane, rotate about Y, scale, recolor, delete
- Export: binary STL of the whole scene
- Verification: a node self-check for geometry/STL math, plus a headless
  Chromium session that drives the UI and captures a screenshot

Out of scope (explicitly not built): CSG booleans, undo/redo, OBJ or 3MF
export, OBJ/STL import, grid snapping and physical units, touch controls,
multi-user or server persistence.

## Architecture

No build step, no dependencies. Native ES modules served over HTTP.

```
tinkercad-3d/
  index.html            markup, CSS, toolbar
  src/geometry.js       pure math: primitives, AABB, STL serialization
  src/app.js            camera, picking, transforms, render loop, UI wiring
  test/geometry.test.mjs  node assert self-check (no framework)
  serve.sh              one-line static server
```

`src/geometry.js` holds everything pure and testable: unit-cube / UV-sphere /
cylinder tessellation, triangle and vertex counting, world-space AABB from a
rotation, and binary STL byte assembly. `src/app.js` owns all stateful
concerns: scene array, camera matrices, WebGL2 resources, pointer/keyboard
handling, and DOM wiring. The split exists so the only genuinely error-prone
math can be tested without a GPU.

HTTP serving is required rather than optional: Chrome blocks ES module imports
over `file://`, and the headless verification capture needs a real origin.

## Data model

```js
scene = [{
  type: 'box' | 'sphere' | 'cylinder',
  position: [x, y, z],   // center of the shape
  rotation: [rx, ry, rz], // radians, about the shape center
  size: [w, h, d],       // full extents, all clamped to >= 0.1
  color: [r, g, b]       // 0..1
}]
```

Shapes are regenerated from parameters on demand rather than cached as meshes;
at this scale regeneration cost is irrelevant and it removes a whole class of
stale-cache bugs.

## Rendering

WebGL2, one vertex/fragment program. Vertex stage takes position + normal and
applies a per-draw uniform model matrix; the fragment stage does Lambert
shading with a fixed light direction plus a rim term so silhouettes read
against the background. One draw call per shape. Depth test on, back-face
culling on.

4x4 matrix helpers (identity, multiply, perspective, lookAt, invert,
compose-from-TRS, normal matrix) are written inline in `src/app.js`; they are
about 30 lines and pulling in a math library for them is not worth it.

The grid is drawn as GL_LINES with its own simple color path in the same
program.

## Interaction

| Action | Input |
|---|---|
| Orbit | left-drag on empty space |
| Pan | shift-drag or middle-drag |
| Dolly | wheel (clamped) |
| Select | left-click a shape |
| Move | drag a selected shape across the ground plane (y=0) |
| Rotate | `R` / `Shift+R`, 15 degree steps about Y |
| Scale | `[` and `]`, 10% steps |
| Recolor | palette buttons; `1`-`8` shortcuts |
| Delete | `Delete` or `Backspace` |
| Add shape | toolbar buttons |

Movement is constrained to the ground plane by projecting the pointer ray onto
y=0, which keeps the interaction predictable and avoids needing a full
drag-plane solve.

## Picking

Ray-vs-world-space AABB slab test against each shape, nearest hit wins, with a
pixel-proportional tolerance so small shapes stay clickable. Analytic AABBs are
exact for axis-aligned shapes and cheap to compute from the rotated extents —
no GPU readback and no depth buffer read.

## Error handling

- WebGL2 unavailable: show a visible message in place of the canvas instead of
  a blank page.
- Context loss: listen for `webglcontextlost`, show the same message.
- Empty scene or empty selection when an action fires: no-op, never throw.
- STL export with zero shapes: disabled button, not a crash.

## Verification

1. `node test/geometry.test.mjs` — asserts cube face and triangle counts, sphere
   and cylinder volume convergence as tessellation density rises, AABB
   correctness after a 90 degree Y rotation, and that the serialized STL byte
   length equals `84 + 50 * triangleCount` with the expected binary header.
2. Headless run — serve on `127.0.0.1`, drive Chromium through REA's browser
   capture: add two shapes, select one, move it, capture a screenshot, and
   assert zero page errors and a non-blank canvas.

Both must pass before the work is called done.

## Risks

- Hand-rolled matrix math can silently transpose — mitigated by the AABB and
  volume assertions in the self-check.
- Headless Chromium may fall back to SwiftShader; the capture verifies the app
  renders, not GPU performance.