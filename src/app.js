// WebGL2 viewport, camera and scene state for the shape editor.
import { createHistory } from './history.js';
import {
  identity,
  multiply,
  perspective,
  lookAt,
  compose,
  invert,
  transformPoint,
  pickShape,
  groundPoint,
  aabbFor,
  alignAxis,
  distributeAxis,
  AXIS_INDEX,
  scaleFor,
  parseCoord,
  parseStl,
  frameDistance,
  WORLD_LIMIT,
  stlBytes,
  exportFileName,
  boxMesh,
  sphereMesh,
  cylinderMesh,
  coneMesh,
  pyramidMesh,
  torusMesh,
  capsuleMesh,
  tubeMesh,
} from './geometry.js';
import { resolveMesh, serializeShape, reviveShape, toPlainMesh, indexArrayType } from './meshstore.js';
import { toggleSelection, primaryIndex, hasIndex } from './selection.js';

const canvas = document.getElementById('view');
const hint = document.getElementById('hint');
const glError = document.getElementById('gl-error');

const gl = canvas.getContext('webgl2', { antialias: true });
if (!gl) {
  glError.style.display = 'grid';
  throw new Error('WebGL2 unavailable');
}
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  glError.style.display = 'grid';
});

const PALETTE = [
  [0.91, 0.31, 0.23],
  [0.94, 0.63, 0.16],
  [0.91, 0.83, 0.29],
  [0.39, 0.79, 0.36],
  [0.23, 0.66, 0.91],
  [0.48, 0.36, 0.91],
  [0.91, 0.36, 0.66],
  [0.85, 0.87, 0.9],
];

const state = {
  scene: [],
  selection: [],
  get selected() {
    return primaryIndex(this.selection);
  },
  camera: { theta: Math.PI / 4, phi: 1.05, distance: 12, target: [0, 0, 0] },
  drag: null,
  snap: false,
};

const history = createHistory(state.scene);

function snapshot() {
  history.push(state.scene);
}

function applyScene(scene) {
  state.scene.length = 0;
  state.scene.push(...scene);
  state.selection = scene.length ? [state.scene.length - 1] : [];
  syncUi();
}

const VERT = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
uniform mat4 uModel;
uniform mat4 uViewProj;
uniform mat3 uNormalMat;
out vec3 vNormal;
out vec3 vPos;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vPos = world.xyz;
  vNormal = uNormalMat * aNormal;
  gl_Position = uViewProj * world;
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec3 vNormal;
in vec3 vPos;
uniform vec3 uColor;
out vec4 fragColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 lightDir = normalize(vec3(0.4, 0.9, 0.6));
  float lambert = max(dot(n, lightDir), 0.0);
  vec3 viewDir = normalize(-vPos);
  float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
  vec3 shaded = uColor * (0.25 + 0.75 * lambert) + vec3(rim) * 0.35;
  fragColor = vec4(shaded, 1.0);
}`;

function compile(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

const program = gl.createProgram();
gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
gl.linkProgram(program);
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
  throw new Error(gl.getProgramInfoLog(program));
}
gl.useProgram(program);

const uniforms = {
  model: gl.getUniformLocation(program, 'uModel'),
  viewProj: gl.getUniformLocation(program, 'uViewProj'),
  normalMat: gl.getUniformLocation(program, 'uNormalMat'),
  color: gl.getUniformLocation(program, 'uColor'),
};

function createMesh(mesh) {
  // Shapes carry plain arrays so history/save JSON round-trips are lossless;
  // coerce to the typed arrays WebGL uploads here, at the GPU boundary.
  const posData = Float32Array.from(mesh.positions);
  const normalData = Float32Array.from(mesh.normals);
  const IndexType = indexArrayType(posData.length / 3);
  const indexData = IndexType.from(mesh.indices);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const positions = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positions);
  gl.bufferData(gl.ARRAY_BUFFER, posData, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  const normals = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, normals);
  gl.bufferData(gl.ARRAY_BUFFER, normalData, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

  const indices = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexData, gl.STATIC_DRAW);

  // Same triangles read as edges, for the selection outline.
  const edges = new IndexType((indexData.length / 3) * 6);
  for (let t = 0; t < indexData.length / 3; t++) {
    const [a, b, c] = [indexData[t * 3], indexData[t * 3 + 1], indexData[t * 3 + 2]];
    edges.set([a, b, b, c, c, a], t * 6);
  }
  const lineIndices = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lineIndices);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, edges, gl.STATIC_DRAW);

  gl.bindVertexArray(null);
  const indexType = IndexType === Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
  return { vao, count: indexData.length, edges, lineIndices, indices, indexType };
}

// Coloured world axes through the origin: +X red, +Y green, +Z blue. Each axis
// is two line segments in one buffer (origin -> tip, origin -> dim stub) drawn
// with the existing uniform colour, so no new attribute or shader is needed.
const AXES = [
  { tip: [3, 0, 0], stub: [-0.8, 0, 0], color: [0.92, 0.35, 0.32] },
  { tip: [0, 3, 0], stub: [0, -0.8, 0], color: [0.45, 0.87, 0.4] },
  { tip: [0, 0, 3], stub: [0, 0, -0.8], color: [0.35, 0.62, 0.95] },
];

function createAxesMesh() {
  const positions = [];
  const normals = [];
  for (const { tip, stub } of AXES) {
    positions.push(0, 0, 0, ...tip, 0, 0, 0, ...stub);
    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const put = (data, location) => {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
  };
  put(positions, 0);
  put(normals, 1);
  gl.bindVertexArray(null);
  return { vao, vertices: positions.length / 3 };
}

function createGridMesh() {
  const half = 10;
  const step = 1;
  const positions = [];
  for (let i = -half; i <= half; i += step) {
    positions.push(-half, 0, i, half, 0, i);
    positions.push(i, 0, -half, i, 0, half);
  }
  // Lines need a normal attribute too: the shader normalises vNormal, and a
  // zero vector would normalise to NaN.
  const up = [];
  for (let i = 0; i < positions.length / 3; i++) up.push(0, 1, 0);
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(up),
    indices: new Uint16Array(Array.from({ length: positions.length / 3 }, (_, i) => i)),
  };
}

// Primitives are a fixed set shared by every instance, so their GPU buffers
// are built once and keyed by type. Imported and grouped shapes carry their
// own mesh on the shape (shape.mesh) and get buffers lazily via resolveMesh.
const primitiveGpu = new Map();
let gridMesh = null;
let axesMesh = null;

function meshFor(shape) {
  if (shape.mesh) return resolveMesh(shape, createMesh);
  return primitiveGpu.get(shape.type);
}

const PRIMITIVES = {
  box: boxMesh(),
  sphere: sphereMesh(32, 16),
  cylinder: cylinderMesh(32),
  cone: coneMesh(32),
  pyramid: pyramidMesh(),
  torus: torusMesh(32, 16),
  capsule: capsuleMesh(32, 8),
  tube: tubeMesh(32),
};
for (const [type, source] of Object.entries(PRIMITIVES)) {
  primitiveGpu.set(type, createMesh(source));
}

const SNAP = 0.5;
gridMesh = createMesh(createGridMesh());
axesMesh = createAxesMesh();

function cameraEye() {
  const { theta, phi, distance, target } = state.camera;
  return [
    target[0] + distance * Math.sin(phi) * Math.cos(theta),
    target[1] + distance * Math.cos(phi),
    target[2] + distance * Math.sin(phi) * Math.sin(theta),
  ];
}

function viewProjection() {
  const eye = cameraEye();
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
  const view = lookAt(eye, state.camera.target, [0, 1, 0]);
  const proj = perspective(Math.PI / 4, aspect, 0.1, 200);
  return multiply(proj, view);
}

function normalMatrixOf(model) {
  // Uniform scale only, so the rotation part is enough.
  return new Float32Array([
    model[0], model[1], model[2],
    model[4], model[5], model[6],
    model[8], model[9], model[10],
  ]);
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function draw() {
  resize();
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.078, 0.086, 0.102, 1);
  gl.enable(gl.DEPTH_TEST);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const viewProj = viewProjection();

  if (gridMesh) {
    gl.useProgram(program);
    gl.uniformMatrix4fv(uniforms.viewProj, false, viewProj);
    gl.uniformMatrix4fv(uniforms.model, false, identity());
    gl.uniformMatrix3fv(uniforms.normalMat, false, normalMatrixOf(identity()));
    gl.uniform3f(uniforms.color, 0.27, 0.29, 0.34);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(gridMesh.vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gridMesh.indices);
    gl.drawElements(gl.LINES, gridMesh.count, gl.UNSIGNED_SHORT, 0);
  }

  if (axesMesh) {
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(axesMesh.vao);
    for (let i = 0; i < AXES.length; i++) {
      const { color } = AXES[i];
      gl.uniform3fv(uniforms.color, color);
      gl.drawArrays(gl.LINES, i * 6, 2);
      gl.uniform3f(uniforms.color, color[0] * 0.4, color[1] * 0.4, color[2] * 0.4);
      gl.drawArrays(gl.LINES, i * 6 + 2, 2);
    }
  }

  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  for (let i = 0; i < state.scene.length; i++) {
    const shape = state.scene[i];
    const mesh = meshFor(shape);
    if (!mesh) continue;
    const model = compose(shape.position, shape.rotation, scaleFor(shape));
    gl.uniformMatrix4fv(uniforms.model, false, model);
    gl.uniformMatrix3fv(uniforms.normalMat, false, normalMatrixOf(model));
    gl.uniform3fv(uniforms.color, shape.color);
    gl.bindVertexArray(mesh.vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indices);
    gl.drawElements(gl.TRIANGLES, mesh.count, mesh.indexType, 0);

    // Selection outline: same mesh as wireframe on top of the shaded solid.
    if (hasIndex(state.selection, i)) {
      gl.disable(gl.CULL_FACE);
      gl.uniform3f(uniforms.color, 1, 1, 1);
      const grown = compose(
        shape.position,
        shape.rotation,
        scaleFor(shape).map((v) => v + 0.04),
      );
      gl.uniformMatrix4fv(uniforms.model, false, grown);
      gl.uniformMatrix3fv(uniforms.normalMat, false, normalMatrixOf(grown));
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.lineIndices);
      gl.drawElements(gl.LINES, mesh.edges.length, mesh.indexType, 0);
      gl.enable(gl.CULL_FACE);
    }
  }
  gl.bindVertexArray(null);
  requestAnimationFrame(draw);
}

requestAnimationFrame(draw);

// --- camera input ---------------------------------------------------------

function pointerNdc(event) {
  const rect = canvas.getBoundingClientRect();
  return [
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    1 - ((event.clientY - rect.top) / rect.height) * 2,
  ];
}

function worldRay(event) {
  const [nx, ny] = pointerNdc(event);
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
  const eye = cameraEye();
  const view = lookAt(eye, state.camera.target, [0, 1, 0]);
  const proj = perspective(Math.PI / 4, aspect, 0.1, 200);
  const inv = invert(multiply(proj, view));
  const near = transformPoint(inv, [nx, ny, -1]);
  const far = transformPoint(inv, [nx, ny, 1]);
  const dir = [far[0] - near[0], far[1] - near[1], far[2] - near[2]];
  const len = Math.hypot(...dir) || 1;
  return { origin: near, dir: dir.map((v) => v / len) };
}

function pickTolerance(shape) {
  const eye = cameraEye();
  const d = Math.hypot(
    shape.position[0] - eye[0],
    shape.position[1] - eye[1],
    shape.position[2] - eye[2],
  );
  return 0.05 * d;
}

canvas.addEventListener('pointerdown', (event) => {
  canvas.setPointerCapture(event.pointerId);
  const ray = worldRay(event);
  const panning = event.shiftKey || event.button === 1;
  if (panning) {
    state.drag = { mode: 'pan', x: event.clientX, y: event.clientY };
    return;
  }
  const hit = pickShape(ray.origin, ray.dir, state.scene, pickTolerance);
  if (event.ctrlKey || event.metaKey) {
    // Modify-click toggles set membership and never starts a drag.
    if (hit !== -1) {
      state.selection = toggleSelection(state.selection, hit);
      syncUi();
    }
    return;
  }
  state.selection = hit === -1 ? [] : [hit];
  syncUi();
  if (hit !== -1) {
    snapshot();
    const ground = groundPoint(ray.origin, ray.dir);
    const shape = state.scene[hit];
    state.drag = {
      mode: 'move',
      offset: ground ? [shape.position[0] - ground[0], 0, shape.position[2] - ground[2]] : [0, 0, 0],
    };
  } else {
    state.drag = { mode: 'orbit', x: event.clientX, y: event.clientY };
  }
});

canvas.addEventListener('pointermove', (event) => {
  const drag = state.drag;
  if (!drag) return;
  if (drag.mode === 'orbit') {
    state.camera.theta -= (event.clientX - drag.x) * 0.01;
    // Stop just short of horizontal: below it the eye drops under the ground
    // plane and ground-point solving blows up.
    state.camera.phi = Math.min(
      Math.PI / 2 - 0.05,
      Math.max(0.05, state.camera.phi - (event.clientY - drag.y) * 0.01),
    );
    drag.x = event.clientX;
    drag.y = event.clientY;
  } else if (drag.mode === 'pan') {
    const scale = state.camera.distance * 0.002;
    const right = [Math.sin(state.camera.theta + Math.PI / 2), 0, Math.cos(state.camera.theta + Math.PI / 2)];
    const dx = (event.clientX - drag.x) * scale;
    const dy = (event.clientY - drag.y) * scale;
    for (let a = 0; a < 3; a++) state.camera.target[a] += right[a] * dx;
    state.camera.target[1] = Math.max(0, state.camera.target[1] + dy);
    drag.x = event.clientX;
    drag.y = event.clientY;
  } else if (drag.mode === 'move' && state.selected !== -1) {
    const ray = worldRay(event);
    const ground = groundPoint(ray.origin, ray.dir);
    if (ground) {
      const shape = state.scene[state.selected];
      let x = ground[0] + drag.offset[0];
      let z = ground[2] + drag.offset[2];
      if (state.snap) {
        x = Math.round(x / SNAP) * SNAP;
        z = Math.round(z / SNAP) * SNAP;
      }
      shape.position[0] = x;
      shape.position[2] = z;
      syncUi();
    }
  }
});

const endDrag = () => {
  state.drag = null;
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    state.camera.distance = Math.min(
      200,
      Math.max(2, state.camera.distance * (event.deltaY > 0 ? 1.1 : 1 / 1.1)),
    );
  },
  { passive: false },
);

// --- scene operations -----------------------------------------------------

export function addShape(type) {
  snapshot();
  const [tx, , tz] = state.camera.target;
  const shape = {
    type,
    position: [tx, 0.5, tz],
    rotation: [0, 0, 0],
    size: [1, 1, 1],
    color: PALETTE[state.scene.length % PALETTE.length],
  };
  state.scene.push(shape);
  state.selection = [state.scene.length - 1];
  syncUi();
  return shape;
}

export function deleteSelected() {
  if (state.selection.length === 0) return;
  snapshot();
  const doomed = state.selection.slice().sort((a, b) => b - a);
  for (const index of doomed) state.scene.splice(index, 1);
  state.selection = [];
  syncUi();
}

export function rotateSelected(delta, axis = 'y') {
  if (state.selected === -1) return;
  snapshot();
  const index = axis === 'x' ? 0 : axis === 'z' ? 2 : 1;
  state.scene[state.selected].rotation[index] += delta;
  syncUi();
}

export function scaleSelected(factor) {
  if (state.selected === -1) return;
  snapshot();
  const shape = state.scene[state.selected];
  shape.size = shape.size.map((v) => Math.max(0.1, v * factor));
  syncUi();
}

export function colorSelected(index) {
  if (state.selected === -1 || !PALETTE[index]) return;
  snapshot();
  state.scene[state.selected].color = PALETTE[index].slice();
  syncUi();
}

export function duplicateSelected() {
  if (state.selection.length === 0) return;
  snapshot();
  const copies = state.selection.map((index) => {
    const source = state.scene[index];
    const half = source.size.map((v) => v / 2);
    return {
      ...source,
      position: [
        source.position[0] + half[0],
        source.position[1],
        source.position[2] + half[2],
      ],
      rotation: source.rotation.slice(),
      size: source.size.slice(),
      color: source.color.slice(),
    };
  });
  const base = state.scene.length;
  state.scene.push(...copies);
  state.selection = copies.map((_, offset) => base + offset);
  syncUi();
}

export function alignSelected(mode, axis) {
  if (state.selection.length < 2) return;
  snapshot();
  const bounds = state.selection.map((i) => aabbFor(state.scene[i]));
  const deltas = alignAxis(bounds, axis, mode);
  const a = AXIS_INDEX[axis];
  state.selection.forEach((index, k) => {
    state.scene[index].position[a] += deltas[k];
  });
  syncUi();
}

export function distributeSelected(axis) {
  if (state.selection.length < 3) return;
  snapshot();
  const bounds = state.selection.map((i) => aabbFor(state.scene[i]));
  const centres = bounds.map((b) => (b.min[AXIS_INDEX[axis]] + b.max[AXIS_INDEX[axis]]) / 2);
  const spaced = distributeAxis(centres);
  const a = AXIS_INDEX[axis];
  state.selection.forEach((index, k) => {
    state.scene[index].position[a] += spaced[k] - centres[k];
  });
  syncUi();
}

export function undo() {
  applyScene(history.undo(state.scene));
}

export function redo() {
  applyScene(history.redo(state.scene));
}

export function setSnap(on) {
  state.snap = on;
  document.getElementById('snap').textContent = `Snap: ${on ? 'on' : 'off'}`;
}

const SAVE_KEY = 'tinkercad-3d-scene';

export function saveScene() {
  localStorage.setItem(SAVE_KEY, JSON.stringify(state.scene.map(serializeShape)));
}

export function loadScene() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return false;
  const scene = JSON.parse(raw).map(reviveShape);
  applyScene(scene);
  history.reset(state.scene);
  return true;
}

const coordInputs = [0, 1, 2].map((i) => document.getElementById(['pos-x', 'pos-y', 'pos-z'][i]));
const rotInputs = [0, 1, 2].map((i) => document.getElementById(['rot-x', 'rot-y', 'rot-z'][i]));
const sizeInputs = [0, 1, 2].map((i) => document.getElementById(['size-x', 'size-y', 'size-z'][i]));
let editingCoord = false;

for (const [axis, input] of coordInputs.entries()) {
  input.addEventListener('change', () => {
    if (state.selected === -1) return;
    const shape = state.scene[state.selected];
    const value = parseCoord(input.value, shape.position[axis]);
    if (value === shape.position[axis]) return;
    snapshot();
    shape.position[axis] = value;
    syncUi();
  });
  input.addEventListener('focus', () => {
    editingCoord = true;
  });
  input.addEventListener('blur', () => {
    editingCoord = false;
  });
}

for (const [axis, input] of rotInputs.entries()) {
  input.addEventListener('change', () => {
    if (state.selected === -1) return;
    const shape = state.scene[state.selected];
    const degrees = parseCoord(input.value, (shape.rotation[axis] * 180) / Math.PI);
    snapshot();
    shape.rotation[axis] = (degrees * Math.PI) / 180;
    syncUi();
  });
}

for (const [axis, input] of sizeInputs.entries()) {
  input.addEventListener('change', () => {
    if (state.selected === -1) return;
    const shape = state.scene[state.selected];
    const value = Math.max(0.1, parseCoord(input.value, shape.size[axis]));
    if (value === shape.size[axis]) return;
    snapshot();
    shape.size[axis] = value;
    syncUi();
  });
}

// Jump the camera so the selected shape fills the view.
export function frameSelected() {
  if (state.selected === -1) return;
  const { min, max } = aabbFor(state.scene[state.selected]);
  const centre = [0, 1, 2].map((a) => (min[a] + max[a]) / 2);
  const radius = Math.hypot(...[0, 1, 2].map((a) => (max[a] - min[a]) / 2));
  state.camera.target = centre;
  state.camera.distance = frameDistance(radius, Math.PI / 4);
}

export async function importStl(file) {
  const buffer = await file.arrayBuffer();
  const mesh = parseStl(buffer);
  if (!mesh) return false;
  snapshot();
  state.scene.push({
    type: 'mesh',
    mesh: toPlainMesh(mesh),
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    size: [1, 1, 1],
    color: [0.85, 0.87, 0.9],
    importedSize: [mesh.max[0] - mesh.min[0], mesh.max[1] - mesh.min[1], mesh.max[2] - mesh.min[2]],
  });
  state.selection = [state.scene.length - 1];
  frameSelected();
  syncUi();
  return true;
}

function syncUi() {
  const shape = state.selected === -1 ? null : state.scene[state.selected];
  document.getElementById('delete').disabled = shape === null;
  document.getElementById('duplicate').disabled = shape === null;
  for (const button of alignButtons) button.disabled = state.selection.length < 2;
  for (const button of distributeButtons) button.disabled = state.selection.length < 3;
  document.getElementById('export').disabled = state.scene.length === 0;
  document.getElementById('undo').disabled = !history.canUndo();
  for (const [axis, input] of coordInputs.entries()) {
    input.disabled = shape === null;
    // Do not fight the user while they are typing into a field.
    if (!editingCoord) input.value = shape === null ? '' : shape.position[axis].toFixed(2);
  }
  for (const [axis, input] of rotInputs.entries()) {
    input.disabled = shape === null;
    if (!editingCoord) {
      input.value = shape === null ? '' : Math.round((shape.rotation[axis] * 180) / Math.PI);
    }
  }
  for (const [axis, input] of sizeInputs.entries()) {
    input.disabled = shape === null;
    if (!editingCoord) input.value = shape === null ? '' : shape.size[axis].toFixed(2);
  }
  document.getElementById('redo').disabled = !history.canRedo();
  if (state.selection.length > 1) {
    hint.innerHTML =
      `<b>${state.selection.length} selected</b> &middot; ` +
      'F frame, R/X/Z rotate, [ ] scale, 1-8 colour, Ctrl+D duplicate, Del delete';
  } else if (shape) {
    const dims = shape.size.map((v) => v.toFixed(2)).join(' x ');
    const rot = shape.rotation.map((r) => Math.round((r * 180) / Math.PI));
    hint.innerHTML =
      `<b>${shape.type}</b> ${dims} &middot; rotation ${rot.join('/')}&deg; ` +
      (shape.type === 'mesh'
        ? ` &middot; imported ${shape.importedSize.map((v) => v.toFixed(1)).join(' x ')}`
        : '') +
      '&middot; F frame, R/X/Z rotate, [ ] scale, 1-8 colour, Ctrl+D duplicate';
  } else {
    hint.textContent =
      'Drag to orbit · shift-drag to pan · wheel to zoom · click a shape to select';
  }
}

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    redo();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
    event.preventDefault();
    duplicateSelected();
    return;
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    deleteSelected();
  } else if (event.key === 'f' || event.key === 'F') {
    frameSelected();
  } else if (event.key === 'r' || event.key === 'R') {
    rotateSelected(event.shiftKey ? -Math.PI / 12 : Math.PI / 12);
  } else if (event.key === 'x' || event.key === 'X') {
    rotateSelected(event.shiftKey ? -Math.PI / 12 : Math.PI / 12, 'x');
  } else if (event.key === 'z' || event.key === 'Z') {
    rotateSelected(event.shiftKey ? -Math.PI / 12 : Math.PI / 12, 'z');
  } else if (event.key === ']') {
    scaleSelected(1.1);
  } else if (event.key === '[') {
    scaleSelected(1 / 1.1);
  } else if (event.key >= '1' && event.key <= '8') {
    colorSelected(Number(event.key) - 1);
  }
});

for (const type of ['box', 'sphere', 'cylinder', 'cone', 'pyramid', 'torus', 'capsule', 'tube']) {
  document.getElementById(`add-${type}`).addEventListener('click', () => addShape(type));
}

document.getElementById('delete').addEventListener('click', deleteSelected);
document.getElementById('duplicate').addEventListener('click', duplicateSelected);
document.getElementById('undo').addEventListener('click', undo);
document.getElementById('redo').addEventListener('click', redo);
document.getElementById('save').addEventListener('click', saveScene);
document.getElementById('load').addEventListener('click', loadScene);
document.getElementById('snap').addEventListener('click', () => setSnap(!state.snap));

const alignButtons = document.querySelectorAll('[data-align]');
for (const button of alignButtons) {
  const [mode, axis] = button.dataset.align.split(':');
  button.addEventListener('click', () => alignSelected(mode, axis));
}
const distributeButtons = document.querySelectorAll('[data-distribute]');
for (const button of distributeButtons) {
  button.addEventListener('click', () => distributeSelected(button.dataset.distribute));
}

const fileInput = document.getElementById('file');
document.getElementById('import').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files && fileInput.files[0];
  if (file) await importStl(file);
  fileInput.value = '';
});

document.getElementById('export').addEventListener('click', () => {
  if (state.scene.length === 0) return;
  const blob = new Blob([stlBytes(state.scene)], { type: 'model/stl' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = exportFileName();
  link.click();
  URL.revokeObjectURL(url);
});
for (const swatch of document.querySelectorAll('.swatch')) {
  swatch.addEventListener('click', () => colorSelected(Number(swatch.dataset.color)));
}

// Test seam for the headless verification run.
window.__editor = {
  state,
  scene: state.scene,
  get selected() {
    return state.selected;
  },
  get selection() {
    return state.selection.slice();
  },
  addShape,
  deleteSelected,
  rotateSelected,
  scaleSelected,
  colorSelected,
  snapshot,
  undo,
  redo,
  duplicateSelected,
  alignSelected,
  distributeSelected,
  setSnap,
  saveScene,
  loadScene,
  history,
  frameSelected,
  importStl,
  parseStl,
  stlBytes,
  exportFileName,
  PALETTE,
  syncUi,
};