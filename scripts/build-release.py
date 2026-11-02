#!/usr/bin/env python3
"""Build an explicit source-only distribution: no DBs, credentials or dependencies."""
from pathlib import Path
import hashlib,json,zipfile
ROOT=Path(__file__).resolve().parents[1]
ROOT_FILES=['.dockerignore','.gitignore','AGENTS.md','README.md','REVIEW.md','START-HERE.md','DEPLOYMENT.md','Dockerfile','compose.yaml','start-scm.cmd','package.json','package-lock.json','index.html','login.html','style.css']
files=[ROOT/name for name in ROOT_FILES]+list(ROOT.glob('*.mjs'))
for folder in ['scripts','deploy']:
    files.extend(p for p in (ROOT/folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.suffix not in ['.pyc'])
files=sorted(set(files));manifest={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
for name in manifest:
    assert not any(part in ['data','backups','node_modules','.git','.aws','.codex'] for part in Path(name).parts)
    assert not name.endswith(('.sqlite','.env','.pem','.key'))
out=ROOT/'artifacts';out.mkdir(exist_ok=True);archive=out/'scm-logistics-app.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
    for p in files:z.write(p,p.relative_to(ROOT))
    z.writestr('RELEASE-MANIFEST.json',json.dumps(manifest,ensure_ascii=False,indent=2))
checksum=hashlib.sha256(archive.read_bytes()).hexdigest()
(out/'scm-logistics-app.zip.sha256').write_text(checksum+'  '+archive.name+'\n')
print(f'실행 패키지 생성: {archive} ({len(files)} files, {archive.stat().st_size} bytes)')
