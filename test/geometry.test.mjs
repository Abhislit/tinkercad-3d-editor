import assert from 'node:assert/strict';
import {
  identity,
  multiply,
  transformPoint,
  boxMesh,
  sphereMesh,
  cylinderMesh,
  triangleCount,
  aabbFor,
} from '../src/geometry.js';

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

check('identity maps a point to itself', () => {
  assert.deepEqual(Array.from(transformPoint(identity(), [1, 2, 3])), [1, 2, 3]);
});

check('identity multiplied by identity is identity', () => {
  assert.deepEqual(Array.from(multiply(identity(), identity())), Array.from(identity()));
});

check('unit cube has 12 triangles', () => {
  assert.equal(triangleCount(boxMesh()), 12);
});

check('cylinder with 16 segments has 4 triangles per segment', () => {
  assert.equal(triangleCount(cylinderMesh(16)), 16 * 4);
});

// Signed volume. A negative result means the mesh is wound inward, which
// breaks back-face culling and inverts the STL — so this must stay signed.
function meshVolume(mesh, scale) {
  const [sx, sy, sz] = scale;
  let vol = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const p = [0, 1, 2].map((k) => {
      const idx = mesh.indices[i + k] * 3;
      return [
        mesh.positions[idx] * sx,
        mesh.positions[idx + 1] * sy,
        mesh.positions[idx + 2] * sz,
      ];
    });
    const [a, b, c] = p;
    vol +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
  }
  return vol;
}

function inwardTriangles(mesh) {
  let inward = 0;
  const vertex = (t, k) => {
    const i = mesh.indices[t * 3 + k] * 3;
    return [mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]];
  };
  for (let t = 0; t < triangleCount(mesh); t++) {
    const [a, b, c] = [vertex(t, 0), vertex(t, 1), vertex(t, 2)];
    const u = b.map((x, i) => x - a[i]);
    const w = c.map((x, i) => x - a[i]);
    const n = [
      u[1] * w[2] - u[2] * w[1],
      u[2] * w[0] - u[0] * w[2],
      u[0] * w[1] - u[1] * w[0],
    ];
    if (Math.hypot(...n) / 2 < 1e-9) continue; // degenerate pole triangles
    const ctr = [0, 1, 2].map((i) => (a[i] + b[i] + c[i]) / 3);
    const len = Math.hypot(...ctr);
    const outward = ctr.map((x) => x / len);
    if (n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2] <= 0) inward++;
  }
  return inward;
}

check('sphere volume converges to 4/3 pi within 2%', () => {
  const expected = (4 / 3) * Math.PI;
  const actual = meshVolume(sphereMesh(64, 32), [1, 1, 1]);
  assert.ok(actual > 0, `signed volume must be positive, got ${actual}`);
  assert.ok(
    Math.abs(actual - expected) / expected < 0.02,
    `volume ${actual} vs ${expected} (${((actual - expected) / expected) * 100}%)`,
  );
});

check('cylinder volume converges to pi within 2%', () => {
  const expected = Math.PI;
  const actual = meshVolume(cylinderMesh(64), [1, 1, 1]);
  assert.ok(actual > 0, `signed volume must be positive, got ${actual}`);
  assert.ok(
    Math.abs(actual - expected) / expected < 0.02,
    `volume ${actual} vs ${expected} (${((actual - expected) / expected) * 100}%)`,
  );
});

check('a 90 degree turn about Y swaps the x and z extents', () => {
  const bb = aabbFor({
    type: 'box',
    position: [0, 0, 0],
    rotation: [0, Math.PI / 2, 0],
    size: [2, 1, 1],
  });
  const close = (got, want) =>
    assert.ok(
      Math.abs(got - want) < 1e-9,
      `${got} != ${want}`,
    );
  bb.min.forEach((v, i) => close(v, [-0.5, -0.5, -1][i]));
  bb.max.forEach((v, i) => close(v, [0.5, 0.5, 1][i]));
});

check('aabb of an unrotated box equals its extents', () => {
  const bb = aabbFor({
    type: 'box',
    position: [1, 2, 3],
    rotation: [0, 0, 0],
    size: [2, 4, 6],
  });
  assert.deepEqual(bb.min, [0, 0, 0]);
  assert.deepEqual(bb.max, [2, 4, 6]);
});

check('sphere aabb is symmetric about its position', () => {
  const bb = aabbFor({
    type: 'sphere',
    position: [5, 1, -2],
    rotation: [0, 0, 0],
    size: [2, 2, 2],
  });
  assert.deepEqual(bb.min, [4, 0, -3]);
  assert.deepEqual(bb.max, [6, 2, -1]);
});

check('every primitive is wound outward', () => {
  for (const mesh of [boxMesh(), sphereMesh(16, 8), cylinderMesh(16)]) {
    assert.equal(inwardTriangles(mesh), 0);
  }
});

if (failures) {
  console.error(`geometry: ${failures} failing`);
  process.exit(1);
}
console.log('geometry ok');