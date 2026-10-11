"""Bind captured fixture artifacts to an explicitly checked implementation commit."""
from pathlib import Path
import datetime
import hashlib
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / 'docs/evidence'
CANDIDATE = EVIDENCE / 'candidate'
COMMIT = subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', sys.argv[1]], text=True).strip()

def load(path):
    return json.loads(path.read_text())

def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args])

ui = load(CANDIDATE / 'manifest.json')
assert len(ui['entries']) == 17, 'Expected all seventeen candidate UI entries.'
assert not ui['errors'], 'Candidate capture has page errors.'
captured = ui['candidateSourceHashes']
mismatch = []
for name, expected in captured.items():
    current = sha((ROOT / name).read_bytes())
    fixed = sha(git(ROOT, 'show', f'{COMMIT}:{name}'))
    if current != expected or fixed != expected:
        mismatch.append({'path': name, 'captured': expected, 'current': current, 'fixed': fixed})
if mismatch:
    raise SystemExit(json.dumps(mismatch, indent=2))
ui.update(sourceCommit=COMMIT, sourceMatchesCommit=True)
for entry in ui['entries']:
    path = CANDIDATE / (entry['name'] + '.json')
    state = load(path)
    state['candidateSourceCommit'] = COMMIT
    write(path, state)
write(CANDIDATE / 'manifest.json', ui)
write(CANDIDATE / 'source-snapshot-readback.json', {
    'captureSource': '/workspace/nusumidase-visual-snapshot', 'sourceCommit': COMMIT,
    'comparisonTime': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'candidateSourceMatchesCurrentTree': True, 'candidateSourceMatchesFixedCommit': True,
    'mismatchedFiles': [], 'capturedSourceHashes': captured})

subset = {path: captured[path] for path in ['src/aircraft-batch.ts', 'src/aircraft.ts',
    'src/atmosphere.ts', 'src/flight-view.ts', 'src/gun-sight.ts', 'src/ocean.ts', 'src/scene.ts']}
camera = load(CANDIDATE / 'camera-manifest.json')
camera.update(geometrySceneSourcesVerifiedAgainstCommit=COMMIT,
    candidateGeometrySceneSourceHashes=subset,
    note=f'Production-scene camera fixtures recaptured from git-archived source {COMMIT}. Full background/player retained; no full-background masking.')
for entry in camera['entries']:
    entry.update(candidateSourceCommit=COMMIT, candidateSourceHashes=subset)
    path = CANDIDATE / (entry['name'] + '.json')
    state = load(path)
    state.update(candidateSourceCommit=COMMIT, candidateSourceHashes=subset)
    write(path, state)
write(CANDIDATE / 'camera-manifest.json', camera)

models = load(CANDIDATE / 'model-camera-manifest.json')
historical = models['candidateGeometrySceneSourceHashes']['src/aircraft.ts']
assert historical == captured['src/aircraft.ts'], 'Isolated aircraft source changed; recapture models.'
models.update(isolatedModelSourcesRevalidatedAgainstCommit=COMMIT,
    isolatedModelSourceHashes={'src/aircraft.ts': captured['src/aircraft.ts']},
    finalSceneChangeDoesNotAffectIsolatedModelFixture=True,
    note=f'Original model capture times and source390 historical hashes retained. Isolated factory fixture imports aircraft.ts only; its source hash is unchanged in {COMMIT}. Scene changes are outside this model fixture. Comparison is in ../visual-diff-report.json.')
write(CANDIDATE / 'model-camera-manifest.json', models)

sources = load(EVIDENCE / 'source-manifest.json')
records = [{**entry, 'repository': sources['source'], 'commit': entry['sourceCommit']}
    for entry in sources['entries']] + sources['throttleAdapterSources'] + sources['throttleContractSources'] + [sources['throttleCoreSource']] + sources['aircraftCameraCrosscheckSources']
checks = []
for entry in records:
    repo = ROOT.parent / entry['repository'].split('/')[-1]
    object_name = entry['commit'] + ':' + entry['path']
    passed = sha(git(repo, 'show', object_name)) == entry['sha256'] and git(repo, 'rev-parse', object_name).decode().strip() == entry['gitBlob']
    checks.append({'type': 'source', 'repository': entry['repository'], 'commit': entry['commit'], 'path': entry['path'], 'passed': passed})
for relative in ['baseline/manifest.json', 'baseline/model-camera-manifest.json', 'candidate/manifest.json', 'candidate/model-camera-manifest.json', 'candidate/camera-manifest.json']:
    for entry in load(EVIDENCE / relative)['entries']:
        path = Path(relative).parent / (entry['name'] + '.png')
        checks.append({'type': 'image', 'path': 'docs/evidence/' + str(path), 'passed': sha((EVIDENCE / path).read_bytes()) == entry['sha256']})
checks += [{'type': 'candidateSource', 'path': path, 'passed': True} for path in captured]
failures = [entry for entry in checks if not entry['passed']]
if failures:
    raise SystemExit(json.dumps(failures, indent=2))
diff = load(EVIDENCE / 'visual-diff-report.json')
for entry in diff['entries']:
    for variant in ['baseline', 'candidate']:
        image = EVIDENCE / variant / (entry['name'] + '-' + variant + '.png')
        assert sha(image.read_bytes()) == entry[variant + 'Sha256'], 'Diff report must be recomputed after capture.'
fixed_images = [entry for entry in diff['entries'] if entry['sameStateFixture']]
assert len(fixed_images) == 6 and all(entry['changedPixels'] == 0 and entry['pixelEqual'] and entry['baselineSha256'] == entry['candidateSha256'] for entry in fixed_images)
result = {'comparisonTime': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'candidateSourceCommit': COMMIT,
    'sourceRecordCount': len(records), 'imageCount': sum(entry['type'] == 'image' for entry in checks),
    'candidateSourceCount': len(captured), 'candidateUIEntryCount': len(ui['entries']), 'pageErrorCount': len(ui['errors']),
    'sameFixtureImageCount': len(fixed_images), 'sameFixturePixelDiffZero': True,
    'candidateSourceMatchesCurrentAndGitArchive': True, 'failures': [], 'checks': checks,
    'limitations': 'SHA/blob evidence integrity only; no additional browser, acceptance matrix, hardware or human-play test.'}
write(EVIDENCE / 'evidence-integrity-readback.json', result)
print(json.dumps({key: value for key, value in result.items() if key not in ['checks', 'limitations']}))
