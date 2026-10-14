// WebGL2 viewport, camera and scene state for the shape editor.
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
  stlBytes,
  exportFileName,
  boxMesh,
  sphereMesh,
  cylinderMesh,
} from './geometry.js';

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
  selected: -1,
  camera: { theta: Math.PI / 4, phi: 1.05, distance: 12, target: [0, 0, 0] },
  drag: null,
};

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
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const positions = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positions);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  const normals = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, normals);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

  const indices = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

  // Same triangles read as edges, for the selection outline.
  const edges = new Uint16Array((mesh.indices.length / 3) * 6);
  for (let t = 0; t < mesh.indices.length / 3; t++) {
    const [a, b, c] = [mesh.indices[t * 3], mesh.indices[t * 3 + 1], mesh.indices[t * 3 + 2]];
    edges.set([a, b, b, c, c, a], t * 6);
  }
  const lineIndices = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lineIndices);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, edges, gl.STATIC_DRAW);

  gl.bindVertexArray(null);
  return { vao, count: mesh.indices.length, edges, lineIndices, indices };
}

function createGridMesh() {
  const half = 10;
  const step = 1;
  const positions = [];
  for (let i = -half; i <= half; i += step) {
    positions.push(-half, 0, i, half, 0, i);
    positions.push(i, 0, -half, i, 0, half);
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(positions.length),
    indices: new Uint16Array(Array.from({ length: positions.length / 3 }, (_, i) => i)),
  };
}

const meshCache = new Map();
let gridMesh = null;

function registerMesh(type, mesh) {
  meshCache.set(type, createMesh(mesh));
}

registerMesh('box', boxMesh());
registerMesh('sphere', sphereMesh(32, 16));
registerMesh('cylinder', cylinderMesh(32));
gridMesh = createMesh(createGridMesh());

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

  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  for (let i = 0; i < state.scene.length; i++) {
    const shape = state.scene[i];
    const mesh = meshCache.get(shape.type);
    if (!mesh) continue;
    const model = compose(shape.position, shape.rotation, shape.size);
    gl.uniformMatrix4fv(uniforms.model, false, model);
    gl.uniformMatrix3fv(uniforms.normalMat, false, normalMatrixOf(model));
    gl.uniform3fv(uniforms.color, shape.color);
    gl.bindVertexArray(mesh.vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indices);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);

    // Selection outline: same mesh as wireframe on top of the shaded solid.
    if (i === state.selected) {
      gl.disable(gl.CULL_FACE);
      gl.uniform3f(uniforms.color, 1, 1, 1);
      const grown = compose(
        shape.position,
        shape.rotation,
        shape.size.map((v) => v + 0.04),
      );
      gl.uniformMatrix4fv(uniforms.model, false, grown);
      gl.uniformMatrix3fv(uniforms.normalMat, false, normalMatrixOf(grown));
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.lineIndices);
      gl.drawElements(gl.LINES, mesh.edges.length, gl.UNSIGNED_SHORT, 0);
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
  state.selected = hit;
  syncUi();
  if (hit !== -1) {
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
    state.camera.phi = Math.min(
      Math.PI - 0.05,
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
      shape.position[0] = ground[0] + drag.offset[0];
      shape.position[2] = ground[2] + drag.offset[2];
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
  const [tx, , tz] = state.camera.target;
  const shape = {
    type,
    position: [tx, 0.5, tz],
    rotation: [0, 0, 0],
    size: [1, 1, 1],
    color: PALETTE[state.scene.length % PALETTE.length],
  };
  state.scene.push(shape);
  state.selected = state.scene.length - 1;
  syncUi();
  return shape;
}

export function deleteSelected() {
  if (state.selected === -1) return;
  state.scene.splice(state.selected, 1);
  state.selected = -1;
  syncUi();
}

export function rotateSelected(delta) {
  if (state.selected === -1) return;
  state.scene[state.selected].rotation[1] += delta;
  syncUi();
}

export function scaleSelected(factor) {
  if (state.selected === -1) return;
  const shape = state.scene[state.selected];
  shape.size = shape.size.map((v) => Math.max(0.1, v * factor));
  syncUi();
}

export function colorSelected(index) {
  if (state.selected === -1 || !PALETTE[index]) return;
  state.scene[state.selected].color = PALETTE[index];
}

function syncUi() {
  const shape = state.selected === -1 ? null : state.scene[state.selected];
  document.getElementById('delete').disabled = shape === null;
  document.getElementById('export').disabled = state.scene.length === 0;
  if (shape) {
    const dims = shape.size.map((v) => v.toFixed(2)).join(' x ');
    const deg = ((shape.rotation[1] * 180) / Math.PI).toFixed(0);
    hint.innerHTML = `<b>${shape.type}</b> ${dims} &middot; y-rotation ${deg}&deg; &middot; R rotate, [ ] scale, 1-8 color, Delete remove`;
  } else {
    hint.textContent =
      'Drag to orbit · shift-drag to pan · wheel to zoom · click a shape to select';
  }
}

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.key === 'Delete' || event.key === 'Backspace') {
    deleteSelected();
  } else if (event.key === 'r' || event.key === 'R') {
    rotateSelected(event.shiftKey ? -Math.PI / 12 : Math.PI / 12);
  } else if (event.key === ']') {
    scaleSelected(1.1);
  } else if (event.key === '[') {
    scaleSelected(1 / 1.1);
  } else if (event.key >= '1' && event.key <= '8') {
    colorSelected(Number(event.key) - 1);
  }
});

document.getElementById('add-box').addEventListener('click', () => addShape('box'));
document.getElementById('add-sphere').addEventListener('click', () => addShape('sphere'));
document.getElementById('add-cylinder').addEventListener('click', () => addShape('cylinder'));
document.getElementById('delete').addEventListener('click', deleteSelected);

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
  addShape,
  deleteSelected,
  rotateSelected,
  scaleSelected,
  colorSelected,
  registerMesh,
  stlBytes,
  exportFileName,
  PALETTE,
  syncUi,
};