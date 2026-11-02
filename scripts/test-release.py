#!/usr/bin/env python3
"""Verify distribution integrity and startup/restart using only a disposable DB."""
from pathlib import Path
import hashlib,http.cookiejar,json,os,re,secrets,select,subprocess,tempfile,time,urllib.request,zipfile
ROOT=Path(__file__).resolve().parents[1]
def main():
    subprocess.run(['python3','scripts/build-release.py'],cwd=ROOT,check=True)
    archive=ROOT/'artifacts/scm-logistics-app.zip'
    assert hashlib.sha256(archive.read_bytes()).hexdigest()==(ROOT/'artifacts/scm-logistics-app.zip.sha256').read_text().split()[0]
    with tempfile.TemporaryDirectory(prefix='scm-package-') as tmp:
        dest=Path(tmp)/'app';dest.mkdir()
        with zipfile.ZipFile(archive) as z:
            manifest=json.loads(z.read('RELEASE-MANIFEST.json'))
            assert set(z.namelist())==set(manifest)|{'RELEASE-MANIFEST.json'}
            for name,checksum in manifest.items():
                assert not Path(name).is_absolute() and '..' not in Path(name).parts
                assert not any(part in ['data','backups','node_modules','.git','.aws','.codex'] for part in Path(name).parts)
                assert hashlib.sha256(z.read(name)).hexdigest()==checksum
            z.extractall(dest)
        # Only the test environment reuses installed dependencies; the ZIP does not ship them.
        (dest/'node_modules').symlink_to(ROOT/'node_modules',target_is_directory=True)
        db=str(Path(tmp)/'test.sqlite');password=secrets.token_urlsafe(24)
        def start():
            process=subprocess.Popen(['node','scripts/start-local.mjs','--no-browser'],cwd=dest,env={**os.environ,'PORT':'0','LOGISTICS_DB_PATH':db},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            deadline=time.monotonic()+15
            while time.monotonic()<deadline:
                if process.poll() is not None:raise RuntimeError('Packaged server failed to start')
                ready,_,_=select.select([process.stdout],[],[],1)
                if ready:
                    match=re.search(r'http://127.0.0.1:(\d+)',process.stdout.readline())
                    if match:return process,'http://127.0.0.1:'+match.group(1)
            process.terminate();raise RuntimeError('Packaged startup timed out')
        def stop(process):
            process.terminate()
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired:process.kill();process.wait()
        process,url=start()
        try:
            csrf='';opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
            def request(path,body=None,method=None):
                headers={'Origin':url,'Content-Type':'application/json'}
                if csrf:headers['X-CSRF-Token']=csrf
                req=urllib.request.Request(url+'/api/'+path,data=json.dumps(body).encode() if body is not None else None,headers=headers,method=method)
                with opener.open(req,timeout=10) as response:return json.load(response)
            assert request('status')['setupRequired'] is True
            credentials={'username':'release_test','password':password}
            request('setup',credentials);csrf=request('login',credentials)['csrf']
            state={'costs':[],'activity':[],'notes':[],'masters':[],'groups':[],'stores':[],'countries':[{'code':'KR','name':'대한민국'}],'centerMasters':[]}
            request('state',{'revision':0,'state':state},'PUT');assert request('state')['state']==state
            stop(process);process,url=start();csrf='';csrf=request('login',credentials)['csrf'];assert request('state')['state']==state
            print('PASS: source-only ZIP checksums, extracted local launcher, authenticated SQLite save and process restart; Windows launcher not executed')
        finally:stop(process)
if __name__=='__main__':main()
