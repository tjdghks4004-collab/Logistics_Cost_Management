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
