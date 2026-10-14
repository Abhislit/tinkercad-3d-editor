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

// Conservative world-space bounds: the rotated local half-extent box.
export function aabbFor(shape) {
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

const meshCache = new Map();
function meshFor(type) {
  if (!meshCache.has(type)) {
    meshCache.set(
      type,
      type === 'sphere'
        ? sphereMesh(SPHERE_SEGMENTS, SPHERE_RINGS)
        : type === 'cylinder'
          ? cylinderMesh(CYLINDER_SEGMENTS)
          : boxMesh(),
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
    const m = compose(shape.position, shape.rotation, shape.size);
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

// Where a pointer ray meets the y = 0 plane, or null when it never does.
export function groundPoint(origin, dir) {
  if (Math.abs(dir[1]) < 1e-8) return null;
  const t = -origin[1] / dir[1];
  if (t < 0) return null;
  return [origin[0] + dir[0] * t, 0, origin[2] + dir[2] * t];
}

export function exportFileName() {
  return 'model.stl';
}
