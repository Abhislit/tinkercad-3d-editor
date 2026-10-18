// BSP-based CSG over triangle soup. A "soup" is an array of triangles; each
// triangle is an array of three points; each point is [x, y, z]. No DOM, no
// WebGL — everything here is testable under plain node.
//
// Classic csg.js approach: build a BSP from one solid's polygons, clip the
// other solid against it, and keep the surviving front/back faces for the
// requested boolean. Coplanar faces are the fragile case; the EPSILON in
// splitPolygon absorbs the common sliver cases.

const EPSILON = 1e-5;

// --- triangle soup <-> mesh ---------------------------------------------

// Mesh { positions, indices } -> soup.
export function meshToTriangles(mesh) {
  const soup = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const tri = [];
    for (let k = 0; k < 3; k++) {
      const v = mesh.indices[i + k] * 3;
      tri.push([mesh.positions[v], mesh.positions[v + 1], mesh.positions[v + 2]]);
    }
    soup.push(tri);
  }
  return soup;
}

// Soup -> mesh { positions, normals, indices }. Vertices are emitted per face
// (not shared) and normals are flat, matching the editor's flat-shaded
// primitives. Arrays are plain so JSON/history round-trips stay lossless.
export function trianglesToMesh(soup) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (const tri of soup) {
    const n = faceNormal(tri[0], tri[1], tri[2]);
    const base = positions.length / 3;
    for (const p of tri) {
      positions.push(p[0], p[1], p[2]);
      normals.push(n[0], n[1], n[2]);
    }
    indices.push(base, base + 1, base + 2);
  }
  return { positions, normals, indices };
}

function faceNormal(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [
    u[1] * w[2] - u[2] * w[1],
    u[2] * w[0] - u[0] * w[2],
    u[0] * w[1] - u[1] * w[0],
  ];
  const len = Math.hypot(n[0], n[1], n[2]);
  return len > 1e-12 ? [n[0] / len, n[1] / len, n[2] / len] : [0, 1, 0];
}

// --- Plane ---------------------------------------------------------------

function Plane(normal, w) {
  this.normal = normal;
  this.w = w;
}

// Plane from three points, normalised so that dot(n, p) = w.
Plane.fromPoints = function (a, b, c) {
  const n = faceNormal(a, b, c);
  return new Plane(n, n[0] * a[0] + n[1] * a[1] + n[2] * a[2]);
};

Plane.prototype.clone = function () {
  return new Plane([this.normal[0], this.normal[1], this.normal[2]], this.w);
};

Plane.prototype.flip = function () {
  this.normal = [-this.normal[0], -this.normal[1], -this.normal[2]];
  this.w = -this.w;
};

// Each triangle becomes its own polygon. Stitching triangles into larger faces
// would shrink the tree, but it needs robust shared-edge walking that coplanar
// edges break; per-triangle is always correct, just a bigger tree. A Box is 12
// triangles, so this is cheap for editor-sized scenes.
function soupToPolygons(soup) {
  return soup.map((tri) => new Polygon(tri.map((p) => [p[0], p[1], p[2]])));
}

// --- Polygon -------------------------------------------------------------

function Polygon(vertices) {
  this.vertices = vertices;
  this.plane = Plane.fromPoints(vertices[0], vertices[1], vertices[2]);
}

Polygon.prototype.clone = function () {
  return new Polygon(this.vertices.map((p) => [p[0], p[1], p[2]]));
};

Polygon.prototype.flip = function () {
  this.vertices.reverse();
  this.plane.flip();
};

// --- Node (BSP tree) -----------------------------------------------------

function Node() {
  this.plane = null;
  this.front = null;
  this.back = null;
  this.polygons = [];
}

Node.prototype.build = function (polygons) {
  if (!polygons.length) return;
  if (!this.plane) this.plane = polygons[0].plane.clone();
  const front = [];
  const back = [];
  for (const poly of polygons) {
    // Coplanar pieces belong to THIS node; routing them into front/back would
    // create a child with the same plane and recurse forever.
    this.splitPolygon(poly, front, back, this.polygons, this.polygons);
  }
  if (front.length) {
    if (!this.front) this.front = new Node();
    this.front.build(front);
  }
  if (back.length) {
    if (!this.back) this.back = new Node();
    this.back.build(back);
  }
};

// Split `poly` against this node's plane. Fragments strictly on either side go
// to `frontOut`/`backOut`; pieces lying on the plane go to
// `coplanarOutFront`/`coplanarOutBack` (chosen by whether the two normals
// agree). Keeping the two pairs as separate, clearly-named arguments matters:
// build() stores coplanar pieces on the node, clipPolygons() keeps them in the
// result, and swapping them makes the tree recurse forever.
Node.prototype.splitPolygon = function (
  poly,
  frontOut,
  backOut,
  coplanarOutFront,
  coplanarOutBack,
) {
  const COPLANAR = 0;
  const FRONT = 1;
  const BACK = 2;
  const SPANNING = 3;

  const types = poly.vertices.map((v) => {
    const t = this.plane.normal[0] * v[0] + this.plane.normal[1] * v[1] + this.plane.normal[2] * v[2] - this.plane.w;
    if (t < -EPSILON) return BACK;
    if (t > EPSILON) return FRONT;
    return COPLANAR;
  });

  if (!types.includes(FRONT) && !types.includes(BACK)) {
    // Fully coplanar with this plane: front/back by normal orientation.
    if (dot(this.plane.normal, poly.plane.normal) > 0) coplanarOutFront.push(poly);
    else coplanarOutBack.push(poly);
    return;
  }

  if (!types.includes(BACK)) {
    frontOut.push(poly);
    return;
  }
  if (!types.includes(FRONT)) {
    backOut.push(poly);
    return;
  }

  // Spanning: cut the polygon with the plane, producing front and back parts.
  const fv = [];
  const bv = [];
  const n = poly.vertices.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ti = types[i];
    const tj = types[j];
    const vi = poly.vertices[i];
    const vj = poly.vertices[j];
    if (ti !== BACK) fv.push(vi);
    if (ti !== FRONT) bv.push(vi);
    // Cut only on a true FRONT|BACK crossing. A coplanar-to-front edge is
    // already on the plane and must not gain a duplicate cut vertex.
    if ((ti | tj) === SPANNING) {
      const di = this.plane.normal[0] * vi[0] + this.plane.normal[1] * vi[1] + this.plane.normal[2] * vi[2] - this.plane.w;
      const dj = this.plane.normal[0] * vj[0] + this.plane.normal[1] * vj[1] + this.plane.normal[2] * vj[2] - this.plane.w;
      const t = di / (di - dj);
      const v = [vi[0] + (vj[0] - vi[0]) * t, vi[1] + (vj[1] - vi[1]) * t, vi[2] + (vj[2] - vi[2]) * t];
      fv.push(v);
      bv.push(v);
    }
  }
  if (fv.length >= 3) frontOut.push(new Polygon(fv));
  if (bv.length >= 3) backOut.push(new Polygon(bv));
};

Node.prototype.invert = function () {
  for (const poly of this.polygons) poly.flip();
  if (this.plane) this.plane.flip();
  if (this.front) this.front.invert();
  if (this.back) this.back.invert();
  const tmp = this.front;
  this.front = this.back;
  this.back = tmp;
};

Node.prototype.clipPolygons = function (polygons) {
  if (!this.plane) return polygons.slice();
  let front = [];
  let back = [];
  for (const poly of polygons) this.splitPolygon(poly, front, back, front, back);
  if (this.front) front = this.front.clipPolygons(front);
  back = this.back ? this.back.clipPolygons(back) : [];
  return front.concat(back);
};

Node.prototype.clipTo = function (bsp) {
  this.polygons = bsp.clipPolygons(this.polygons);
  if (this.front) this.front.clipTo(bsp);
  if (this.back) this.back.clipTo(bsp);
};

Node.prototype.allPolygons = function () {
  let polys = this.polygons.slice();
  if (this.front) polys = polys.concat(this.front.allPolygons());
  if (this.back) polys = polys.concat(this.back.allPolygons());
  return polys;
};

// --- booleans ------------------------------------------------------------

function polygonsToSoup(polygons) {
  const soup = [];
  for (const poly of polygons) {
    const vs = poly.vertices;
    for (let i = 2; i < vs.length; i++) {
      soup.push([vs[0], vs[i - 1], vs[i]]);
    }
  }
  return soup;
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// Union of two soups. Classic: invert a's polygons out of b, invert b's
// polygons out of a, clip each to the other, then concatenate.
// Booleans. These follow csg.js's composition exactly: everything reduces to
// clipTo (drop parts inside the other tree) and invert (flip solid/empty),
// then b's surviving polygons are rebuilt into a's tree so the result is one
// consistent solid.
export function union(a, b) {
  const aNode = new Node();
  aNode.build(soupToPolygons(a));
  const bNode = new Node();
  bNode.build(soupToPolygons(b));

  aNode.clipTo(bNode);
  bNode.clipTo(aNode);
  bNode.invert();
  bNode.clipTo(aNode);
  bNode.invert();
  aNode.build(bNode.allPolygons());

  return polygonsToSoup(aNode.allPolygons());
}

// Difference a - b.
export function subtract(a, b) {
  const aNode = new Node();
  aNode.build(soupToPolygons(a));
  const bNode = new Node();
  bNode.build(soupToPolygons(b));

  aNode.invert();
  aNode.clipTo(bNode);
  bNode.clipTo(aNode);
  bNode.invert();
  bNode.clipTo(aNode);
  bNode.invert();
  aNode.build(bNode.allPolygons());
  aNode.invert();

  return polygonsToSoup(aNode.allPolygons());
}

// Intersection of two soups: keep only volume inside both.
export function intersect(a, b) {
  const aNode = new Node();
  aNode.build(soupToPolygons(a));
  const bNode = new Node();
  bNode.build(soupToPolygons(b));

  aNode.invert();
  bNode.clipTo(aNode);
  bNode.invert();
  aNode.clipTo(bNode);
  bNode.clipTo(aNode);
  aNode.build(bNode.allPolygons());
  aNode.invert();

  return polygonsToSoup(aNode.allPolygons());
}