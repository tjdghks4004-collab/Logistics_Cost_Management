import {test} from 'node:test';import assert from 'node:assert/strict';
import {summarizeOutboundRows,planOutboundEntry} from './outbound.mjs';
const ctx={stores:[{id:'s1',code:'C02833',name:'온라인점',groupId:'g1',active:true}],groups:[{id:'g1',name:'온라인'}],countries:[{code:'KR',name:'대한민국'}],centerMasters:[{name:'A',countryCode:'KR'}],masters:[{name:'B2C 출고비',active:true},{name:'B2B 출고비',active:true}],units:['원','건'],costs:[]};
const draft={month:'2026-10',center:'A',account:'B2C',rows:[{storeId:'s1',amount:'17244352',quantity:'6623',memo:'월 청구'}]};
test('one input row produces cost and count records without increasing monetary totals by volume',()=>{const p=planOutboundEntry(draft,ctx);assert.deepEqual(p.errors,[]);assert.equal(p.entries.length,2);assert.equal(p.entries.reduce((n,r)=>n+r.amount,0),17244352);assert.equal(p.entries.find(r=>r.recordType==='count').quantity,6623);assert.equal(p.entries[0].groupId,'g1');});
test('summary pairs matching scopes only and preserves individual source rows without mutation',()=>{const p=planOutboundEntry(draft,ctx),before=structuredClone(p.entries),rows=p.entries.map((r,i)=>({...r,id:String(i)}));const rent={...rows[0],id:'rent',category:'지급임차료',amount:100};const summary=summarizeOutboundRows([rent,...rows]);assert.equal(summary.length,2);assert.equal(summary[1].paired,true);assert.equal(summary[1].amount,17244352);assert.equal(summary[1].quantity,6623);assert.equal(summary[1].sources.length,2);assert.equal(summary[1].unitCost,17244352/6623);assert.deepEqual(p.entries,before);
 for(const field of ['month','center','countryCode','storeId','groupId','account']){const other={...rows[1],[field]:'different'};assert.equal(summarizeOutboundRows([rows[0],other]).length,2);}
});
test('missing and zero quantities remain distinct and invalid rows/duplicates block the whole save',()=>{
 const costOnly=planOutboundEntry({...draft,rows:[{storeId:'s1',amount:'100',quantity:'',memo:''}]},ctx);assert.equal(costOnly.entries.length,1);assert.equal(summarizeOutboundRows(costOnly.entries)[0].quantity,null);
 const zero=planOutboundEntry({...draft,rows:[{storeId:'s1',amount:'0',quantity:'0',memo:''}]},ctx);const s=summarizeOutboundRows(zero.entries)[0];assert.equal(s.amount,0);assert.equal(s.quantity,0);assert.equal(s.unitCost,null);
 for(const bad of [{quantity:'1.5'},{amount:'-1'},{storeId:'missing'},{storeQuery:'미확정 검색어'}])assert.ok(planOutboundEntry({...draft,rows:[{...draft.rows[0],...bad}]},ctx).errors.length);
 const saved=planOutboundEntry(draft,ctx).entries;assert.ok(planOutboundEntry(draft,{...ctx,costs:saved}).errors.length);
});

test('explicit parcel and box costs pair only with matching count basis; old counts are preserved',()=>{
 const context={...ctx,masters:[...ctx.masters,{name:'택배비',active:true}],units:['원','건','BOX']};
 const plans=['parcel','box','legacy'].map(countKind=>planOutboundEntry({...draft,countKind,rows:[{storeId:'s1',amount:'600',quantity:countKind==='box'?'2':'1'}]},context));
 plans.forEach(p=>assert.deepEqual(p.errors,[]));assert.equal(plans[0].entries[0].category,'택배비');assert.equal(plans[0].entries[0].price,600);assert.equal(plans[1].entries[0].price,300);assert.equal(plans[1].entries[1].unit,'BOX');
 const rows=plans.flatMap(p=>p.entries);const summary=summarizeOutboundRows(rows);assert.equal(summary.length,3);assert.deepEqual(new Set(summary.map(g=>g.kind)),new Set(['parcel','box','legacy']));assert.deepEqual(summary.map(g=>g.quantity),[1,2,1]);assert.deepEqual(summary.map(g=>g.unitCost),[600,300,600]);assert.equal(rows.reduce((n,r)=>n+r.amount,0),1800);
 assert.ok(planOutboundEntry({...draft,countKind:'box',rows:[{...draft.rows[0],quantity:'1.5'}]},context).errors.length);
});

test('new unsegmented quantity records preserve parcel and box bases while historical accounts stay intact',()=>{
 const context={...ctx,masters:[...ctx.masters,{name:'택배비',active:true},{name:'박스 출고비',active:true}],units:['원','건','BOX']};
 for(const kind of ['box','parcel']){const p=planOutboundEntry({...draft,account:'공통',countKind:kind},context);assert.deepEqual(p.errors,[]);assert.equal(p.entries[0].category,kind==='box'?'박스 출고비':'택배비');assert.equal(p.entries[1].category,kind==='box'?'출고 박스 수':'택배 발송 건수');assert.equal(p.entries[1].account,'공통');assert.equal(summarizeOutboundRows(p.entries).length,1);}
 assert.equal(planOutboundEntry(draft,context).entries[1].category,'B2C 출고 건수');
});
