import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
test('review HTML preserves JavaScript dollars and its embedded module parses',()=>{
 const build=spawnSync(process.execPath,['scripts/build-review.mjs'],{encoding:'utf8'});assert.equal(build.status,0,build.stderr);
 const html=readFileSync('artifacts/scm-logistics-review.html','utf8'),script=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];assert.ok(script);
 const expected=readFileSync('artifacts/review-check.mjs','utf8').replace(/<\/script/gi,'<\\/script');assert.equal(script,expected);
 const check=spawnSync(process.execPath,['--check','--input-type=module'],{input:script,encoding:'utf8'});assert.equal(check.status,0,check.stderr);
});
