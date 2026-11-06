import {test} from 'node:test';import assert from 'node:assert/strict';
import {resolveStoreSearch,planQuickEntry} from './quick-entry.mjs';
const ctx={stores:[{id:'s1',code:'0001',name:'서울점',groupId:'g1',active:true},{id:'s2',code:'C002',name:'부산점',groupId:'g2',active:true},{id:'s3',code:'OLD',name:'구매장',groupId:'g1',active:false}],groups:[{id:'g1',name:'그룹1'},{id:'g2',name:'그룹2'}],countries:[{code:'KR',name:'대한민국'}],centerMasters:[{name:'센터A',countryCode:'KR'}],masters:[{name:'보관료',active:true},{name:'포워딩',active:true}],units:['원','건'],costs:[]};
const settings={domain:'center',recordType:'cost',account:'B2C',category:'보관료',context:{month:'2026-11',center:'센터A'}};
test('store search resolves code, name, display label and common scope while rejecting unresolved/inactive entries',()=>{
 for(const value of ['0001','서울점','0001 · 서울점'])assert.equal(resolveStoreSearch(value,ctx.stores).id,'s1');assert.equal(resolveStoreSearch('c002',ctx.stores).id,'s2');assert.equal(resolveStoreSearch('센터 공통',ctx.stores).id,'');assert.throws(()=>resolveStoreSearch('서울',ctx.stores));assert.throws(()=>resolveStoreSearch('OLD',ctx.stores));assert.equal(resolveStoreSearch('OLD',ctx.stores,{existingId:'s3'}).id,'s3');
});
test('two pasted columns use common settings, name/code lookup and exact formatted amounts',()=>{
 const plan=planQuickEntry('매장코드\t금액\n0001\t125,000\n부산점\t₩200000\n센터 공통\t300000원',settings,ctx);assert.deepEqual(plan.errors,[]);assert.equal(plan.rows.length,3);assert.equal(plan.entries.reduce((n,r)=>n+r.amount,0),625000);assert.equal(plan.rows[0].groupId,'g1');assert.equal(plan.rows[1].groupId,'g2');assert.equal(plan.rows[2].storeId,'');assert.equal(plan.rows[0].mode,'amount');
});
test('quick counts exclude cost amounts and errors block unknown stores, malformed rows and duplicates',()=>{
 const plan=planQuickEntry('0001\t100\nC002\t50',{...settings,recordType:'count',account:'B2B'},ctx);assert.deepEqual(plan.errors,[]);assert.equal(plan.entries.reduce((n,r)=>n+r.amount,0),0);assert.equal(plan.entries.reduce((n,r)=>n+r.quantity,0),150);assert.equal(plan.rows[0].category,'B2B 출고 건수');
 for(const text of ['unknown\t100','0001\t-1','0001\t1.5','0001\t1\textra','0001\t100\n0001\t100'])assert.ok(planQuickEntry(text,settings,ctx).errors.length);
 const first=planQuickEntry('0001\t100',settings,ctx).entries[0];assert.ok(planQuickEntry('0001\t100',settings,{...ctx,costs:[first]}).errors.length);
 assert.ok(planQuickEntry('0001\t100',{...settings,recordType:'count',account:'공통'},ctx).errors.length);
});
