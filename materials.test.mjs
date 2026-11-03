import {test} from 'node:test';import assert from 'node:assert/strict';
import {materialMoney,validateMaterialMasters,applicableMaterialPrices,materialPriceChange,buildMaterialPurchase,validateMaterialCosts} from './materials.mjs';
const fixture=()=>({materials:[{id:'m1',code:'BOX-S',kind:'택배박스',name:'택배박스 S',specification:'210×160×120 mm',flute:'B골',unit:'EA',active:true}],materialPrices:[{id:'p1',materialId:'m1',supplier:'공급사 A',center:'인천',unit:'EA',moq:100,unitPrice:'226',effectiveFrom:'2026-01-01',vatIncluded:false,vatRate:10,active:true},{id:'p2',materialId:'m1',supplier:'공급사 A',center:'인천',unit:'EA',moq:100,unitPrice:'125',effectiveFrom:'2026-10-01',vatIncluded:false,vatRate:10,active:true}],centerMasters:[{name:'인천',countryCode:'KR'}],countries:[{code:'KR',name:'대한민국'}],costs:[]});
const draft={purchaseDate:'2026-11-01',materialId:'m1',priceId:'p2',quantity:'100',unitPrice:'120',center:'인천',countryCode:'KR',memo:'청구서 1'};
test('date-effective supplier/center quotes and comparable savings preserve old price rows',()=>{
 const ctx=fixture();assert.doesNotThrow(()=>validateMaterialMasters(ctx));assert.deepEqual(applicableMaterialPrices(ctx,'m1','2026-09-30').map(p=>p.id),['p1']);assert.deepEqual(applicableMaterialPrices(ctx,'m1','2026-10-01').map(p=>p.id),['p2']);
 const change=materialPriceChange(ctx.materialPrices[1],ctx);assert.equal(change.saving,101);assert.ok(change.percent>44&&change.percent<45);
 const next=structuredClone(ctx);next.materialPrices[0].unitPrice='100';assert.throws(()=>validateMaterialMasters(next,ctx),/덮어/);next.materialPrices[0]=ctx.materialPrices[0];next.materialPrices[1].active=false;assert.doesNotThrow(()=>validateMaterialMasters(next,ctx));
});
test('material amount rounding separates VAT and permits actual unit-price overrides',()=>{
 assert.deepEqual(materialMoney('3','110',true,10),{amount:300,vat:30,total:330});assert.deepEqual(materialMoney('3','100',false,10),{amount:300,vat:30,total:330});assert.deepEqual(materialMoney('1.005','100',false,0),{amount:101,vat:0,total:101});
 const ctx=fixture(),row=buildMaterialPurchase(draft,ctx);assert.equal(row.amount,12000);assert.equal(row.material.totalAmount,13200);assert.equal(row.material.quotedPrice,'125');assert.equal(row.material.unitPrice,'120');assert.equal(row.domain,'center');assert.doesNotThrow(()=>validateMaterialCosts({...ctx,costs:[row]}));
 assert.equal(buildMaterialPurchase({...draft,center:''},ctx).domain,'common');assert.throws(()=>buildMaterialPurchase({...draft,quantity:0},ctx),/수량/);assert.throws(()=>buildMaterialPurchase({...draft,purchaseDate:'2026-09-01'},ctx),/구매일/);
});
test('purchase snapshots survive master edits and server rejects tampering, field removal, and inactive new orders',()=>{
 const ctx=fixture(),row=buildMaterialPurchase(draft,ctx),before={...ctx,costs:[row]},next=structuredClone(before);next.materials[0].name='새 이름';next.materials[0].specification='새 규격';next.materials[0].active=false;next.materialPrices[1].active=false;
 const edited=buildMaterialPurchase({...draft,quantity:'200'},next,{previous:row});assert.equal(edited.material.name,'택배박스 S');assert.equal(edited.material.specification,'210×160×120 mm');assert.equal(edited.amount,24000);
 assert.doesNotThrow(()=>validateMaterialCosts({...next,costs:[edited]},before));assert.throws(()=>buildMaterialPurchase(draft,next),/품목/);
 assert.throws(()=>validateMaterialCosts({...next,costs:[{...edited,amount:1}]},before),/금액/);
 const bad=structuredClone(edited);bad.material.specification='변조';assert.throws(()=>validateMaterialCosts({...next,costs:[bad]},before),/변경/);
 const removed={...row};delete removed.material;assert.throws(()=>validateMaterialCosts({...next,costs:[removed]},before),/제거/);
 assert.doesNotThrow(()=>validateMaterialCosts({...next,costs:[row]},null,{restore:true}));
});
test('material validation rejects duplicate codes/quotes, invalid dates and missing references',()=>{
 const ctx=fixture();for(const mutate of [c=>c.materials.push({...c.materials[0],id:'m2'}),c=>c.materialPrices.push({...c.materialPrices[0],id:'p3'}),c=>c.materialPrices[0].effectiveFrom='2026-02-30',c=>c.materialPrices[0].materialId='missing',c=>c.materialPrices[0].moq=-1]){const bad=structuredClone(ctx);mutate(bad);assert.throws(()=>validateMaterialMasters(bad));}
});
