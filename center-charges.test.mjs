import {test} from 'node:test';import assert from 'node:assert/strict';
import {planCenterCharges,parseCenterChargePaste,centerChargeCategories} from './center-charges.mjs';
const ctx={stores:[{id:'s',code:'C001',name:'마켓컬리',groupId:'g',active:true}],groups:[{id:'g',name:'B2B'}],countries:[{code:'KR',name:'대한민국'}],centerMasters:[{name:'A',countryCode:'KR'}],masters:[{name:'B2C 출고비',active:true},{name:'B2B 출고비',active:true},{name:'용차임',active:true},{name:'임가공비(라벨링)',active:true},{name:'작업A',parentCategory:'임가공비',active:true}],units:['원','BOX','건','EA'],costs:[]};
const draft={type:'box',month:'2026-11',center:'A',account:'B2B',unit:'BOX',mode:'calculated',rows:[{storeId:'s',quantity:'500',price:'1200',amount:'',memo:''}]};
test('typed costs map to existing categories, keep exact totals and never generate shipment counts',()=>{
 const box=planCenterCharges(draft,ctx);assert.deepEqual(box.errors,[]);assert.equal(box.entries[0].category,'B2B 출고비');assert.equal(box.entries[0].amount,600000);assert.equal(box.entries[0].groupId,'g');assert.equal(box.entries.length,1);assert.equal(box.entries[0].recordType,'cost');
 const truck=planCenterCharges({...draft,type:'truck',mode:'amount',rows:[{storeId:'s',amount:'350000'}]},ctx);assert.deepEqual(truck.errors,[]);assert.equal(truck.entries[0].category,'용차임');assert.equal(truck.entries[0].quantity,null);
 const work=planCenterCharges({...draft,type:'processing',category:'잘못된 작업',unit:'EA'},ctx);assert.ok(work.errors.length);
 const proper=planCenterCharges({...draft,type:'processing',category:'작업A',unit:'EA'},ctx);assert.deepEqual(proper.errors,[]);assert.equal(proper.entries[0].category,'작업A');
 const reverse=planCenterCharges({...draft,mode:'reverse',rows:[{storeId:'s',quantity:'3',amount:'1000'}]},ctx);assert.equal(reverse.entries[0].price,333.333333);assert.equal(reverse.entries[0].amount,1000);
});
test('paste type/mode controls column meaning; zeros preserved, partial invalid batches rejected',()=>{
 let p=parseCenterChargePaste('C001\t500\t1,200',draft,ctx);assert.deepEqual(p.errors,[]);assert.equal(planCenterCharges({...draft,rows:p.rows},ctx).entries[0].amount,600000);
 p=parseCenterChargePaste('C001\t350,000',{...draft,type:'truck',mode:'amount'},ctx);assert.deepEqual(p.errors,[]);assert.equal(p.rows[0].amount,'350000');
 p=parseCenterChargePaste('C001\t3\t1000',{...draft,type:'processing',category:'임가공비(라벨링)',mode:'reverse'},ctx);assert.deepEqual(p.errors,[]);assert.equal(p.rows[0].amount,'1000');
 assert.ok(parseCenterChargePaste('C001\t100\nmissing\t20',{...draft,type:'truck',mode:'amount'},ctx).errors.length);
 assert.ok(parseCenterChargePaste('C001\t100',draft,ctx).errors.length);assert.ok(planCenterCharges({...draft,rows:[{...draft.rows[0],storeQuery:'컬리'}]},ctx).errors.length);
 assert.equal(parseCenterChargePaste('C001\t0',{...draft,type:'truck',mode:'amount'},ctx).rows[0].amount,'0');
 assert.ok(planCenterCharges(draft,{...ctx,costs:planCenterCharges(draft,ctx).entries}).errors.length);
 assert.deepEqual(centerChargeCategories('truck','B2B',ctx.masters),['용차임']);assert.deepEqual(centerChargeCategories('truck','B2B',ctx.masters.map(m=>({...m,active:false}))),[]);
});
test('typed pasted names resolve a unique bracketed keyword to canonical store ID and group',()=>{
 const context={...ctx,stores:[{...ctx.stores[0],name:'Agent _예스아시아'}]};
 const parsed=parseCenterChargePaste('예스아시아(항공)\t500\t1200',draft,context);assert.deepEqual(parsed.errors,[]);assert.equal(parsed.rows[0].storeId,'s');assert.equal(parsed.rows[0].groupId,'g');
 assert.equal(planCenterCharges({...draft,rows:parsed.rows},context).entries[0].amount,600000);
 const ambiguous={...context,stores:[...context.stores,{...context.stores[0],id:'s2',code:'C002',name:'Agent _예스아시아(해상)'}]};assert.match(parseCenterChargePaste('예스아시아(항공)\t500\t1200',draft,ambiguous).errors[0],/후보/);
});
test('paste column order can be reversed; unresolved names can be explicitly mapped without stale or inactive overrides',()=>{
 const d={...draft,type:'truck',mode:'reverse',unit:'건',pasteOrder:'value-first'},text='캄보디아 토브\t66,000\t1';
 const first=parseCenterChargePaste(text,d,ctx);assert.ok(first.errors.length);assert.equal(first.resolutions[0].input,'캄보디아 토브');
 const mapped={...d,pasteStores:{0:{input:'캄보디아 토브',storeId:'s'}}};const result=parseCenterChargePaste(text,mapped,ctx);assert.deepEqual(result.errors,[]);assert.equal(result.rows[0].amount,'66000');assert.equal(result.rows[0].quantity,'1');assert.equal(result.resolutions[0].manual,true);assert.equal(planCenterCharges({...d,rows:result.rows},ctx).entries[0].price,66000);
 assert.ok(parseCenterChargePaste('다른 매장\t66000\t1',mapped,ctx).errors.length);assert.ok(parseCenterChargePaste(text,mapped,{...ctx,stores:ctx.stores.map(s=>({...s,active:false}))}).errors.length);
 assert.ok(parseCenterChargePaste('캄보디아 토브\t66000\t1\n미확인 매장\t100\t1',mapped,ctx).errors.length);
 const calculated=parseCenterChargePaste('C001\t1200\t500',{...draft,pasteOrder:'value-first'},ctx);assert.deepEqual(calculated.errors,[]);assert.equal(planCenterCharges({...draft,rows:calculated.rows},ctx).entries[0].amount,600000);
});
