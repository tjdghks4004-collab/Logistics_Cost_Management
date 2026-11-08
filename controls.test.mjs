import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lockedMonths,reconciliationResult,cancelImportBatch,validateOperationalControls} from './controls.mjs';
const stamp='2026-11-08T00:00:00.000Z',who={role:'admin',actor:'admin'};
const row=(id,month='2026-10',amount=100)=>({id,month,amount,recordType:'cost'});
const base=()=>({costs:[row('a'),row('b','2026-11',200)],sales:[],activity:[],notes:[]});
const event=(action='close',id='e')=>({id,month:'2026-10',action,reason:'확인 완료',actor:'admin',at:stamp});
const check=()=>({id:'c',reference:'청구서 A',expected:100,recordIds:['a'],months:['2026-10'],actor:'admin',at:stamp});
test('legacy controls optional; reconciliation follows current amounts and missing rows including zero',()=>{
 const s=base();validateOperationalControls(s,null,who);s.reconciliations=[check()];validateOperationalControls(s,base(),who);assert.equal(reconciliationResult(check(),s).matched,true);
 s.costs[0].amount=101;assert.equal(reconciliationResult(check(),s).difference,1);s.costs=[];assert.equal(reconciliationResult(check(),s).missing,1);assert.equal(reconciliationResult({...check(),expected:0},s).matched,false);
 assert.throws(()=>validateOperationalControls({...base(),reconciliations:[{...check(),months:['2026-11']}]},base(),who));
});
test('locks protect inserts, edits, deletes, month moves, sales, restore and combined reopen requests',()=>{
 const previous={...base(),periodEvents:[event()]};assert.deepEqual([...lockedMonths(previous)],['2026-10']);
 for(const costs of [[row('a','2026-10',110),row('b','2026-11',200)],[row('b','2026-11',200)],[...previous.costs,row('c')],[row('a','2026-12'),row('b','2026-11',200)]])assert.throws(()=>validateOperationalControls({...previous,costs},previous,who),/마감/);
 assert.throws(()=>validateOperationalControls({...previous,sales:[{month:'2026-10',amount:10}]},previous,who),/마감/);
 const reopened={...previous,periodEvents:[...previous.periodEvents,event('reopen','e2')]};validateOperationalControls(reopened,previous,who);assert.throws(()=>validateOperationalControls({...reopened,costs:[]},previous,who),/마감/);validateOperationalControls({...reopened,costs:[]},reopened,who);
 assert.throws(()=>validateOperationalControls(base(),previous,{...who,restore:true}),/마감/);
 assert.throws(()=>validateOperationalControls({...base(),periodEvents:[event()]},base(),{role:'editor',actor:'admin'}),/관리자/);
 assert.throws(()=>validateOperationalControls({...previous,periodEvents:[]},previous,who),/이력/);
});
test('unmatched or missing reconciliations block closing; frozen checks cannot change',()=>{
 const s={...base(),reconciliations:[check()]};validateOperationalControls({...s,periodEvents:[event()]},s,who);
 for(const costs of [[row('a','2026-10',90)],[]])assert.throws(()=>validateOperationalControls({...s,costs,periodEvents:[event()]},{...s,costs},who),/차액/);
 const locked={...s,periodEvents:[event()]};assert.throws(()=>validateOperationalControls({...locked,reconciliations:[]},locked,who),/마감/);
});
test('batch cancellation removes only pristine batch records, preserves evidence and blocks tamper',()=>{
 const before={...base(),costs:[]},s=base();s.importBatches=[{id:'batch',name:'청구.xlsx',actor:'admin',at:stamp,rows:[structuredClone(s.costs[0])]}];validateOperationalControls(s,before,who);
 const cancelled=cancelImportBatch(s,'batch','admin','잘못 등록',stamp);validateOperationalControls(cancelled,s,who);assert.deepEqual(cancelled.costs,[row('b','2026-11',200)]);assert.equal(cancelled.importBatches[0].rows[0].amount,100);
 assert.throws(()=>cancelImportBatch({...s,costs:[row('a','2026-10',99)]},'batch','admin','오류',stamp),/수정/);
 assert.throws(()=>cancelImportBatch({...s,periodEvents:[event()]},'batch','admin','오류',stamp),/마감/);
 assert.throws(()=>validateOperationalControls({...s,importBatches:[]},s,who),/삭제/);
 assert.throws(()=>validateOperationalControls({...cancelled,costs:s.costs},cancelled,who),/취소/);
 assert.throws(()=>validateOperationalControls({...s,importBatches:[{...s.importBatches[0],name:'changed'}]},s,who),/이력/);
});
