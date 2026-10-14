# Tinkercad-style 3D Shape Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dependency-free WebGL2 browser app that places, transforms and exports box/sphere/cylinder shapes as binary STL.

**Architecture:** Two ES modules. `src/geometry.js` is pure math (matrices, primitives, AABB, STL) and is unit-tested under node with `assert`. `src/app.js` is stateful (scene, camera, picking, WebGL2, DOM). Served over `python3 -m http.server`; verified by a headless Chromium capture driving the UI.

**Tech Stack:** vanilla ES modules, WebGL2, node 22 `node:assert` (dev only), python3 static server. No runtime dependencies, no build step.

**Spec:** `docs/superpowers/specs/2026-10-14-tinkercad-3d-editor-design.md`

**Deviation from spec (deliberate):** matrix helpers live in `src/geometry.js`, not inline in `app.js`, so they can be asserted by the self-check. The spec's risk section requires exactly that assertion.

## Global Constraints

- Zero runtime dependencies. No bundler, no framework, no CDN.
- `size` components clamped to `>= 0.1`; rotation in radians; color components 0..1.
- Rotation steps are 15 degrees (`Math.PI / 12`); scale steps are multiplicative 1.1 / 1/1.1.
- Grid is drawn on the y=0 plane; shape dragging is constrained to y=0.
- Movement keys per spec: `R`/`Shift+R` rotate, `[`/`]` scale, `1`-`8` color, `Delete`/`Backspace` remove.
- WebGL2 absence or context loss renders a visible message in place of the canvas — never a blank page.
- Every task ends with `node test/geometry.test.mjs` green.

## Review Focus

Inputs and conditions the spec implies but that must not break the app:

1. Window resize mid-session — canvas and viewport must update, not clip or stretch.
2. Dragging a shape beyond the camera's far plane or under the horizon — motion must stay finite and reversible.
3. Zero shapes in the scene — every action and the export button must no-op safely.
4. Clicking empty space after selecting — selection clears, no exception.
5. Very small shapes at distance — picking tolerance must still select them.

---

### Task 1: Pure math core — matrices, primitives, AABB

**Files:**
- Create: `src/geometry.js`
- Create: `test/geometry.test.mjs`

**Interfaces:**
- Produces (consumed by Task 2 and `app.js`):
  - `identity(): Float32Array` (4x4, column-major)
  - `multiply(a: Float32Array, b: Float32Array): Float32Array`
  - `perspective(fovY: number, aspect: number, near: number, far: number): Float32Array`
  - `lookAt(eye: number[], center: number[], up: number[]): Float32Array`
  - `compose(position: number[], rotation: number[], size: number[]): Float32Array` — TRS, Y-then-X-then-Z applied as R = Ry * Rx * Rz
  - `transformPoint(m: Float32Array, p: number[]): number[]`
  - `boxMesh(): {positions: Float32Array, normals: Float32Array, indices: Uint16Array}` — unit cube centered at origin, extents 1
  - `sphereMesh(segments: number, rings: number): Mesh` — unit radius
  - `cylinderMesh(segments: number): Mesh` — unit radius, height 1 centered at origin
  - `triangleCount(mesh: Mesh): number`
  - `aabbFor(shape: {position, rotation, size, type}): {min: number[], max: number[]}`
  - `type Mesh = {positions: Float32Array, normals: Float32Array, indices: Uint16Array}`

**Notes:** `sphereMesh` must be smooth-shaded (per-vertex normals equal the normalized position). `cylinderMesh` uses flat cap normals on the caps and radial normals on the wall.

- [ ] **Step 1: Write the failing test** — `test/geometry.test.mjs` using `node:assert/strict`, importing from `../src/geometry.js`. Assertions:
  - `triangleCount(boxMesh()) === 12`
  - `cylinderMesh(16)` has `16 * 4` triangles (2 per quad wall segment, 1 per cap segment per cap)
  - sphere volume from `sphereMesh(64, 32)` triangles, each with circumradius r, converges: `abs(volume - (4/3)*Math.PI) / ((4/3)*Math.PI) < 0.02`
  - cylinder volume from `cylinderMesh(64)` triangles converges to `Math.PI` within 2%
  - `aabbFor({type:'box', position:[0,0,0], rotation:[0,Math.PI/2,0], size:[2,1,1]})` returns min `[-1,-0.5,-0.5]`, max `[1,0.5,0.5]` (box: half-extents are the rotated bounding sphere of the box's corner set)
  - `transformPoint(identity(), [1,2,3])` deep-equals `[1,2,3]`
  - `multiply(identity(), identity())` deep-equals `identity()`
- [ ] **Step 2: Run the test to verify it fails** — `node test/geometry.test.mjs` → fails with `ERR_MODULE_NOT_FOUND` for `src/geometry.js`.
- [ ] **Step 3: Implement `src/geometry.js`** with the signatures above. Meshes are emitted as flat `Float32Array`s (`positions` 3 floats per vertex, `normals` 3 floats per vertex) plus a `Uint16Array` index buffer. `aabbFor` rotates the 8 corners of the unrotated box by `compose`'s rotation and takes min/max per axis; sphere and cylinder return the conservative axis-aligned bound from their extents.
- [ ] **Step 4: Run the test to verify it passes** — `node test/geometry.test.mjs` → prints `geometry ok` and exits 0.
- [ ] **Step 5: Commit** — `git add src/geometry.js test/geometry.test.mjs && git commit -m "feat: pure geometry core with matrices, primitives and AABB"`

### Task 2: Binary STL serialization

**Files:**
- Modify: `src/geometry.js`
- Modify: `test/geometry.test.mjs`

**Interfaces:**
- Consumes: `boxMesh`, `sphereMesh`, `cylinderMesh`, `triangleCount`, `compose`, `aabbFor` from Task 1
- Produces: `sceneTriangles(scene: Shape[]): Float32Array` (9 floats per triangle: 3 vertices), `stlBytes(scene: Shape[]): ArrayBuffer`

`Shape = {type, position: number[], rotation: number[], size: number[], color: number[]}`

- [ ] **Step 1: Add failing assertions to `test/geometry.test.mjs`**: `stlBytes([]).byteLength === 84`; for a single box scene, `stlBytes(scene).byteLength === 84 + 50 * triangleCount(boxMesh())`; the header's first 5 bytes are `solid`; triangle normals in the byte dump have length 1; and the same scene with two differently-typed shapes yields `84 + 50 * (tri(box) + tri(sphere) + tri(cylinder))`.
- [ ] **Step 2: Run the test to verify it fails** — `node test/geometry.test.mjs` → fails because `stlBytes` is not exported.
- [ ] **Step 3: Implement `sceneTriangles` and `stlBytes`** in `src/geometry.js`. Binary STL layout: 80-byte header starting `solid`, `uint32` triangle count, then 50 bytes per triangle (12 facet-normal floats, 3 vertices, `uint16` attribute count). Meshes are scaled by `shape.size` and transformed by `compose`; normals may be left as the untransformed per-vertex normals.
- [ ] **Step 4: Run the test to verify it passes** — `node test/geometry.test.mjs` → `geometry ok`, exit 0.
- [ ] **Step 5: Commit** — `git commit -am "feat: binary STL export for a scene"`

### Task 3: WebGL2 viewport, camera and grid

**Files:**
- Create: `index.html`
- Create: `src/app.js`
- Create: `serve.sh`

**Interfaces:**
- Consumes: `src/geometry.js` (matrices, meshes)
- Produces: `window.__editor = { scene: Shape[], selected: number, addShape(type), screenshotReady: boolean }` — a test seam the headless verification reads.

- [ ] **Step 1: Create `serve.sh`** — `#!/bin/sh` + `exec python3 -m http.server "${PORT:-8137}" --bind 127.0.0.1`, `chmod +x`.
- [ ] **Step 2: Create `index.html`** — full-viewport canvas, a top toolbar with box/sphere/cylinder buttons and 8 color swatches, a hint line listing keyboard shortcuts, and a `#gl-error` element hidden by default. Loads `src/app.js` as a module.
- [ ] **Step 3: Create `src/app.js` scaffold** — canvas/context acquisition; if `getContext('webgl2')` returns null, show `#gl-error` with a message and stop. Register a `webglcontextlost` listener doing the same. Compile the single program (Lambert + rim), create VAOs per primitive type, draw the y=0 grid with `LINE_STRIP`/`LINES` on first paint, and start a `requestAnimationFrame` loop resizing the drawing buffer to `devicePixelRatio`.
- [ ] **Step 4: Implement the camera** — spherical orbit state (`theta`, `phi`, `distance`) plus a `target` vector. Left-drag on empty space orbits, shift/middle-drag pans, wheel dollies with distance clamped to `[2, 200]`. Compute `eye` from spherical coordinates, feed `lookAt` + `perspective`.
- [ ] **Step 5: Verify** — start `./serve.sh` in the background, then run a REA `capture_browser_scenario` (launch `/usr/bin/google-chrome` headless) against `http://127.0.0.1:8137/`, capturing `screenshot` and `page-errors`. Expected: zero page errors, and the screenshot is not a uniform single-color frame (grid lines visible).
- [ ] **Step 6: Commit** — `git add index.html src/app.js serve.sh && git commit -m "feat: WebGL2 viewport with orbit camera and ground grid"`

### Task 4: Shape placement, picking and transforms

**Files:**
- Modify: `src/app.js`
- Modify: `index.html`

**Interfaces:**
- Consumes: `aabbFor`, `compose`, `boxMesh`/`sphereMesh`/`cylinderMesh`, `scene` from `window.__editor`
- Produces: `window.__editor.addShape(type)`, `window.__editor.selected` (index or `-1`)

- [ ] **Step 1: Wire the toolbar** — box/sphere/cylinder buttons call `addShape(type)`, which appends a shape at the camera target with default size 1 and updates `window.__editor.scene`.
- [ ] **Step 2: Implement ray picking** — `pickShape(rayOrigin: number[], rayDir: number[], tol: number): number` in `src/app.js`: build a world ray from the pointer using the inverse view-projection, test each shape's `aabbFor` slab intersection expanded by `tol` on every axis, and return the nearest positive-t hit or `-1`. `tol` is `0.05 * distance(eye, shape.position)` computed per shape, so a distant small shape stays clickable. Pointer-down clears the selection when `pickShape` returns `-1`.
- [ ] **Step 3: Verify picking, including the small-shape case** — in the headless run, add a shape, scale it down with `[` five times, click it in the viewport, and assert `window.__editor.selected === 0`. Then click empty canvas and assert `window.__editor.selected === -1`.
- [ ] **Step 4: Implement drag-to-move** — on pointer-down over the selected shape, intersect the ray with the y=0 plane and store the offset; on move, set `position.x/z` from the new plane hit, keeping `position.y` unchanged.
- [ ] **Step 5: Implement the keys** — `R`/`Shift+R` (±15° about Y), `[`/`]` (×1.1 / ÷1.1 clamped to `>= 0.1`), `1`-`8` palette, `Delete`/`Backspace` remove. Every handler no-ops when `selected === -1`.
- [ ] **Step 6: Draw selection state** — selected shape gets an outline pass (same mesh, `cullFace` disabled, `lineWidth` 1) and the hint line shows the current selection's type and dimensions.
- [ ] **Step 7: Verify** — headless capture with actions: click the sphere button, click the box button, click on the box in the viewport, press `]`, then screenshot. Expected: `page-errors` empty and the screenshot differs from the Task 3 baseline (two shapes present, one scaled up).
- [ ] **Step 8: Commit** — `git commit -am "feat: shape placement, picking, move, rotate, scale, recolor, delete"`

### Task 5: STL download wiring and end-to-end run

**Files:**
- Modify: `index.html`
- Modify: `src/app.js`

**Interfaces:**
- Consumes: `stlBytes(scene)` from Task 2

- [ ] **Step 1: Add the export button** — disabled when `scene.length === 0`; on click, build a `Blob` from `stlBytes(window.__editor.scene)`, trigger a download named `model.stl`, and revoke the object URL.
- [ ] **Step 2: Verify byte length end to end** — in the headless run, read `stlBytes` through the test seam by asserting the exported byte length matches `84 + 50 * expectedTriangles` for the scene built in Task 4's scenario.
- [ ] **Step 3: Full verification run** — `./serve.sh` + REA capture: add two shapes, move one, export, screenshot. Expected: zero page errors, screenshot non-blank and different from earlier baselines.
- [ ] **Step 4: Run the unit tests one more time** — `node test/geometry.test.mjs` → `geometry ok`.
- [ ] **Step 5: Commit** — `git commit -am "feat: STL download button and end-to-end verification"`
- [ ] **Step 6: Write the run instructions** into `README.md`: `./serve.sh` then open `http://127.0.0.1:8137/`. Commit it with `git commit -m "docs: run instructions"`.