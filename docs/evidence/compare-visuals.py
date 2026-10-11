from pathlib import Path
from PIL import Image, ImageChops
import json,hashlib
root=Path(__file__).resolve().parent
out=root/'diff';out.mkdir(exist_ok=True)
entries=[]
for name in ['home','normal-flight','easy-flight','pause','normal-touch-settings','easy-touch-settings','keyboard-settings','result','aircraft-front','aircraft-side','aircraft-rear','aircraft-bank','camera-normal','camera-easy']:
    a=root/'baseline'/f'{name}-baseline.png';b=root/'candidate'/f'{name}-candidate.png'
    if not a.exists() or not b.exists():continue
    ai=Image.open(a).convert('RGB');bi=Image.open(b).convert('RGB')
    if ai.size!=bi.size:entries.append({'name':name,'sameSize':False});continue
    diff=ImageChops.difference(ai,bi);diff.save(out/f'{name}-diff.png')
    changed=sum(1 for pixel in diff.get_flattened_data()if any(pixel));absolute=sum(sum(pixel)for pixel in diff.get_flattened_data())
    comparable=name.startswith('aircraft-')or name.startswith('camera-')
    entries.append({'name':name,'sameSize':True,'dimensions':list(ai.size),'changedPixels':changed,'totalPixels':ai.width*ai.height,'changedFraction':changed/(ai.width*ai.height),'meanAbsoluteChannelDifference':absolute/(ai.width*ai.height*3),'pixelEqual':changed==0,'sameStateFixture':comparable,'interpretation':'Isolated same-pose geometry or production camera fixture; full image diff, no background mask.'if comparable else'Informational semantic UI counterpart. Different title/rules/world entities/spawn/timing, cannot represent full diff as equal-state acceptance.','baselineSha256':hashlib.sha256(a.read_bytes()).hexdigest(),'candidateSha256':hashlib.sha256(b.read_bytes()).hexdigest()})
(root/'visual-diff-report.json').write_text(json.dumps({'method':'Pillow RGB absolute difference, no thresholds or image masks','entries':entries},indent=2)+'\n')
print(json.dumps(entries,indent=2))
