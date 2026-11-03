import {test} from 'node:test';import assert from 'node:assert/strict';
import {validateRecord,validateUnified,costDrivers,unifiedHeaders} from './domain.mjs';import {sum} from './calc.mjs';
import ExcelJS from 'exceljs';import {buildUnifiedTemplate,workbookLines} from './excel.mjs';
const ctx={month:'2026-10',centers:['A'],centerMasters:[{name:'A',countryCode:'KR'}],countries:[{code:'KR',name:'대한민국'},{code:'VN',name:'베트남'}],groups:[{id:'g1',name:'그룹1'}],stores:[{id:'s1',code:'S001',name:'서울점',groupId:'g1',active:true}],masters:[{name:'B2C 출고비',active:true},{name:'포워딩',active:true}],units:['BOX','건','일괄']};
const base={domain:'center',recordType:'cost',month:'2026-10',center:'A',account:'B2C',storeId:'s1',category:'B2C 출고비',unit:'BOX',quantity:'100',price:'500'};
test('cost and count stored together, counts never increase monetary total',()=>{const cost=validateRecord(base,ctx),count=validateRecord({...base,recordType:'count'},ctx);assert.equal(count.quantity,100);assert.equal(count.amount,0);assert.equal(sum([cost,{...count,amount:999999}]),50000);assert.equal(count.groupId,'g1');assert.throws(()=>validateRecord({...base,recordType:'count',quantity:'1.5'},ctx));});
test('trade and common need no center; trade requires shipment and route',()=>{const r={...base,domain:'trade',shipment:'EXP-1',direction:'수출',origin:'KR',destination:'VN',countryCode:'VN'};assert.equal(validateRecord(r,ctx).center,'');assert.equal(validateRecord({...r,domain:'common'},ctx).shipment,'');assert.throws(()=>validateRecord({...r,shipment:''},ctx));assert.throws(()=>validateRecord({...r,destination:'XX'},ctx));});
test('cost effects reconcile to actual difference',()=>{const d=costDrivers(66000,40000,120,80);assert.equal(d.volumeEffect,20000);assert.equal(d.rateEffect,6000);assert.equal(d.difference,d.volumeEffect+d.rateEffect);assert.equal(costDrivers(1,1,0,1),null);});
test('old management schema imports amount and counts and rejects ambiguous dash',()=>{const h=['년/월','물류센터','계정','매장코드','매장명','구분','구분2','값'];const result=validateUnified([h,['2026-10','A','B2C','S001','서울점','건수','건수','100'],['2026-10','A','B2C','S001','서울점','출고비','B2C 출고비','50,000']],ctx);assert.deepEqual(result.errors,[]);assert.equal(sum(result.entries),50000);assert.equal(result.entries[0].recordType,'count');assert.ok(validateUnified([h,['2026-10','A','B2C','S001','','건수','건수','-']],ctx).errors.length);});
test('new unified xlsx roundtrip and legacy workbook detection',async()=>{const wb=await buildUnifiedTemplate(ExcelJS,ctx);wb.getWorksheet('통합 입력').getRow(2).values=['2026-10','물류센터','건수','KR','A','','','','','B2C','S001','서울점','','','건','','',100,''];const read=new ExcelJS.Workbook();await read.xlsx.load(await wb.xlsx.writeBuffer());const lines=workbookLines(read);assert.deepEqual(lines[0],unifiedHeaders);const result=validateUnified(lines,ctx);assert.deepEqual(result.errors,[]);assert.equal(result.entries[0].quantity,100);const old=new ExcelJS.Workbook(),sheet=old.addWorksheet('관리표');sheet.addRow(['안내']);sheet.addRow(['년/월','물류센터','계정','매장코드','구분','구분2','값']);sheet.addRow(['2026-10','A','B2C','S001','출고비','B2C 출고비',300]);assert.equal(validateUnified(workbookLines(old),ctx).entries[0].amount,300);});

import {countVolume} from './domain.mjs';
test('center aggregate count takes precedence over detail to prevent double counting',()=>{const base={recordType:'count',center:'A',account:'B2C'};assert.equal(countVolume([{...base,quantity:100},{...base,storeId:'s1',quantity:80},{...base,account:'B2B',storeId:'s1',quantity:20}]),120);});

test('trade metadata normalizes known values and stays optional for historical rows',()=>{
 const raw={...base,domain:'trade',shipment:'EXP-1',direction:'수출',origin:'KR',destination:'VN',countryCode:'VN'};
 const record=validateRecord({...raw,incoterm:' fca ',cargoType:'air'},ctx);assert.equal(record.incoterm,'FCA');assert.equal(record.cargoType,'AIR');assert.equal(record.amount,50000);
 assert.equal(validateRecord(raw,ctx).incoterm,'');assert.equal(validateRecord({...raw,domain:'common',incoterm:'FCA',cargoType:'AIR'},ctx).cargoType,'');
 assert.throws(()=>validateRecord({...raw,incoterm:'BAD'},ctx),/인코텀즈/);assert.throws(()=>validateRecord({...raw,cargoType:'TRAIN'},ctx),/화물 타입/);
});
test('unified Excel carries incoterms/cargo and prior 19-column template remains supported',async()=>{
 const wb=await buildUnifiedTemplate(ExcelJS,ctx),sheet=wb.getWorksheet('통합 입력');
 const values=['2026-10','수출입','비용','KR','','EXP-2','수출','KR','VN','공통','S001','서울점','','포워딩','일괄',1,2000,'','', 'DAP','LCL'];
 sheet.getRow(2).values=values;const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(await wb.xlsx.writeBuffer());const result=validateUnified(workbookLines(loaded),ctx);assert.deepEqual(result.errors,[]);assert.equal(result.entries[0].incoterm,'DAP');assert.equal(result.entries[0].cargoType,'LCL');
 const prior=new ExcelJS.Workbook(),old=prior.addWorksheet('통합 입력');old.addRow(unifiedHeaders.slice(0,19));old.addRow(values.slice(0,19));const historical=validateUnified(workbookLines(prior),ctx);assert.deepEqual(historical.errors,[]);assert.equal(historical.entries[0].incoterm,'');
});

import {fingerprint} from './domain.mjs';
test('trade document references are separate, optional, bounded strings preserving leading zeros',()=>{
 const raw={...base,domain:'trade',shipment:'EXP-1',direction:'수출',origin:'KR',destination:'VN',countryCode:'VN'};
 const record=validateRecord({...raw,ciplNo:' 001-CIPL/A ',internalNo:'000045'},ctx);assert.equal(record.ciplNo,'001-CIPL/A');assert.equal(record.internalNo,'000045');assert.equal(validateRecord(raw,ctx).ciplNo,'');assert.equal(validateRecord({...raw,domain:'common',ciplNo:'X',internalNo:'Y'},ctx).internalNo,'');
 assert.notEqual(fingerprint(record),fingerprint({...record,ciplNo:'002-CIPL/A'}));assert.throws(()=>validateRecord({...raw,ciplNo:'x'.repeat(101)},ctx));assert.throws(()=>validateRecord({...raw,internalNo:'A\nB'},ctx));assert.throws(()=>validateRecord({...raw,ciplNo:123},ctx));
});
test('latest Excel carries document references and prior 21-column template remains supported',async()=>{
 const wb=await buildUnifiedTemplate(ExcelJS,ctx),sheet=wb.getWorksheet('통합 입력');assert.equal(sheet.getCell('V2').numFmt,'@');assert.equal(sheet.getCell('W2').numFmt,'@');
 const values=['2026-10','수출입','비용','KR','','EXP-3','수출','KR','VN','공통','S001','서울점','','포워딩','일괄',1,2000,'','','FCA','AIR','000012-CIPL','000034'];sheet.getRow(2).values=values;
 const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(await wb.xlsx.writeBuffer());const result=validateUnified(workbookLines(loaded),ctx);assert.deepEqual(result.errors,[]);assert.equal(result.entries[0].ciplNo,'000012-CIPL');assert.equal(result.entries[0].internalNo,'000034');
 const previous=validateUnified([unifiedHeaders.slice(0,21),values.slice(0,21)],ctx);assert.deepEqual(previous.errors,[]);assert.equal(previous.entries[0].internalNo,'');
});

import {tradeGuidance} from './domain.mjs';
test('E/F/C/D guidance responds to seller/buyer perspective and insurance obligations',()=>{
 assert.deepEqual(tradeGuidance({incoterm:'EXW',direction:'수출'}).recommended,[]);
 assert.ok(tradeGuidance({incoterm:'EXW',direction:'수입'}).recommended.includes('국제운송료'));
 assert.ok(!tradeGuidance({incoterm:'FOB',direction:'수출'}).recommended.includes('국제운송료'));
 assert.ok(tradeGuidance({incoterm:'FOB',direction:'수입'}).recommended.includes('국제운송료'));
 assert.ok(tradeGuidance({incoterm:'CIF',direction:'수출'}).recommended.includes('적하보험료'));
 assert.ok(!tradeGuidance({incoterm:'CFR',direction:'수출'}).recommended.includes('적하보험료'));
 assert.ok(tradeGuidance({incoterm:'CIP',direction:'수출'}).insurance.includes('일괄 청구'));
 assert.ok(tradeGuidance({incoterm:'DDP'}).detail.includes('수출자'));
 assert.ok(tradeGuidance({incoterm:'DPU'}).detail.includes('하역'));
 assert.equal(tradeGuidance({incoterm:'CIF',cargoType:'AIR'}).warnings.length,1);
 assert.equal(tradeGuidance({incoterm:'CIP',cargoType:'AIR'}).warnings.length,0);
 assert.equal(tradeGuidance({incoterm:'FCA',cargoType:'AIR'}).freightLabel,'항공 운송료');
});
test('trade cost groups roundtrip and are optional in prior 23-column Excel',async()=>{
 const raw={...base,domain:'trade',shipment:'EXP-1',direction:'수출',origin:'KR',destination:'VN',countryCode:'VN',chargeGroup:'국제운송료',namedPlace:' Hanoi Warehouse '};
 assert.equal(validateRecord(raw,ctx).namedPlace,'Hanoi Warehouse');assert.equal(validateRecord(raw,ctx).amount,50000);assert.throws(()=>validateRecord({...raw,chargeGroup:'알수없음'},ctx));
 const values=['2026-10','수출입','비용','KR','','EXP-3','수출','KR','VN','공통','S001','서울점','','포워딩','일괄',1,2000,'','','CIP','AIR','CIPL-1','REF-1','국제운송료','Hanoi Warehouse'];
 const wb=await buildUnifiedTemplate(ExcelJS,ctx);wb.getWorksheet('통합 입력').getRow(2).values=values;const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(await wb.xlsx.writeBuffer());const result=validateUnified(workbookLines(loaded),ctx);assert.deepEqual(result.errors,[]);assert.equal(result.entries[0].chargeGroup,'국제운송료');assert.equal(result.entries[0].namedPlace,'Hanoi Warehouse');
 const previous=validateUnified([unifiedHeaders.slice(0,23),values.slice(0,23)],ctx);assert.deepEqual(previous.errors,[]);assert.equal(previous.entries[0].chargeGroup,'');
});

import {convertForeignAmount} from './calc.mjs';
test('foreign conversion uses exact decimal rounding, explicit basis and strict validation',()=>{
 assert.equal(convertForeignAmount('100','1350'),135000);assert.equal(convertForeignAmount('1.005','100'),101);assert.equal(convertForeignAmount('10000','950','100'),95000);assert.equal(convertForeignAmount('10000','950','100.0'),95000);assert.equal(convertForeignAmount('1000000','5.5',1000),5500);assert.equal(convertForeignAmount('0','1350'),0);
 for(const args of [['100','0'],['-1','100'],['1','1',0],['1','1',10],['1.00001','100'],['1','1.0000001'],['1000000000000','2']])assert.throws(()=>convertForeignAmount(...args));
});
test('FX record stores its source while amount is always converted KRW',()=>{
 const raw={...base,domain:'trade',shipment:'EXP-FX',direction:'수출',origin:'KR',destination:'VN',countryCode:'VN',mode:'fx',currency:'USD',foreignAmount:'100.50',exchangeRate:'1350',rateBasis:1,rateDate:'2026-10-31'};
 const record=validateRecord(raw,ctx);assert.equal(record.amount,135675);assert.equal(record.foreignAmount,'100.50');assert.equal(record.quantity,null);
 assert.throws(()=>validateRecord({...raw,rateDate:'2026-02-30'},ctx));assert.throws(()=>validateRecord({...raw,rateBasis:0},ctx));assert.throws(()=>validateRecord({...raw,currency:'KRW'},ctx));assert.throws(()=>validateRecord({...raw,domain:'center'},ctx));assert.throws(()=>validateRecord({...raw,recordType:'count'},ctx));
 const krw=validateRecord({...raw,mode:'amount',amount:'1000'},ctx);assert.equal(krw.currency,'KRW');assert.equal(krw.foreignAmount,'');assert.equal(krw.amount,1000);
});
test('FX Excel source is preserved and mismatched KRW or missing currency is rejected',async()=>{
 const wb=await buildUnifiedTemplate(ExcelJS,ctx),values=['2026-10','수출입','비용','KR','','EXP-FX','수출','KR','VN','공통','S001','서울점','','포워딩','일괄','','','','','CIP','AIR','CIPL','REF','국제운송료','Hanoi','JPY','10000','950','100','2026-10-01'];wb.getWorksheet('통합 입력').getRow(2).values=values;wb.getWorksheet('통합 입력').getCell('AD2').value=new Date('2026-10-01T00:00:00Z');
 const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(await wb.xlsx.writeBuffer());const result=validateUnified(workbookLines(loaded),ctx);assert.deepEqual(result.errors,[]);assert.equal(result.entries[0].rateDate,'2026-10-01');assert.equal(result.entries[0].amount,95000);assert.equal(result.entries[0].currency,'JPY');
 values[17]='123';assert.ok(validateUnified([unifiedHeaders,values],ctx).errors.length);values[17]='';values[25]='';assert.ok(validateUnified([unifiedHeaders,values],ctx).errors.length);
 const previous=validateUnified([unifiedHeaders.slice(0,25),['2026-10','수출입','비용','KR','','EXP-OLD','수출','KR','VN','공통','S001','서울점','','포워딩','일괄','1','1000','','','CIP','AIR','','','','']],ctx);assert.deepEqual(previous.errors,[]);assert.equal(previous.entries[0].currency,'KRW');
});

import {syncRecommendedTradeRows} from './domain.mjs';
test('recommendations populate blank rows once and never discard entered or manual costs',()=>{
 const blank={category:'보관료',quantity:'',price:'',amount:'',foreignAmount:'',memo:''};const create=chargeGroup=>({...blank,category:'포워딩',chargeGroup,mode:'amount'});
 const cif=tradeGuidance({incoterm:'CIF',direction:'수출'}).recommended;
 const rows=syncRecommendedTradeRows([blank],cif,create);assert.equal(rows.length,3);assert.ok(rows.every(r=>r.autoRecommended&&r.category==='포워딩'));assert.deepEqual(syncRecommendedTradeRows(rows,cif,create),rows);
 rows.find(r=>r.chargeGroup==='국제운송료').amount='0';const manual={...create('기타·일괄 청구'),manualEntry:true};rows.push(manual);
 const fob=syncRecommendedTradeRows(rows,tradeGuidance({incoterm:'FOB',direction:'수출'}).recommended,create);assert.ok(fob.some(r=>r.chargeGroup==='국제운송료'&&r.amount==='0'));assert.ok(fob.includes(manual));assert.ok(!fob.some(r=>r.chargeGroup==='적하보험료'));
 const again=syncRecommendedTradeRows(fob,cif,create);assert.equal(again.filter(r=>r.chargeGroup==='국제운송료').length,1);assert.equal(again.filter(r=>r.chargeGroup==='적하보험료').length,1);
});
test('manual placeholder metadata is preserved and draft flags are not saved',()=>{
 const manual={category:'포워딩',storeId:'s1',quantity:'',price:'',amount:'',memo:'',manualEntry:true};const rows=syncRecommendedTradeRows([manual],['국제운송료'],chargeGroup=>({chargeGroup}));assert.equal(rows[0],manual);assert.equal(rows.length,2);
 const record=validateRecord({...base,autoRecommended:true,manualEntry:true},ctx);assert.equal('autoRecommended' in record,false);assert.equal('manualEntry' in record,false);
});

import {filterTradeRows,summarizeTradeRows} from './domain.mjs';
test('trade search matches all three identifiers, terms and cargo without including counts',()=>{
 const rows=[{domain:'trade',recordType:'cost',shipment:'EXP-1',ciplNo:'00012-CIPL',internalNo:'SCM-01',incoterm:'CIP',cargoType:'AIR'},{domain:'trade',recordType:'cost',shipment:'EXP-2',incoterm:'FOB',cargoType:'FCL'},{domain:'trade',recordType:'count',shipment:'EXP-1'},{domain:'center',recordType:'cost',shipment:'EXP-1'}];
 assert.equal(filterTradeRows(rows,{query:' cipl '}).length,1);assert.equal(filterTradeRows(rows,{query:'scm-01'})[0].shipment,'EXP-1');assert.equal(filterTradeRows(rows,{incoterm:'FOB',cargoType:'FCL'})[0].shipment,'EXP-2');assert.equal(filterTradeRows(rows,{incoterm:'CIP',cargoType:'FCL'}).length,0);assert.equal(filterTradeRows(rows).length,2);
});
test('shipment aggregation sums KRW only and keeps month, direction and route separate',()=>{
 const r={domain:'trade',recordType:'cost',month:'2026-10',shipment:'EXP-1',direction:'수출',countryCode:'KR',origin:'KR',destination:'VN',currency:'USD',foreignAmount:'100',amount:135000,ciplNo:'C1',internalNo:'I1',incoterm:'CIP',cargoType:'AIR',chargeGroup:'국제운송료'};
 const groups=summarizeTradeRows([r,{...r,currency:'KRW',amount:5000,chargeGroup:'출발지 비용',incoterm:'FCA'},{...r,month:'2026-09',amount:10000},{...r,direction:'수입',amount:20000},{...r,destination:'US',amount:30000},{...r,recordType:'count',amount:999999},{...r,domain:'center',amount:999999}]);
 assert.equal(groups.length,4);const g=groups.find(g=>g.month==='2026-10'&&g.direction==='수출'&&g.destination==='VN');assert.equal(g.amount,140000);assert.equal(g.rows.length,2);assert.deepEqual(g.currencies,['USD','KRW']);assert.deepEqual(g.incoterms,['CIP','FCA']);assert.deepEqual(g.ciplNos,['C1']);assert.equal(g.costGroups['국제운송료'],135000);
 const safe=summarizeTradeRows([{...r,chargeGroup:'__proto__'}]);assert.equal(safe[0].costGroups['__proto__'],135000);
});

import {costReviewItems,filterCostRecords} from './domain.mjs';
test('cost review flags optional trade metadata without inventing insurance omissions',()=>{
 const row={domain:'trade',recordType:'cost',incoterm:'CIF',cargoType:'FCL',ciplNo:'C1',internalNo:'I1',chargeGroup:'기타·일괄 청구',currency:'USD',foreignAmount:'100'};
 assert.deepEqual(costReviewItems(row),[{key:'rateDate',label:'환율 기준일 미지정'}]);assert.deepEqual(costReviewItems({...row,rateDate:'2026-10-01'}),[]);assert.deepEqual(costReviewItems({domain:'center'}),[]);assert.ok(!costReviewItems(row).some(item=>item.label.includes('보험')));
 const missing=costReviewItems({...row,ciplNo:'',internalNo:'',chargeGroup:'',incoterm:'',cargoType:''});assert.equal(missing.filter(item=>item.key==='references').length,2);assert.ok(missing.some(item=>item.key==='group'));
});
test('cost search combines row values, master labels and optional-info filter',()=>{
 const a={id:'a',domain:'trade',recordType:'cost',shipment:'EXP-01',ciplNo:'000012',internalNo:'SCM-01',incoterm:'CIP',cargoType:'AIR',chargeGroup:'국제운송료',currency:'USD',amount:135000},b={id:'b',domain:'trade',recordType:'cost',shipment:'EXP-02',internalNo:'SCM-02',currency:'KRW',amount:5000};
 const rows=[a,b,{id:'c',domain:'center',recordType:'cost',center:'인천',memo:'임차료'}];assert.equal(filterCostRecords(rows,{query:' 000012 '})[0],a);assert.equal(filterCostRecords(rows,{query:'scm-02',check:'references'})[0],b);assert.equal(filterCostRecords(rows,{check:'rateDate'}).length,1);assert.equal(filterCostRecords(rows,{query:'서울점'},row=>row.id==='a'?['ST0001','서울점']:[])[0],a);assert.equal(filterCostRecords(rows,{query:'없는번호'}).length,0);
});

test('container types are optional FCL equipment; prior currency template still imports',async()=>{
 const raw={...base,domain:'trade',shipment:'EXP-FCL',direction:'수출',origin:'KR',destination:'VN',countryCode:'VN',cargoType:'FCL',containerType:'hc'};
 assert.equal(validateRecord(raw,ctx).containerType,'HC');assert.equal(validateRecord({...raw,containerType:''},ctx).containerType,'');assert.throws(()=>validateRecord({...raw,containerType:'INVALID'},ctx));assert.throws(()=>validateRecord({...raw,cargoType:'AIR'},ctx));
 const values=['2026-10','수출입','비용','KR','','EXP-FCL','수출','KR','VN','공통','S001','서울점','','포워딩','일괄',1,2000,'','','CIF','FCL','','','국제운송료','','','','','','','REEFER'];const wb=await buildUnifiedTemplate(ExcelJS,ctx);wb.getWorksheet('통합 입력').getRow(2).values=values;const restored=new ExcelJS.Workbook();await restored.xlsx.load(await wb.xlsx.writeBuffer());const result=validateUnified(workbookLines(restored),ctx);assert.deepEqual(result.errors,[]);assert.equal(result.entries[0].containerType,'REEFER');const old=validateUnified([unifiedHeaders.slice(0,30),values.slice(0,30)],ctx);assert.deepEqual(old.errors,[]);assert.equal(old.entries[0].containerType,'');
});

test('two-level cost categories preserve existing keys and allow explicit parent overrides',async()=>{
 const {categoryParentOf,defaultCategoryParent,validParentCategory,countCategories}=await import('./domain.mjs');
 assert.equal(defaultCategoryParent('지급임차료'),'보관·임차비');assert.equal(defaultCategoryParent('임가공비(라벨링)'),'임가공비');assert.equal(defaultCategoryParent('포워딩'),'포워딩');assert.equal(defaultCategoryParent('해상 운송료'),'포워딩');assert.equal(defaultCategoryParent('알 수 없는 기존 항목'),'기타 비용');
 assert.equal(categoryParentOf('B2C 출고비',[{name:'B2C 출고비',parentCategory:'물류센터 비용'}]),'물류센터 비용');
 assert.equal(defaultCategoryParent(countCategories[0]),'물동량 · 건수');assert.ok(validParentCategory('수출입 비용'));for(const value of ['',null,'all',' x','a'.repeat(41)])assert.equal(validParentCategory(value),false);
});

test('count comparison retains other groups when one group has a common total',()=>{
 const records=[{recordType:'count',center:'A',account:'B2C',groupId:'g1',storeId:'',quantity:100},{recordType:'count',center:'A',account:'B2C',groupId:'g1',storeId:'s1',quantity:60},{recordType:'count',center:'A',account:'B2C',groupId:'g2',storeId:'s2',quantity:40}];
 assert.equal(countVolume(records),140);
});

test('count totals in one month never hide store details from another selected month',()=>{
 assert.equal(countVolume([{recordType:'count',month:'2026-08',center:'A',account:'B2C',quantity:100},{recordType:'count',month:'2026-10',center:'A',account:'B2C',storeId:'s1',quantity:60}]),160);
});

import {assertNoNewCostDuplicates} from './domain.mjs';
test('editing historical costs preserves saved group/country and allows inactive references only for the same record',()=>{
 const original=validateRecord(base,ctx),changed=structuredClone(ctx);changed.groups.push({id:'g2',name:'그룹2'});changed.stores[0].groupId='g2';changed.stores[0].active=false;changed.masters[0].active=false;changed.centerMasters[0].countryCode='VN';
 const edited=validateRecord({...original,mode:'calculated',memo:'정정 메모'},changed,{previous:original});
 assert.equal(edited.groupId,'g1');assert.equal(edited.countryCode,'KR');assert.equal(edited.memo,'정정 메모');
 assert.throws(()=>validateRecord(base,changed),/매장/);
 changed.stores[0].active=true;changed.masters[0].active=true;
 const added=validateRecord(base,changed);assert.equal(added.groupId,'g2');assert.equal(added.countryCode,'VN');
});
test('new identical costs are blocked across entries and edits while historical duplicates are retained',()=>{
 const a={...validateRecord(base,ctx),id:'a'},b={...a,id:'b'};
 assert.throws(()=>assertNoNewCostDuplicates([a,b],[a]),/중복/);
 assert.doesNotThrow(()=>assertNoNewCostDuplicates([a,b],[a,b]));
 assert.doesNotThrow(()=>assertNoNewCostDuplicates([a,{...b,memo:'별도 청구 전표 2'}],[a]));
 assert.throws(()=>assertNoNewCostDuplicates([a,b,{...b,id:'c'}],[a,b]),/중복/);
});
test('empty unified imports and extra populated columns fail with actionable messages',()=>{
 assert.match(validateUnified([],ctx).errors[0],/자료/);
 const row=unifiedHeaders.map(h=>({'월':'2026-10','비용유형':'물류센터','데이터유형':'비용','센터':'A','업무구분':'B2C','비용항목':'B2C 출고비','값':100}[h]??''));
 assert.match(validateUnified([unifiedHeaders,[...row,'잘못 붙인 금액']],ctx).errors[0],/추가 열/);
});

test('maximum cost import validates 2000 decimal lines exactly and rejects 2001 without partial acceptance',()=>{
 const row=i=>unifiedHeaders.map(h=>({'월':'2026-10','비용유형':'물류센터','데이터유형':'비용','센터':'A','업무구분':'B2C','비용항목':'B2C 출고비','청구단위':'BOX','수량':'1.005','단가':'100','메모':'청구 '+i}[h]??''));
 const lines=[unifiedHeaders,...Array.from({length:2000},(_,i)=>row(i))],result=validateUnified(lines,ctx);
 assert.deepEqual(result.errors,[]);assert.equal(result.entries.length,2000);assert.equal(sum(result.entries),202000);
 const over=validateUnified([...lines,row(2000)],ctx);assert.equal(over.entries.length,0);assert.match(over.errors[0],/2,000/);
});
