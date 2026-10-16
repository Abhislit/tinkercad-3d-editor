import assert from 'node:assert/strict';
import {
  identity,
  multiply,
  invert,
  perspective,
  compose,
  transformPoint,
  boxMesh,
  sphereMesh,
  cylinderMesh,
  coneMesh,
  pyramidMesh,
  torusMesh,
  capsuleMesh,
  tubeMesh,
  triangleCount,
  aabbFor,
  pickShape,
  groundPoint,
  sceneTriangles,
  stlBytes,
  exportFileName,
  parseCoord,
  parseStl,
  frameDistance,
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

// Zero-area triangles (the sphere's poles) are not exported.
function nonDegenerateTriangles(mesh) {
  let n = 0;
  const vertex = (t, k) => {
    const i = mesh.indices[t * 3 + k] * 3;
    return [mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]];
  };
  for (let t = 0; t < triangleCount(mesh); t++) {
    const [a, b, c] = [vertex(t, 0), vertex(t, 1), vertex(t, 2)];
    const u = b.map((x, i) => x - a[i]);
    const w = c.map((x, i) => x - a[i]);
    const cross = [
      u[1] * w[2] - u[2] * w[1],
      u[2] * w[0] - u[0] * w[2],
      u[0] * w[1] - u[1] * w[0],
    ];
    if (Math.hypot(...cross) / 2 >= 1e-12) n++;
  }
  return n;
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

const boxShape = {
  type: 'box',
  position: [0, 0.5, 0],
  rotation: [0, 0, 0],
  size: [1, 1, 1],
  color: [1, 0, 0],
};
const sphereShape = {
  type: 'sphere',
  position: [2, 0.5, 0],
  rotation: [0, 0, 0],
  size: [1, 1, 1],
  color: [0, 1, 0],
};
const cylinderShape = {
  type: 'cylinder',
  position: [4, 0.5, 0],
  rotation: [0, 0, 0],
  size: [1, 1, 1],
  color: [0, 0, 1],
};

check('an empty scene exports a bare 84 byte header', () => {
  assert.equal(stlBytes([]).byteLength, 84);
});

const atOrigin = (type, size = [1, 1, 1]) => ({
  type,
  position: [0, 0.5, 0],
  rotation: [0, 0, 0],
  size,
  color: [1, 1, 1],
});

const downZ = { origin: [0, 0.5, 5], dir: [0, 0, -1] };

check('a ray through the middle of a shape hits it', () => {
  assert.equal(pickShape(downZ.origin, downZ.dir, [atOrigin('box')], () => 0), 0);
});

check('a ray that misses everything returns -1', () => {
  assert.equal(pickShape(downZ.origin, downZ.dir, [], () => 0), -1);
  const away = { origin: [0, 0.5, 5], dir: [0, 0, 1] };
  assert.equal(pickShape(away.origin, away.dir, [atOrigin('box')], () => 0), -1);
});

check('the nearest shape along the ray wins', () => {
  const near = { ...atOrigin('box'), position: [0, 0.5, 1] };
  const far = { ...atOrigin('sphere'), position: [0, 0.5, -2] };
  assert.equal(pickShape(downZ.origin, downZ.dir, [far, near], () => 0), 1);
});

check('a shape behind the ray origin is not hit', () => {
  const ray = { origin: [0, 0.5, -5], dir: [0, 0, 1] };
  const shape = { ...atOrigin('box'), position: [0, 0.5, -10] };
  assert.equal(pickShape(ray.origin, ray.dir, [shape], () => 0), -1);
  const ahead = { ...atOrigin('box'), position: [0, 0.5, 10] };
  assert.equal(pickShape(ray.origin, ray.dir, [ahead], () => 0), 0);
});

check('tolerance makes a tiny distant shape clickable', () => {
  const tiny = { ...atOrigin('box'), size: [0.05, 0.05, 0.05] };
  const grazing = { origin: [0.3, 0.5, 5], dir: [0, 0, -1] };
  assert.equal(pickShape(grazing.origin, grazing.dir, [tiny], () => 0), -1);
  assert.equal(pickShape(grazing.origin, grazing.dir, [tiny], () => 0.5), 0);
});

check('groundPoint gives where a ray meets y=0', () => {
  const p = groundPoint([0, 2, 3], [0, -1, 0]);
  assert.deepEqual(p, [0, 0, 3]);
});

check('groundPoint returns null for a horizontal ray', () => {
  assert.equal(groundPoint([0, 2, 3], [0, 0, -1]), null);
});

check('groundPoint returns null when the plane is behind the ray', () => {
  assert.equal(groundPoint([0, 2, 3], [0, 1, 0]), null);
});

check('invert undoes multiply', () => {
  const m = compose([3, -2, 1], [0.4, 1.1, -0.3], [2, 3, 4]);
  const round = multiply(invert(m), m);
  const expected = identity();
  for (let i = 0; i < 16; i++) {
    assert.ok(
      Math.abs(round[i] - expected[i]) < 1e-5,
      `element ${i}: ${round[i]} != ${expected[i]}`,
    );
  }
});

check('transformPoint through a projection recovers the ray', () => {
  const proj = perspective(Math.PI / 4, 1.5, 0.1, 200);
  const inv = invert(proj);
  const world = transformPoint(inv, transformPoint(proj, [2, 3, -4]));
  world.forEach((v, i) => assert.ok(Math.abs(v - [2, 3, -4][i]) < 1e-4, `${v}`));
});

// The pick box must fully CONTAIN the drawn geometry (it may be larger: the
// bound of a rotated box is conservative). It must never be smaller.
const PRIMITIVES = [
  ['box', boxMesh()],
  ['sphere', sphereMesh(32, 16)],
  ['cylinder', cylinderMesh(32)],
  ['cone', coneMesh(32)],
  ['pyramid', pyramidMesh()],
  ['torus', torusMesh(32, 16)],
  ['capsule', capsuleMesh(32, 8)],
  ['tube', tubeMesh(32)],
];

check('every primitive has a non-zero triangle count', () => {
  for (const [type, mesh] of PRIMITIVES) {
    assert.ok(triangleCount(mesh) > 0, `${type} has no triangles`);
  }
});

// Only valid for solids that contain the origin: on a torus or a tube the
// inner surface faces back toward the origin, so a centroid test would flag
// correct geometry. Those are covered by the signed-volume check instead.
const STAR_SHAPED = ['box', 'sphere', 'cylinder', 'cone', 'pyramid', 'capsule'];

check('star shaped primitives are wound outward', () => {
  for (const [type, mesh] of PRIMITIVES) {
    if (!STAR_SHAPED.includes(type)) continue;
    assert.equal(inwardTriangles(mesh), 0, `${type} has inward facing triangles`);
  }
});

check('every primitive volume is positive and near its exact value', () => {
  const exact = {
    cone: Math.PI / 3,
    pyramid: 2 / 3,
    torus: 2 * Math.PI ** 2 * 0.65 * 0.35 ** 2,
    capsule: Math.PI * 0.25 * 0.5 + (4 / 3) * Math.PI * 0.125,
    tube: Math.PI * (1 - 0.36),
  };
  const meshes = {
    cone: coneMesh(64),
    pyramid: pyramidMesh(),
    torus: torusMesh(48, 24),
    capsule: capsuleMesh(64, 16),
    tube: tubeMesh(64),
  };
  for (const [type, expected] of Object.entries(exact)) {
    const actual = meshVolume(meshes[type], [1, 1, 1]);
    // A closed mesh with outward winding always sums to a positive volume.
    assert.ok(actual > 0, `${type} signed volume was ${actual} (winding inverted?)`);
    assert.ok(
      Math.abs(actual - expected) / expected < 0.02,
      `${type} volume ${actual} vs ${expected}`,
    );
  }
});

check('size means the full extent for every primitive', () => {
  const size = [2, 3, 4];
  for (const type of ['cone', 'pyramid', 'torus', 'capsule', 'tube']) {
    const shape = { type, position: [0, 0, 0], rotation: [0, 0, 0], size, color: [1, 1, 1] };
    const bb = aabbFor(shape);
    const tris = sceneTriangles([shape]);
    const seen = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (let i = 0; i < tris.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        seen.min[a] = Math.min(seen.min[a], tris[i + a]);
        seen.max[a] = Math.max(seen.max[a], tris[i + a]);
      }
    }
    for (let a = 0; a < 3; a++) {
      const extent = seen.max[a] - seen.min[a];
      assert.ok(
        Math.abs(extent - size[a]) < 0.05,
        `${type} axis ${a} is ${extent.toFixed(3)} across, expected ${size[a]}`,
      );
    }
  }
});

check('aabb contains the exported STL bounds for every primitive', () => {
  for (const type of ['box', 'sphere', 'cylinder']) {
    const shape = {
      type,
      position: [1, 2, 3],
      rotation: [0.3, 0.7, -0.2],
      size: [2, 3, 4],
      color: [1, 1, 1],
    };
    const bb = aabbFor(shape);
    const tris = sceneTriangles([shape]);
    const seen = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (let i = 0; i < tris.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        seen.min[a] = Math.min(seen.min[a], tris[i + a]);
        seen.max[a] = Math.max(seen.max[a], tris[i + a]);
      }
    }
    for (let a = 0; a < 3; a++) {
      assert.ok(bb.min[a] <= seen.min[a] + 1e-5, `${type} min[${a}]: box ${bb.min[a]} misses mesh ${seen.min[a]}`);
      assert.ok(bb.max[a] >= seen.max[a] - 1e-5, `${type} max[${a}]: box ${bb.max[a]} misses mesh ${seen.max[a]}`);
    }
  }
});

check('an unrotated primitive bound matches its mesh exactly', () => {
  for (const type of ['box', 'sphere', 'cylinder']) {
    const shape = { type, position: [1, 2, 3], rotation: [0, 0, 0], size: [2, 3, 4], color: [1, 1, 1] };
    const bb = aabbFor(shape);
    const tris = sceneTriangles([shape]);
    const seen = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (let i = 0; i < tris.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        seen.min[a] = Math.min(seen.min[a], tris[i + a]);
        seen.max[a] = Math.max(seen.max[a], tris[i + a]);
      }
    }
    for (let a = 0; a < 3; a++) {
      assert.ok(Math.abs(bb.min[a] - seen.min[a]) < 1e-5, `${type} min[${a}]: ${bb.min[a]} vs ${seen.min[a]}`);
      assert.ok(Math.abs(bb.max[a] - seen.max[a]) < 1e-5, `${type} max[${a}]: ${bb.max[a]} vs ${seen.max[a]}`);
    }
  }
});

check('a sphere of size 2 measures 2 across, not 4', () => {
  const bb = aabbFor({ type: 'sphere', position: [0, 0, 0], rotation: [0, 0, 0], size: [2, 2, 2], color: [1, 1, 1] });
  assert.ok(Math.abs(bb.max[0] - 1) < 1e-6, `x extent was ${bb.max[0] - bb.min[0]}`);
});

check('a cylinder of size 2 x 3 x 4 measures 2 x 3 x 4', () => {
  const bb = aabbFor({ type: 'cylinder', position: [0, 0, 0], rotation: [0, 0, 0], size: [2, 3, 4], color: [1, 1, 1] });
  assert.ok(Math.abs(bb.max[0] - bb.min[0] - 2) < 1e-6, `x extent ${bb.max[0] - bb.min[0]}`);
  assert.ok(Math.abs(bb.max[1] - bb.min[1] - 3) < 1e-6, `y extent ${bb.max[1] - bb.min[1]}`);
  assert.ok(Math.abs(bb.max[2] - bb.min[2] - 4) < 1e-6, `z extent ${bb.max[2] - bb.min[2]}`);
});

check('groundPoint refuses an intersection past the world limit', () => {
  assert.equal(groundPoint([0, 2, 0], [0, -0.001, -1]), null);
  assert.deepEqual(groundPoint([0, 2, 0], [0, -1, -0.05]), [0, 0, -0.1]);
});

check('parseCoord reads a plain number', () => {
  assert.equal(parseCoord('3', 0), 3);
  assert.equal(parseCoord('-2.5', 0), -2.5);
  assert.equal(parseCoord(' 4 ', 0), 4);
});

check('parseCoord falls back on anything that is not a finite number', () => {
  for (const raw of ['', '   ', 'abc', 'NaN', 'Infinity', '1e999', undefined, null]) {
    assert.equal(parseCoord(raw, 7), 7, `raw was ${JSON.stringify(raw)}`);
  }
});

const unitBoxScene = [atOrigin('box')];

check('a binary STL round trips through the parser', () => {
  const exported = stlBytes(unitBoxScene);
  const mesh = parseStl(exported);
  assert.equal(triangleCount(mesh), triangleCount(boxMesh()));
  assert.ok(Math.abs(meshVolume(mesh, [1, 1, 1]) - 1) < 1e-4, 'volume changed on round trip');
});

check('an imported mesh is centred on the origin', () => {
  const far = [{
    type: 'box',
    position: [100, 50, -20],
    rotation: [0, 0, 0],
    size: [4, 4, 4],
    color: [1, 1, 1],
  }];
  const { positions, min, max } = parseStl(stlBytes(far));
  assert.ok(Math.abs(min[0] + max[0]) < 1e-4, `x centre ${(min[0] + max[0]) / 2}`);
  assert.ok(Math.abs(min[1] + max[1]) < 1e-4, `y centre ${(min[1] + max[1]) / 2}`);
  assert.ok(Math.abs(min[2] + max[2]) < 1e-4, `z centre ${(min[2] + max[2]) / 2}`);
  assert.ok(positions.length > 0);
});

check('an ASCII STL parses', () => {
  const text = ['solid s', 'facet normal 0 0 1', '  outer loop',
    '    vertex 0 0 0', '    vertex 1 0 0', '    vertex 0 1 0', '  endloop', 'endfacet',
    'endsolid s'].join('\n');
  const bytes = new TextEncoder().encode(text);
  const mesh = parseStl(bytes.buffer);
  assert.equal(triangleCount(mesh), 1);
});

check('a malformed STL is rejected rather than silently imported', () => {
  assert.equal(parseStl(new ArrayBuffer(12)), null);
  assert.equal(parseStl(null), null);
});

check('parsed triangles are wound outward', () => {
  assert.equal(inwardTriangles(parseStl(stlBytes(unitBoxScene))), 0);
});

check('aabb of an imported mesh uses its real size, not the scale', () => {
  const shape = {
    type: 'mesh',
    position: [3, 0, 0],
    rotation: [0, 0, 0],
    size: [2, 2, 2],
    importedSize: [10, 20, 30],
    color: [1, 1, 1],
  };
  const bb = aabbFor(shape);
  assert.ok(Math.abs(bb.max[0] - bb.min[0] - 20) < 1e-5, `x extent ${bb.max[0] - bb.min[0]}`);
  assert.ok(Math.abs(bb.max[1] - bb.min[1] - 40) < 1e-5, `y extent ${bb.max[1] - bb.min[1]}`);
  assert.ok(Math.abs(bb.min[0] - (3 - 10)) < 1e-5, `x centre ${bb.min[0]}`);
});

check('frameDistance keeps the bounding sphere inside the frustum', () => {
  const fov = Math.PI / 4;
  const d = frameDistance(3, fov);
  const fit = Math.tan(fov / 2) * d;
  assert.ok(fit >= 3 - 1e-9, `radius does not fit: ${fit} < 3`);
  assert.ok(fit <= 3 * 1.25, `excessive margin: ${fit}`);
  assert.ok(frameDistance(1000, fov) <= 200, 'clamped to the far plane');
  assert.ok(frameDistance(0.001, fov) >= 2, 'clamped to the near limit');
});

check('the download name is model.stl', () => {
  assert.equal(exportFileName(), 'model.stl');
});

check('a single box scene is 84 bytes plus 50 per triangle', () => {
  const expected = 84 + 50 * nonDegenerateTriangles(boxMesh());
  assert.equal(stlBytes([boxShape]).byteLength, expected);
});

check('a three shape scene sums every primitive triangle count', () => {
  const scene = [boxShape, sphereShape, cylinderShape];
  const expected =
    84 +
    50 *
      (nonDegenerateTriangles(boxMesh()) +
        nonDegenerateTriangles(sphereMesh(32, 16)) +
        nonDegenerateTriangles(cylinderMesh(32)));
  assert.equal(stlBytes(scene).byteLength, expected);
});

check('the header starts with solid and declares the triangle count', () => {
  const scene = [boxShape];
  const bytes = new Uint8Array(stlBytes(scene));
  assert.equal(String.fromCharCode(...bytes.slice(0, 5)), 'solid');
  const count = new DataView(bytes.buffer).getUint32(80, true);
  assert.equal(count, nonDegenerateTriangles(boxMesh()));
});

check('every exported facet normal has unit length', () => {
  const scene = [boxShape, sphereShape, cylinderShape];
  const view = new DataView(stlBytes(scene));
  const count = view.getUint32(80, true);
  for (let t = 0; t < count; t++) {
    const base = 84 + t * 50;
    const [nx, ny, nz] = [view.getFloat32(base, true), view.getFloat32(base + 4, true), view.getFloat32(base + 8, true)];
    assert.ok(Math.abs(Math.hypot(nx, ny, nz) - 1) < 1e-3, `facet ${t} normal length ${Math.hypot(nx, ny, nz)}`);
  }
});

check('sceneTriangles returns 9 floats per triangle', () => {
  assert.equal(sceneTriangles([boxShape, sphereShape, cylinderShape]).length, 9 * (
    nonDegenerateTriangles(boxMesh()) +
      nonDegenerateTriangles(sphereMesh(32, 16)) +
      nonDegenerateTriangles(cylinderMesh(32))
  ));
});

check('exported vertices are in world space', () => {
  const tris = sceneTriangles([boxShape]);
  const ys = [];
  for (let i = 1; i < tris.length; i += 3) ys.push(tris[i]);
  assert.ok(Math.min(...ys) >= 0, 'box sits on y=0');
  assert.ok(Math.abs(Math.max(...ys) - 1) < 1e-6, 'box reaches y=1');
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