// Pure math for the editor: matrices, primitives, bounds, STL bytes.
// No DOM, no WebGL — everything here is testable under plain node.

export function identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

// Column-major, WebGL convention: m[col * 4 + row].
export function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

// Cofactor inverse. Column-major: element (row r, col c) is m[c * 4 + r].
export function invert(m) {
  const at = (r, c) => m[c * 4 + r];
  const cofactor = (r, c) => {
    const rows = [0, 1, 2, 3].filter((x) => x !== r);
    const cols = [0, 1, 2, 3].filter((x) => x !== c);
    const minor = [
      at(rows[0], cols[0]), at(rows[0], cols[1]), at(rows[0], cols[2]),
      at(rows[1], cols[0]), at(rows[1], cols[1]), at(rows[1], cols[2]),
      at(rows[2], cols[0]), at(rows[2], cols[1]), at(rows[2], cols[2]),
    ];
    return (
      minor[0] * (minor[4] * minor[8] - minor[5] * minor[7]) -
      minor[1] * (minor[3] * minor[8] - minor[5] * minor[6]) +
      minor[2] * (minor[3] * minor[7] - minor[4] * minor[6])
    ) * ((r + c) % 2 ? -1 : 1);
  };
  let det = 0;
  for (let c = 0; c < 4; c++) det += at(0, c) * cofactor(0, c);
  const out = new Float32Array(16);
  if (!det) return out; // singular: caller gets a zero matrix, ray math degrades
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) out[c * 4 + r] = cofactor(c, r) / det;
  }
  return out;
}

export function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function lookAt(eye, center, up) {
  const f = normalize([center[0] - eye[0], center[1] - eye[1], center[2] - eye[2]]);
  const s = normalize(cross(f, up));
  const u = cross(s, f);
  return new Float32Array([
    s[0], u[0], -f[0], 0,
    s[1], u[1], -f[1], 0,
    s[2], u[2], -f[2], 0,
    -(s[0] * eye[0] + s[1] * eye[1] + s[2] * eye[2]),
    -(u[0] * eye[0] + u[1] * eye[1] + u[2] * eye[2]),
    f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2],
    1,
  ]);
}

// Translation * Rotation(Y * X * Z) * Scale.
export function compose(position, rotation, size) {
  const [rx, ry, rz] = rotation;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);

  const r00 = cy * cz + sy * sx * sz;
  const r01 = -cy * sz + sy * sx * cz;
  const r02 = sy * cx;
  const r10 = cx * sz;
  const r11 = cx * cz;
  const r12 = -sx;
  const r20 = -sy * cz + cy * sx * sz;
  const r21 = sy * sz + cy * sx * cz;
  const r22 = cy * cx;

  const [sxS, syS, szS] = size;
  return new Float32Array([
    r00 * sxS, r10 * sxS, r20 * sxS, 0,
    r01 * syS, r11 * syS, r21 * syS, 0,
    r02 * szS, r12 * szS, r22 * szS, 0,
    position[0], position[1], position[2], 1,
  ]);
}

export function transformPoint(m, p) {
  const [x, y, z] = p;
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

// Outward-facing normal of the triangle (a, b, c), used for flat facets.
function faceNormal(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return normalize([
    u[1] * w[2] - u[2] * w[1],
    u[2] * w[0] - u[0] * w[2],
    u[0] * w[1] - u[1] * w[0],
  ]);
}

class MeshBuilder {
  constructor() {
    this.p = [];
    this.n = [];
    this.i = [];
  }

  vertex(pos, nor) {
    this.p.push(pos[0], pos[1], pos[2]);
    this.n.push(nor[0], nor[1], nor[2]);
    return this.p.length / 3 - 1;
  }

  tri(a, b, c) {
    this.i.push(a, b, c);
  }

  quad(a, b, c, d) {
    this.i.push(a, b, c, a, c, d);
  }

  build() {
    return {
      positions: new Float32Array(this.p),
      normals: new Float32Array(this.n),
      indices: new Uint16Array(this.i),
    };
  }
}

export function triangleCount(mesh) {
  return mesh.indices.length / 3;
}

// Unit cube: centered at the origin, extents 1, flat per-face normals.
export function boxMesh() {
  const b = new MeshBuilder();
  const faces = [
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  ];
  for (const { n, u, v } of faces) {
    const corner = (su, sv) => [
      (n[0] + u[0] * su + v[0] * sv) / 2,
      (n[1] + u[1] * su + v[1] * sv) / 2,
      (n[2] + u[2] * su + v[2] * sv) / 2,
    ];
    const a = b.vertex(corner(-1, -1), n);
    const bb = b.vertex(corner(1, -1), n);
    const c = b.vertex(corner(1, 1), n);
    const d = b.vertex(corner(-1, 1), n);
    b.quad(a, bb, c, d);
  }
  return b.build();
}

// Unit sphere, smooth-shaded (normal == normalized position).
export function sphereMesh(segments, rings) {
  const b = new MeshBuilder();
  const grid = [];
  for (let r = 0; r <= rings; r++) {
    const theta = (r / rings) * Math.PI;
    const row = [];
    for (let s = 0; s <= segments; s++) {
      const phi = (s / segments) * Math.PI * 2;
      const n = [
        Math.sin(theta) * Math.cos(phi),
        Math.cos(theta),
        Math.sin(theta) * Math.sin(phi),
      ];
      row.push(b.vertex(n, n));
    }
    grid.push(row);
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      b.quad(grid[r][s], grid[r][s + 1], grid[r + 1][s + 1], grid[r + 1][s]);
    }
  }
  return b.build();
}

// Unit cylinder: radius 1, height 1 centered on the origin, flat normals.
export function cylinderMesh(segments) {
  const b = new MeshBuilder();
  const hy = 0.5;
  for (let s = 0; s < segments; s++) {
    const a0 = (s / segments) * Math.PI * 2;
    const a1 = ((s + 1) / segments) * Math.PI * 2;
    const n0 = [Math.cos(a0), 0, Math.sin(a0)];
    const n1 = [Math.cos(a1), 0, Math.sin(a1)];
    const p00 = b.vertex([n0[0], -hy, n0[2]], n0);
    const p10 = b.vertex([n0[0], hy, n0[2]], n0);
    const p11 = b.vertex([n1[0], hy, n1[2]], n1);
    const p01 = b.vertex([n1[0], -hy, n1[2]], n1);
    b.quad(p00, p10, p11, p01);

    const up = [0, 1, 0];
    const top = b.vertex([0, hy, 0], up);
    const t1 = b.vertex([n0[0], hy, n0[2]], up);
    const t2 = b.vertex([n1[0], hy, n1[2]], up);
    b.tri(top, t2, t1);

    const down = [0, -1, 0];
    const bot = b.vertex([0, -hy, 0], down);
    const b1 = b.vertex([n1[0], -hy, n1[2]], down);
    const b2 = b.vertex([n0[0], -hy, n0[2]], down);
    b.tri(bot, b2, b1);
  }
  return b.build();
}

// Meshes are authored with unit radius / unit height, so size means the FULL
// extent of a shape. Box: scale = size. Sphere: scale = size / 2 (diameter).
// Cylinder: radius scale = size / 2 on x and z, height scale = size[1].
export function scaleFor(shape) {
  const [w, h, d] = shape.size;
  if (shape.type === 'sphere') return [w / 2, h / 2, d / 2];
  if (shape.type === 'capsule') return [w, h / CAPSULE_HEIGHT, d];
  if (shape.type === 'torus') return [w / 2, h / (2 * TORUS_MINOR), d / 2];
  if (shape.type === 'cone' || shape.type === 'pyramid' || shape.type === 'cylinder' || shape.type === 'tube') {
    return [w / 2, h, d / 2];
  }
  return [w, h, d];
}

// World-space bounds of the shape as it is actually drawn and exported.
export function aabbFor(shape) {
  // Every primitive ends up exactly `size` across once scaleFor is applied,
  // so the world-space bound is always size / 2.
  const half = [shape.size[0] / 2, shape.size[1] / 2, shape.size[2] / 2];
  const rot = compose([0, 0, 0], shape.rotation, [1, 1, 1]);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const corner = [
      half[0] * (i & 1 ? 1 : -1),
      half[1] * (i & 2 ? 1 : -1),
      half[2] * (i & 4 ? 1 : -1),
    ];
    const p = transformPoint(rot, corner);
    for (let a = 0; a < 3; a++) {
      if (p[a] < min[a]) min[a] = p[a];
      if (p[a] > max[a]) max[a] = p[a];
    }
  }
  return {
    min: min.map((v, a) => v + shape.position[a]),
    max: max.map((v, a) => v + shape.position[a]),
  };
}
const SPHERE_SEGMENTS = 32;
const SPHERE_RINGS = 16;
const CYLINDER_SEGMENTS = 32;
const CONE_SEGMENTS = 32;
const TORUS_MAJOR_SEGMENTS = 32;
const TORUS_MINOR_SEGMENTS = 16;
const CAPSULE_SEGMENTS = 32;
const CAPSULE_CAP_RINGS = 8;
const TUBE_SEGMENTS = 32;

const MESH_FACTORIES = {
  box: () => boxMesh(),
  sphere: () => sphereMesh(SPHERE_SEGMENTS, SPHERE_RINGS),
  cylinder: () => cylinderMesh(CYLINDER_SEGMENTS),
  cone: () => coneMesh(CONE_SEGMENTS),
  pyramid: () => pyramidMesh(),
  torus: () => torusMesh(TORUS_MAJOR_SEGMENTS, TORUS_MINOR_SEGMENTS),
  capsule: () => capsuleMesh(CAPSULE_SEGMENTS, CAPSULE_CAP_RINGS),
  tube: () => tubeMesh(TUBE_SEGMENTS),
};

const meshCache = new Map();
function meshFor(type) {
  if (!meshCache.has(type)) {
    meshCache.set(
      type,
      MESH_FACTORIES[type] ? MESH_FACTORIES[type]() : boxMesh(),
    );
  }
  return meshCache.get(type);
}

// World-space triangles, 9 floats per triangle. Degenerate triangles are
// dropped so they do not reach the STL.
export function sceneTriangles(scene) {
  const out = [];
  for (const shape of scene) {
    const mesh = meshFor(shape.type);
    const m = compose(shape.position, shape.rotation, scaleFor(shape));
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const world = [0, 1, 2].map((k) => {
        const idx = mesh.indices[i + k] * 3;
        return transformPoint(m, [
          mesh.positions[idx],
          mesh.positions[idx + 1],
          mesh.positions[idx + 2],
        ]);
      });
      const u = [0, 1, 2].map((a) => world[1][a] - world[0][a]);
      const w = [0, 1, 2].map((a) => world[2][a] - world[0][a]);
      const n = [
        u[1] * w[2] - u[2] * w[1],
        u[2] * w[0] - u[0] * w[2],
        u[0] * w[1] - u[1] * w[0],
      ];
      if (Math.hypot(...n) < 1e-12) continue;
      for (const v of world) out.push(v[0], v[1], v[2]);
    }
  }
  return new Float32Array(out);
}

// Binary STL: 80 byte header, uint32 triangle count, 50 bytes per facet.
export function stlBytes(scene) {
  const tris = sceneTriangles(scene);
  const count = tris.length / 9;
  const buffer = new ArrayBuffer(84 + 50 * count);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  for (let i = 0; i < 5; i++) bytes[i] = 'solid'.charCodeAt(i);
  view.setUint32(80, count, true);
  for (let t = 0; t < count; t++) {
    const o = t * 9;
    const a = [tris[o], tris[o + 1], tris[o + 2]];
    const b = [tris[o + 3], tris[o + 4], tris[o + 5]];
    const c = [tris[o + 6], tris[o + 7], tris[o + 8]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [
      u[1] * w[2] - u[2] * w[1],
      u[2] * w[0] - u[0] * w[2],
      u[0] * w[1] - u[1] * w[0],
    ];
    const len = Math.hypot(...n) || 1;
    n = n.map((v) => v / len);
    const base = 84 + t * 50;
    view.setFloat32(base, n[0], true);
    view.setFloat32(base + 4, n[1], true);
    view.setFloat32(base + 8, n[2], true);
    for (let v = 0; v < 9; v++) view.setFloat32(base + 12 + v * 4, tris[o + v], true);
    view.setUint16(base + 48, 0, true);
  }
  return buffer;
}

// Ray versus world-space AABB slab test, expanded by tol on every axis.
// Returns the index of the nearest shape along the ray, or -1.
export function pickShape(origin, dir, scene, tolFor) {
  let best = -1;
  let bestT = Infinity;
  scene.forEach((shape, i) => {
    const { min, max } = aabbFor(shape);
    const tol = tolFor ? tolFor(shape) : 0;
    let t0 = 0;
    let t1 = Infinity;
    for (let a = 0; a < 3; a++) {
      const lo = min[a] - tol;
      const hi = max[a] + tol;
      if (Math.abs(dir[a]) < 1e-8) {
        if (origin[a] < lo || origin[a] > hi) return;
        continue;
      }
      let near = (lo - origin[a]) / dir[a];
      let far = (hi - origin[a]) / dir[a];
      if (near > far) {
        const swap = near;
        near = far;
        far = swap;
      }
      if (near > t0) t0 = near;
      if (far < t1) t1 = far;
      if (t0 > t1) return;
    }
    if (t1 >= 0 && t0 < bestT) {
      bestT = t0;
      best = i;
    }
  });
  return best;
}

// Shapes may not leave the world: the grid is 10 units out and the camera's far
// plane is 200, so anything past WORLD_LIMIT is unreachable and unrecoverable.
export const WORLD_LIMIT = 100;

// Where a pointer ray meets the y = 0 plane, or null when it never does within
// the world. Rays grazing the horizon from just below the ground plane solve to
// distances of thousands of units, so the bound is enforced here.
export function groundPoint(origin, dir) {
  if (Math.abs(dir[1]) < 1e-8) return null;
  const t = -origin[1] / dir[1];
  if (t < 0 || t > WORLD_LIMIT) return null;
  return [origin[0] + dir[0] * t, 0, origin[2] + dir[2] * t];
}

export function exportFileName() {
  return 'model.stl';
}

// --- additional primitives -------------------------------------------------
// Each is authored so that scaleFor() maps `size` onto its full extent.

export const TORUS_MINOR = 0.35;
export const CAPSULE_RADIUS = 0.5;
export const CAPSULE_HEIGHT = 1.5; // radius 0.5 caps plus a 0.5 straight section
export const TORUS_MAJOR = 0.65; // outer radius lands on exactly 1

// Unit radius, unit height, apex at +y.
export function coneMesh(segments) {
  const b = new MeshBuilder();
  const hy = 0.5;
  const apexPos = [0, hy, 0];
  const apex = b.vertex(apexPos, [0, 1, 0]);
  for (let s = 0; s < segments; s++) {
    const a0 = (s / segments) * Math.PI * 2;
    const a1 = ((s + 1) / segments) * Math.PI * 2;
    const n0 = [Math.cos(a0), 0, Math.sin(a0)];
    const n1 = [Math.cos(a1), 0, Math.sin(a1)];
    const v0 = [n0[0], -hy, n0[2]];
    const v1 = [n1[0], -hy, n1[2]];
    const fn = faceNormal(apexPos, v0, v1);
    const a = b.vertex(v0, fn);
    const c = b.vertex(v1, fn);
    b.tri(apex, c, a);

    const down = [0, -1, 0];
    const base = b.vertex([0, -hy, 0], down);
    const d1 = b.vertex(v0, down);
    const d2 = b.vertex(v1, down);
    b.tri(base, d1, d2);
  }
  return b.build();
}

// Square base of circumradius 1, apex at +y, height 1.
export function pyramidMesh() {
  const b = new MeshBuilder();
  const hy = 0.5;
  const ring = [0, 1, 2, 3].map((i) => {
    const a = (i / 4) * Math.PI * 2;
    return [Math.cos(a), 0, Math.sin(a)];
  });
  const apexPos = [0, hy, 0];
  const apex = b.vertex(apexPos, [0, 1, 0]);
  for (let s = 0; s < 4; s++) {
    const v0 = [ring[s][0], -hy, ring[s][2]];
    const v1 = [ring[(s + 1) % 4][0], -hy, ring[(s + 1) % 4][2]];
    const fn = faceNormal(apexPos, v0, v1);
    const a = b.vertex(v0, fn);
    const c = b.vertex(v1, fn);
    b.tri(apex, c, a);

    const down = [0, -1, 0];
    const base = b.vertex([0, -hy, 0], down);
    const d1 = b.vertex(v0, down);
    const d2 = b.vertex(v1, down);
    b.tri(base, d1, d2);
  }
  return b.build();
}

// Outer radius 1, tube radius TORUS_MINOR, lying in the xz plane.
export function torusMesh(majorSegments, minorSegments) {
  const b = new MeshBuilder();
  const grid = [];
  for (let i = 0; i <= majorSegments; i++) {
    const u = (i / majorSegments) * Math.PI * 2;
    const row = [];
    for (let j = 0; j <= minorSegments; j++) {
      const v = (j / minorSegments) * Math.PI * 2;
      const n = [
        Math.cos(v) * Math.cos(u),
        Math.sin(v),
        Math.cos(v) * Math.sin(u),
      ];
      const p = [
        (TORUS_MAJOR + TORUS_MINOR * Math.cos(v)) * Math.cos(u),
        TORUS_MINOR * Math.sin(v),
        (TORUS_MAJOR + TORUS_MINOR * Math.cos(v)) * Math.sin(u),
      ];
      row.push(b.vertex(p, n));
    }
    grid.push(row);
  }
  for (let i = 0; i < majorSegments; i++) {
    for (let j = 0; j < minorSegments; j++) {
      b.quad(grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]);
    }
  }
  return b.build();
}

// Radius 0.5 with hemispherical caps; built as one lathe whose profile rises
// monotonically in y so the winding is consistent by construction.
export function capsuleMesh(segments, capRings) {
  const b = new MeshBuilder();
  const r = 0.5;
  const body = CAPSULE_HEIGHT / 2 - r; // straight section half height
  // Profile from the bottom pole to the top pole: [radius, y, normalR, normalY].
  const profile = [];
  // Pole first, rim second, so the whole profile rises monotonically in y.
  for (let i = 0; i <= capRings; i++) {
    const t = (i / capRings) * (Math.PI / 2);
    profile.push([r * Math.sin(t), -body - r * Math.cos(t), Math.sin(t), -Math.cos(t)]);
  }
  profile.push([r, body, 1, 0]);
  for (let i = capRings; i >= 1; i--) {
    const t = (i / capRings) * (Math.PI / 2);
    profile.push([r * Math.sin(t), body + r * Math.cos(t), Math.sin(t), Math.cos(t)]);
  }

  const grid = [];
  profile.forEach(([rad, y, nr, ny]) => {
    const row = [];
    for (let s = 0; s <= segments; s++) {
      const phi = (s / segments) * Math.PI * 2;
      row.push(
        b.vertex(
          [Math.cos(phi) * rad, y, Math.sin(phi) * rad],
          normalize([Math.cos(phi) * nr, ny, Math.sin(phi) * nr]),
        ),
      );
    }
    grid.push(row);
  });
  for (let i = 0; i < profile.length - 1; i++) {
    for (let s = 0; s < segments; s++) {
      // Rings rise in y, so this winding is outward.
      b.quad(grid[i][s], grid[i + 1][s], grid[i + 1][s + 1], grid[i][s + 1]);
    }
  }
  return b.build();
}

// Hollow cylinder: outer radius 1, inner radius 0.6, height 1.
export const TUBE_INNER = 0.6;

export function tubeMesh(segments) {
  const b = new MeshBuilder();
  const hy = 0.5;
  for (let s = 0; s < segments; s++) {
    const a0 = (s / segments) * Math.PI * 2;
    const a1 = ((s + 1) / segments) * Math.PI * 2;
    const dir = (a) => [Math.cos(a), 0, Math.sin(a)];

    const o0 = dir(a0);
    const o1 = dir(a1);
    const wall = [
      b.vertex([o0[0], -hy, o0[2]], o0),
      b.vertex([o0[0], hy, o0[2]], o0),
      b.vertex([o1[0], hy, o1[2]], o1),
      b.vertex([o1[0], -hy, o1[2]], o1),
    ];
    b.quad(wall[0], wall[1], wall[2], wall[3]);

    const i0 = dir(a0).map((v) => v * TUBE_INNER);
    const i1 = dir(a1).map((v) => v * TUBE_INNER);
    const in0 = dir(a0).map((v) => -v);
    const in1 = dir(a1).map((v) => -v);
    const bore = [
      b.vertex([i0[0], -hy, i0[2]], in0),
      b.vertex([i0[0], hy, i0[2]], in0),
      b.vertex([i1[0], hy, i1[2]], in1),
      b.vertex([i1[0], -hy, i1[2]], in1),
    ];
    b.quad(bore[0], bore[3], bore[2], bore[1]);

    // Annular caps: a ring quad between the outer and inner radii. Drawing
    // these through the centre would fill the bore and cancel the volume.
    const up = [0, 1, 0];
    const down = [0, -1, 0];
    b.tri(
      b.vertex([o0[0], hy, o0[2]], up),
      b.vertex([i1[0], hy, i1[2]], up),
      b.vertex([o1[0], hy, o1[2]], up),
    );
    b.tri(
      b.vertex([o0[0], hy, o0[2]], up),
      b.vertex([i0[0], hy, i0[2]], up),
      b.vertex([i1[0], hy, i1[2]], up),
    );
    b.tri(
      b.vertex([o0[0], -hy, o0[2]], down),
      b.vertex([o1[0], -hy, o1[2]], down),
      b.vertex([i1[0], -hy, i1[2]], down),
    );
    b.tri(
      b.vertex([o0[0], -hy, o0[2]], down),
      b.vertex([i1[0], -hy, i1[2]], down),
      b.vertex([i0[0], -hy, i0[2]], down),
    );
  }
  return b.build();
}
