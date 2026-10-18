import assert from 'node:assert/strict';
import { boxMesh } from '../src/geometry.js';
import {
  union,
  subtract,
  intersect,
  meshToTriangles,
  trianglesToMesh,
} from '../src/csg.js';

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

// An axis-aligned box as triangle soup, wound so the signed volume is positive.
// `lo`/`hi` are the min and max corners.
function box(lo, hi) {
  const [x0, y0, z0] = lo;
  const [x1, y1, z1] = hi;
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  // Outward-facing triangles (right-hand rule), each quad split into two.
  const faces = [
    [0, 3, 2], [0, 2, 1], // bottom (z0), normal -z
    [4, 5, 6], [4, 6, 7], // top (z1), normal +z
    [0, 1, 5], [0, 5, 4], // front (y0), normal -y
    [3, 7, 6], [3, 6, 2], // back (y1), normal +y
    [0, 4, 7], [0, 7, 3], // left (x0), normal -x
    [1, 2, 6], [1, 6, 5], // right (x1), normal +x
  ];
  return faces.map((f) => f.map((i) => v[i]));
}

// Signed volume of a triangle soup, via the divergence theorem: sum of signed
// tetrahedra from the origin to each triangle. Positive = outward winding.
function soupVolume(soup) {
  let vol = 0;
  for (const [a, b, c] of soup) {
    vol +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
  }
  return vol;
}

// A degenerate "boolean that removes everything" — a box that fully covers the
// solid, subtracted, must leave nothing behind.
function boxVolume(soup) {
  return Math.abs(soupVolume(soup));
}

const unit = box([-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]); // volume 1
const big = box([-1.5, -1.5, -1.5], [1.5, 1.5, 1.5]); // volume 27

// --- basic union ---------------------------------------------------------

check('union of a shape with itself is that shape', () => {
  const u = union(unit, unit);
  assert.ok(Math.abs(boxVolume(u) - 1) < 1e-6, `got ${boxVolume(u)}`);
});

check('union of two identical cubes collapses to one (coplanar-identical)', () => {
  const u = union(unit, unit);
  assert.ok(Math.abs(boxVolume(u) - 1) < 1e-6, `got ${boxVolume(u)}`);
});

check('union of two disjoint cubes sums their volumes', () => {
  const a = box([-1, -0.5, -0.5], [0, 0.5, 0.5]); // volume 1, x in [-1,0]
  const b = box([0.25, -0.5, -0.5], [1.25, 0.5, 0.5]); // volume 1, x in [0.25,1.25]
  const u = union(a, b);
  assert.ok(Math.abs(boxVolume(u) - 2) < 1e-6, `got ${boxVolume(u)}`);
});

check('union of two overlapping cubes is less than their sum', () => {
  const a = box([-1, -0.5, -0.5], [0.5, 0.5, 0.5]); // x in [-1,0.5]
  const b = box([-0.5, -0.5, -0.5], [1, 0.5, 0.5]); // x in [-0.5,1]
  const u = union(a, b);
  const vol = boxVolume(u); // union x span is [-1,1] = 2
  assert.ok(Math.abs(vol - 2) < 1e-6, `got ${vol}`);
});

// --- basic subtract ------------------------------------------------------

check('subtract a unit cube from a 3x3x3 cube removes exactly 1', () => {
  // big has volume 27; removing the concentric unit cube leaves 26.
  const s = subtract(big, unit);
  assert.ok(Math.abs(boxVolume(s) - 26) < 1e-5, `got ${boxVolume(s)}`);
});

check('subtract two disjoint solids leaves the first unchanged', () => {
  const a = box([-1, -0.5, -0.5], [0, 0.5, 0.5]); // x in [-1,0]
  const far = box([5, -0.5, -0.5], [6, 0.5, 0.5]); // far away, disjoint
  const s = subtract(a, far);
  assert.ok(Math.abs(boxVolume(s) - 1) < 1e-6, `got ${boxVolume(s)}`);
});

check('subtract a shape from itself leaves nothing', () => {
  const s = subtract(unit, unit);
  assert.ok(s.length === 0, `expected no triangles, got ${s.length}`);
});

check('subtracting a fully enclosing box yields zero triangles', () => {
  const tiny = box([-0.1, -0.1, -0.1], [0.1, 0.1, 0.1]);
  const enclosing = box([-5, -5, -5], [5, 5, 5]);
  const s = subtract(tiny, enclosing);
  assert.ok(s.length === 0, `expected no triangles, got ${s.length}`);
});

// --- coincident / butted faces ------------------------------------------

check('two boxes butted flush do not throw and yield positive volume', () => {
  const a = box([0, 0, 0], [1, 1, 1]);
  const b = box([1, 0, 0], [2, 1, 1]); // shares the x=1 face exactly
  let u;
  assert.doesNotThrow(() => {
    u = union(a, b);
  });
  assert.ok(boxVolume(u) > 0, 'volume must be positive');
  assert.ok(Math.abs(boxVolume(u) - 2) < 1e-5, `got ${boxVolume(u)}`);
});

check('subtracting a flush-butted neighbour removes only the overlap', () => {
  const a = box([0, 0, 0], [2, 1, 1]); // volume 2
  const b = box([1, 0, 0], [3, 1, 1]); // overlaps a over x in [1,2], volume 2
  const s = subtract(a, b);
  // Overlap is x in [1,2] (volume 1); a had volume 2, so 1 remains.
  assert.ok(Math.abs(boxVolume(s) - 1) < 1e-5, `got ${boxVolume(s)}`);
});

// --- intersect ----------------------------------------------------------

check('intersect of two identical cubes is that cube', () => {
  const i = intersect(unit, unit);
  assert.ok(Math.abs(boxVolume(i) - 1) < 1e-6, `got ${boxVolume(i)}`);
});

check('intersect of two disjoint cubes is empty', () => {
  const a = box([-1, -0.5, -0.5], [0, 0.5, 0.5]);
  const b = box([5, -0.5, -0.5], [6, 0.5, 0.5]);
  const i = intersect(a, b);
  assert.ok(i.length === 0, `expected no triangles, got ${i.length}`);
});

check('intersect of two overlapping cubes is their overlap', () => {
  const a = box([-1, 0, 0], [0.5, 1, 1]); // x in [-1,0.5]
  const b = box([-0.5, 0, 0], [1, 1, 1]); // x in [-0.5,1]
  const i = intersect(a, b); // overlap x in [-0.5,0.5] = width 1, volume 1
  assert.ok(Math.abs(boxVolume(i) - 1) < 1e-5, `got ${boxVolume(i)}`);
});

// --- soup <-> mesh -------------------------------------------------------

check('meshToTriangles on a box mesh yields 12 triangles', () => {
  const soup = meshToTriangles(boxMesh());
  assert.equal(soup.length, 12);
});

check('meshToTriangles agrees with boxMesh winding (positive volume)', () => {
  assert.ok(soupVolume(meshToTriangles(boxMesh())) > 0, 'boxMesh must wind outward');
});

check('trianglesToMesh round-trips positions through meshToTriangles', () => {
  const mesh = trianglesToMesh(unit);
  assert.equal(mesh.indices.length, unit.length * 3);
  assert.equal(mesh.positions.length, unit.length * 9);
  const back = meshToTriangles(mesh);
  assert.equal(back.length, unit.length);
});

check('trianglesToMesh preserves the box volume through a round trip', () => {
  const mesh = trianglesToMesh(unit);
  const back = meshToTriangles(mesh);
  assert.ok(Math.abs(boxVolume(back) - 1) < 1e-9, `got ${boxVolume(back)}`);
});

check('trianglesToMesh output works with subtract (mesh pipeline is live)', () => {
  const bigMesh = trianglesToMesh(big);
  const unitSoup = meshToTriangles(bigMesh);
  const s = subtract(unitSoup, unit);
  assert.ok(Math.abs(boxVolume(s) - 26) < 1e-5, `got ${boxVolume(s)}`);
});

if (failures) {
  console.error(`\n${failures} csg check(s) failed`);
  process.exit(1);
}
console.log('csg: all checks passed');