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