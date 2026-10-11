import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = path => readFile(resolve(root, path));
const json = async path => JSON.parse(await read(path));
const sha = async path => createHash('sha256').update(await read(path)).digest('hex');
const implementation = await json('docs/evidence/implementation-manifest.json');
for (const [path, hash] of Object.entries(implementation.files)) {
  assert.equal(await sha(path), hash, `Implementation changed: ${path}`);
}
const candidate = await json('docs/evidence/candidate/manifest.json');
for (const [path, hash] of Object.entries(candidate.candidateSourceHashes)) {
  assert.equal(await sha(path), hash, `Capture source changed: ${path}`);
}
assert.equal(candidate.sourceCommit, implementation.runtimeCommit ?? implementation.checkedImplementationCommit);
assert.deepEqual(candidate.errors, []);
assert.equal(await sha('src/throttle-lever.ts'), 'e83fe3c570581d16cb76e08ef9a039bbe9d4a50da6575366ac7e126bf3f30cf0');
assert.equal(await sha('tests/fixtures/throttle-lever-v1.json'), '416c5ac01d4d14d1f45d94385e07233090740db04382e468db1f0c64689df8ca');
let images = 0;
for (const path of ['baseline/manifest.json', 'baseline/model-camera-manifest.json',
  'candidate/manifest.json', 'candidate/model-camera-manifest.json', 'candidate/camera-manifest.json']) {
  const manifest = await json(`docs/evidence/${path}`);
  const directory = path.split('/')[0];
  for (const entry of manifest.entries) {
    assert.equal(await sha(`docs/evidence/${directory}/${entry.name}.png`), entry.sha256, `Image changed: ${entry.name}`);
    images++;
  }
}
console.log(`Verified ${Object.keys(implementation.files).length} implementation files, ${Object.keys(candidate.candidateSourceHashes).length} capture source files, shared core/fixtures and ${images} images.`);
console.log('This checks evidence identity; it does not replace the documented functional or real-device gates.');
