import assert from 'node:assert/strict';
import {
  resolveMesh,
  serializeShape,
  reviveShape,
} from '../src/meshstore.js';

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

const sampleMesh = () => ({
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
  indices: [0, 1, 2],
});

check('resolveMesh is undefined when the shape carries no mesh', () => {
  assert.equal(resolveMesh({ type: 'box' }), undefined);
});

check('resolveMesh builds a GPU entry lazily and caches it by identity', () => {
  const shape = { type: 'mesh', mesh: sampleMesh() };
  let built = 0;
  const create = () => ({ gpu: ++built });
  const first = resolveMesh(shape, create);
  const second = resolveMesh(shape, create);
  assert.equal(built, 1, 'create ran more than once for the same mesh');
  assert.equal(first, second, 'cached entry was not returned');
});

check('resolveMesh yields distinct entries for distinct mesh objects', () => {
  const a = resolveMesh({ mesh: sampleMesh() }, () => ({ gpu: 'a' }));
  const b = resolveMesh({ mesh: sampleMesh() }, () => ({ gpu: 'b' }));
  assert.notEqual(a, b);
});

check('serializeShape makes mesh arrays survive a JSON round-trip', () => {
  const shape = {
    type: 'mesh',
    position: [1, 2, 3],
    mesh: {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint16Array([0, 1, 2]),
    },
  };
  const wire = JSON.parse(JSON.stringify(serializeShape(shape)));
  const back = reviveShape(wire);
  assert.deepEqual(Array.from(back.mesh.positions), [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  assert.deepEqual(Array.from(back.mesh.normals), [0, 0, 1, 0, 0, 1, 0, 0, 1]);
  assert.deepEqual(Array.from(back.mesh.indices), [0, 1, 2]);
  assert.deepEqual(back.position, [1, 2, 3]);
});

check('serializeShape leaves meshless shapes unchanged', () => {
  const shape = { type: 'box', position: [0, 0, 0] };
  assert.deepEqual(serializeShape(shape), shape);
  assert.deepEqual(reviveShape(shape), shape);
});

console.log(failures ? `\n${failures} failing` : '\nall passed');
process.exit(failures ? 1 : 0);
