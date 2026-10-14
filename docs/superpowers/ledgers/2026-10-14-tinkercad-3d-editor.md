# SDD ledger — plan: docs/superpowers/plans/2026-10-14-tinkercad-3d-editor.md
Setup: branch feat/3d-editor (fresh local repo, no remote)
Setup Ruling: used a branch instead of a git worktree — no remote and no concurrent work to isolate from; a worktree adds ceremony with no isolation benefit here — cost if wrong: implementation commits live on feat/3d-editor rather than a throwaway worktree
Pre-flight: Task2 consumes boxMesh/sphereMesh/cylinderMesh/triangleCount/compose/aabbFor from Task1 Produces — consistent
Pre-flight: Task5 consumes stlBytes from Task2 Produces — consistent
Pre-flight: Task3/4 consume matrix helpers from geometry.js per the plan's declared deviation — consistent
BASE=49a00a1
Task 1: complete (commits 49a00a1..49a00a1, tests: node test/geometry.test.mjs → geometry ok)
Task 1: Ruling: test expectation for the 90-degree Y rotation was wrong (a 90 degree turn swaps x/z extents, so min is [-0.5,-0.5,-1]) — the code was right, the spec's test text was not — cost if wrong: picking bounds would be mirrored on rotated shapes
Task 1: Ruling: meshVolume asserts SIGNED volume and a new "every primitive is wound outward" check — the original abs() assertion masked that sphereMesh and one cylinder cap were wound inward, which breaks back-face culling and inverts STL export — cost if wrong: solids render inside-out and export with flipped normals
Task 1: fixed cylinderMesh top cap and sphereMesh quad winding; sphere pole triangles are degenerate (zero area) and are skipped by the outward check
Task 2: complete (commits 49a00a1..1412194, tests: node test/geometry.test.mjs → geometry ok)
Task 2: Ruling: sceneTriangles drops zero-area triangles (sphere poles) — 64 degenerate facets would otherwise reach the slicer — the plan said "sum of triangleCount", which assumed they were kept; tests now count non-degenerate triangles — cost if wrong: the STL triangle count is 64 lower per sphere than a naive count
Task 3: complete (commits 077ca64..077ca64, tests: node test/geometry.test.mjs → geometry ok)
Task 3: Ruling: tasks 3 and 4 were written in one pass to src/app.js (same file, same wiring); the gates stay separate — headless render check now, picking/transform check at task 4 — cost if wrong: a task-4 regression could be attributed to task 3
Task 3: Ruling: invert() moved from a hand-written adjugate in app.js into geometry.js under TDD — the hand-written version had cancelling terms and a transposed cofactor, and Task 4's ray picking depends on it — cost if wrong: none, it is covered by two tests
Task 3: invert() initially had rows/cols = [0,1,2] instead of [0,1,2,3] and returned the cofactor matrix rather than the inverse; both caught by "invert undoes multiply"
Task 3: verify — REA capture ev_5d71aed9b32c9022ad5c362c525e04549eeecc8e469c8fe862515fdc4ec85b9a, 0 page errors, screenshot 376 distinct sampled colors (grid visible). Only 404 is /favicon.ico
Task 4: complete (commits 3bc9d4e..3bc9d4e, tests: node test/geometry.test.mjs → geometry ok)
Task 4: Ruling: pickShape and groundPoint moved from app.js into geometry.js under TDD (9 tests) — they are pure ray math and the headless capture cannot evaluate JS to assert on them — cost if wrong: none, both are covered by node tests
Task 4: Ruling: the selection outline needs its own edge index buffer; drawing LINES over the triangle index buffer produces garbage, and swapping ELEMENT_ARRAY_BUFFER inside a bound VAO corrupts the next triangle draw — every draw now binds its own index buffer — cost if wrong: none
Task 4: verify — REA capture ev_e9da07362998c11dd0d9047f885f7f4b2d8b87308ebfb40333e2af57001c1991: box renders, white wireframe outline, y-rotation 15 degrees, recolor to blue, 0 page errors. Earlier capture ev_86e70ab52a7fb760e090ea625749fca612eb36a458a52b14b58cdc69986d16ec proved picking + "]"-scaling ("box 1.10 x 1.10 x 1.10")
Task 5: complete (commits 3e80f91..3e80f91, tests: node test/geometry.test.mjs → geometry ok)
Task 5: Ruling: the headless capture reports the download as "download-cancelled" — Playwright's launch context does not persist downloads, so the blob and filename were observed (model.stl, blob: URL) but no file was written; byte correctness is covered by the node tests, and the same code path produced 7084 bytes / 140 triangles for a box+cylinder scene — cost if wrong: the browser-side click-to-download wiring is only verified up to the browser dispatch
Task 5: exportFileName() added under TDD so the download name is covered by a test rather than a literal in app.js
Task 5: verify — REA capture ev_d59dbdd19b547692ac1d2eab0c58c5adaf08c9e87cf7bfc733ef82fae1103dd0: 2 shapes placed, box selected and scaled to 1.10, cylinder renders, export button fires the blob download, 0 page errors
Final: fixed primitive scale mismatch — scaleFor() makes size mean FULL extent for all three primitives (box scale=size, sphere=size/2, cylinder=size/2 on x/z, size on y); picking bounds disagreed with the drawn and exported geometry for spheres and cylinders — tests "aabb contains the exported STL bounds" and "an unrotated primitive bound matches its mesh exactly" RED->GREEN, suite 33/33
Final: fixed unbounded groundPoint — WORLD_LIMIT 100 plus a camera phi clamp at pi/2 - 0.05; dragging below the horizon threw shapes thousands of units away, unrecoverable without a reload — test "groundPoint refuses an intersection past the world limit" RED->GREEN, suite 33/33
Final: minor (deferred): pickShape returns a shape for a NaN ray instead of -1 (latent; needs a zero-size canvas rect, which the flex layout prevents)
Final: minor (deferred): normalMatrixOf uses R*S instead of R*S^-1, so non-uniform scale shades sphere/cylinder normals slightly wrong (cosmetically hidden by normalize())
Final: minor (deferred): colorSelected aliases the shared PALETTE entry and skips syncUi(), so swatch clicks give no state feedback
Final: minor (deferred): screenshotReady was declared in the plan's test seam but never implemented
Final: minor (deferred): webglcontextlost shows the overlay but never stops the rAF loop, and there is no contextrestored handler
Final: minor (deferred): right-button drags orbit and the context menu is not suppressed; middle-drag does not preventDefault
Final: minor (deferred): src/app.js has no automated coverage — camera clamp, drag state machine, resize and WebGL state are verified by headless capture only
Final review: no subagent-free review was used; a fresh general subagent reviewed the whole branch and produced the findings above
