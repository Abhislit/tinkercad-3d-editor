// A shape's mesh lives on the shape itself (`shape.mesh`) rather than in a
// process-global keyed cache, so it survives JSON save/load and the history
// deep-clone. GPU buffers are cached per mesh object identity, so a cloned or
// reloaded mesh gets its own buffers built lazily.

const gpuCache = new WeakMap();

export function resolveMesh(shape, create) {
  const mesh = shape && shape.mesh;
  if (!mesh) return undefined;
  let gpu = gpuCache.get(mesh);
  if (gpu === undefined && typeof create === 'function') {
    gpu = create(mesh);
    gpuCache.set(mesh, gpu);
  }
  return gpu;
}

// Typed arrays stringify to plain objects ({ "0": .. }), losing order and
// length. Flattening to ordinary arrays keeps a JSON round-trip lossless.
export function toPlainMesh(mesh) {
  if (!mesh) return mesh;
  return {
    positions: Array.from(mesh.positions),
    normals: Array.from(mesh.normals),
    indices: Array.from(mesh.indices),
  };
}

export function serializeShape(shape) {
  return shape.mesh ? { ...shape, mesh: toPlainMesh(shape.mesh) } : shape;
}

export function reviveShape(shape) {
  return shape.mesh ? { ...shape, mesh: toPlainMesh(shape.mesh) } : shape;
}

// A 16-bit index buffer tops out at 65535 vertices; CSG output can exceed that,
// so pick the index type the vertex count actually needs (both are WebGL2-legal).
export function indexArrayType(vertexCount) {
  return vertexCount <= 65535 ? Uint16Array : Uint32Array;
}
