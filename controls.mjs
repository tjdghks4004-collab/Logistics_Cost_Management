// Operational controls are optional metadata; legacy financial rows remain untouched.
const controlMonth=v=>typeof v==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const controlText=(v,max=200)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\u0000-\u001f]/.test(v);
const controlEqual=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function lockedMonths(state){const months=new Set();for(const event of state.periodEvents||[])event.action==='close'?months.add(event.month):months.delete(event.month);return months;}
export function reconciliationResult(check,state){const found=new Map(state.costs.map(r=>[r.id,r])),rows=check.recordIds.map(id=>found.get(id)),missing=rows.filter(r=>!r).length,total=rows.reduce((n,r)=>n+(r?.recordType==='cost'?r.amount:0),0);return {total,missing,difference:total-check.expected,matched:!missing&&total===check.expected};}
export function cancelImportBatch(state,id,actor,reason,at=new Date().toISOString()){
 const batch=(state.importBatches||[]).find(b=>b.id===id);if(!batch||batch.cancelled)throw Error('취소할 수 있는 업로드가 아닙니다.');
 if(!controlText(reason,500))throw Error('취소 사유를 입력하세요.');
 const current=new Map(state.costs.map(r=>[r.id,r]));
 if(batch.rows.some(r=>!controlEqual(current.get(r.id),r)))throw Error('업로드 후 수정·삭제된 내역이 있어 일괄 취소할 수 없습니다. 원본 내역을 확인하세요.');
 if(batch.rows.some(r=>lockedMonths(state).has(r.month)))throw Error('마감된 월의 업로드는 취소할 수 없습니다.');
 const ids=new Set(batch.rows.map(r=>r.id));
 return {...state,costs:state.costs.filter(r=>!ids.has(r.id)),importBatches:state.importBatches.map(b=>b.id===id?{...b,cancelled:{actor,reason:reason.trim(),at}}:b)};
}
export function validateOperationalControls(next,previous=null,{role='admin',actor='',restore=false}={}){
 const fail=m=>{throw Error(m);};
 const lists=['periodEvents','importBatches','reconciliations'];
 for(const key of lists){if(next[key]!==undefined&&(!Array.isArray(next[key])||next[key].length>100000))fail('운영 관리 자료 형식을 확인하세요.');const list=next[key]||[];if(new Set(list.map(r=>r?.id)).size!==list.length)fail('운영 관리 ID가 중복됩니다.');for(const r of list)if(!r||!controlText(r.id,100))fail('운영 관리 ID를 확인하세요.');}
 const events=next.periodEvents||[],oldEvents=previous?.periodEvents||[];
 const eventState=new Set();for(const e of events){if(!controlMonth(e.month)||!['close','reopen'].includes(e.action)||!controlText(e.reason,500)||!controlText(e.actor,80)||!controlText(e.at,40)||!Number.isFinite(Date.parse(e.at)))fail('마감 이력 값을 확인하세요.');if((e.action==='close')===eventState.has(e.month))fail('마감 상태가 이미 변경되었습니다.');e.action==='close'?eventState.add(e.month):eventState.delete(e.month);}
 if(!restore){if(events.length<oldEvents.length||oldEvents.some((e,i)=>!controlEqual(e,events[i])))fail('마감 이력은 변경·삭제할 수 없습니다.');if(events.length>oldEvents.length){if(role!=='admin')fail('마감·마감 해제는 관리자만 가능합니다.');if(events.length!==oldEvents.length+1)fail('마감 상태는 한 번에 한 건씩 변경하세요.');const e=events.at(-1);if(e.actor!==actor)fail('마감 처리자를 확인하세요.');}}
 // Existing closed months stay protected even during restore or a combined unlock+edit request.
 const locked=lockedMonths(previous||{});
 for(const key of ['costs','sales','activity','notes']){for(const month of locked){const before=(previous?.[key]||[]).filter(r=>r.month===month),after=(next[key]||[]).filter(r=>r.month===month);if(!controlEqual(before,after))fail(`${month}은 마감되어 등록·수정·삭제·복원할 수 없습니다. 먼저 별도로 마감을 해제하세요.`);}}
 if(restore&&[...locked].some(month=>!lockedMonths(next).has(month)))fail('복원으로 마감을 해제할 수 없습니다. 먼저 별도로 마감을 해제하세요.');
 const oldBatches=new Map((previous?.importBatches||[]).map(b=>[b.id,b]));const current=new Map(next.costs.map(r=>[r.id,r])),prevRows=new Map((previous?.costs||[]).map(r=>[r.id,r]));const used=new Set();
 for(const b of next.importBatches||[]){if(!controlText(b.name)||!controlText(b.actor,80)||!controlText(b.at,40)||!Number.isFinite(Date.parse(b.at))||!Array.isArray(b.rows)||!b.rows.length||b.rows.length>2000)fail('업로드 이력을 확인하세요.');for(const r of b.rows){if(!r||!controlText(r.id,100)||!controlMonth(r.month)||!['cost','count'].includes(r.recordType)||!Number.isSafeInteger(r.amount)||r.amount<0)fail('업로드 원본을 확인하세요.');if(used.has(r.id))fail('동일 내역을 여러 업로드에 연결할 수 없습니다.');used.add(r.id);}
  if(b.cancelled&&(!controlText(b.cancelled.actor,80)||!controlText(b.cancelled.reason,500)||!Number.isFinite(Date.parse(b.cancelled.at))))fail('취소 사유·처리자를 확인하세요.');
  if(restore)continue;const old=oldBatches.get(b.id);
  if(!old){if(b.actor!==actor||b.cancelled||b.rows.some(r=>prevRows.has(r.id)||!controlEqual(current.get(r.id),r)))fail('새로 등록한 내역만 업로드 이력에 연결할 수 있습니다.');}
  else {if(!controlEqual({...old,cancelled:undefined},{...b,cancelled:undefined})||old.cancelled&&!controlEqual(old.cancelled,b.cancelled))fail('업로드 이력은 변경·삭제할 수 없습니다.');if(!old.cancelled&&b.cancelled){if(b.cancelled.actor!==actor)fail('취소 처리자를 확인하세요.');cancelImportBatch(previous,b.id,actor,b.cancelled.reason,b.cancelled.at);if(b.rows.some(r=>current.has(r.id)))fail('업로드 취소 대상이 남아 있습니다.');}if(old.cancelled&&b.rows.some(r=>current.has(r.id)))fail('취소된 업로드 내역은 다시 등록할 수 없습니다.');}
 }
 if(!restore&&(previous?.importBatches||[]).some(b=>!(next.importBatches||[]).some(n=>n.id===b.id)))fail('업로드 이력은 삭제할 수 없습니다.');
 const checks=next.reconciliations||[],oldChecks=new Map((previous?.reconciliations||[]).map(r=>[r.id,r]));
 for(const c of checks){if(!Array.isArray(c.months)||!c.months.length||c.months.some(m=>!controlMonth(m))||new Set(c.months).size!==c.months.length||!controlText(c.reference)||!Number.isSafeInteger(c.expected)||c.expected<0||c.expected>1e12||!Array.isArray(c.recordIds)||!c.recordIds.length||c.recordIds.length>100000||new Set(c.recordIds).size!==c.recordIds.length||c.recordIds.some(id=>!controlText(id,100))||!controlText(c.actor,80)||!Number.isFinite(Date.parse(c.at)))fail('청구서 대조 값을 확인하세요.');if(!restore&&!controlEqual(oldChecks.get(c.id),c)){if(c.actor!==actor||c.recordIds.some(id=>current.get(id)?.recordType!=='cost')||!controlEqual([...new Set(c.recordIds.map(id=>current.get(id)?.month))].sort(),[...c.months].sort()))fail('대조할 비용 내역과 처리자를 확인하세요.');}for(const month of locked){const old=oldChecks.get(c.id);if(!controlEqual(old,c)&&[...(old?.months||[]),...c.months].includes(month))fail('마감된 월의 청구서 대조는 변경할 수 없습니다.');}}
 for(const c of oldChecks.values())if(!checks.some(n=>n.id===c.id)&&c.months.some(month=>locked.has(month)))fail('마감된 월의 청구서 대조는 삭제할 수 없습니다.');
 if(!restore&&events.length>oldEvents.length&&events.at(-1).action==='close'){const month=events.at(-1).month;for(const c of checks)if(c.months.includes(month)&&!reconciliationResult(c,next).matched)fail('해당 월에 차액·누락이 있는 청구서 대조가 있습니다. 먼저 확인하세요.');}
}
