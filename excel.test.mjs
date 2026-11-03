import {test} from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {buildTemplate,workbookLines} from './excel.mjs';
import {validateImport} from './import-data.mjs';
const context={centers:['인천 물류센터'],stores:[{id:'s1',code:'SHOP001',name:'서울점',groupId:'g1',groupName:'직영그룹',active:true}],masters:[{name:'작업비',active:true}],units:['BOX','PLT'],month:'2026-10'};
test('xlsx roundtrip: template dropdowns, calculated costs, groups, blank rows',async()=>{
 const wb=await buildTemplate(ExcelJS,context),s=wb.getWorksheet('비용 입력');
 assert.equal(s.getCell('C2').dataValidation.formulae[0],'Stores');assert.ok(wb.definedNames.model.find(n=>n.name==='Stores'));assert.ok(validateImport(workbookLines(wb),context).errors.length);
 s.getRow(2).values=['2026-10','인천 물류센터','SHOP001','서울점','작업비','BOX',100,500,'작업비'];
 const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(await wb.xlsx.writeBuffer());
 const result=validateImport(workbookLines(loaded),context);assert.deepEqual(result.errors,[]);assert.equal(result.entries.length,1);assert.equal(result.entries[0].amount,50000);assert.equal(result.entries[0].groupId,'g1');
 loaded.getWorksheet('비용 입력').getCell('G2').value={formula:'1+1',result:2};assert.throws(()=>workbookLines(loaded),/수식/);
});
test('invalid rows block saving, zero and decimal rounding, master status, compatibility',()=>{
 const header=['월','센터','매장','비용항목','청구단위','수량','단가','부가세','메모'];const valid=['2026-10','인천 물류센터','서울점','작업비','PLT','1.005','100','0',''];
 assert.equal(validateImport([header,valid],context).entries[0].amount,101);
 const bad=[...valid];bad[2]='없는 매장';assert.match(validateImport([header,valid,bad],context).errors[0],/^3행:/);
 assert.ok(validateImport([header,valid],{...context,masters:[{name:'작업비',active:false}]}).errors.length);
 const old=validateImport([['월','센터','비용항목','공급가액','부가세','메모'],['2026-10','인천 물류센터','작업비','1000','0','']],context);assert.equal(old.entries[0].storeId,'');assert.equal(old.entries[0].amount,1000);
});

test('code-based import links stable store and center country, supports old names',()=>{
 const header=['월','센터','매장코드','비용항목','청구단위','수량','단가','부가세','메모'];
 const ctx={...context,centerMasters:[{name:'인천 물류센터',countryCode:'KR'}]};
 const row=['2026-10','인천 물류센터','shop001','작업비','BOX','2','100','0',''];
 const result=validateImport([header,row],ctx);assert.deepEqual(result.errors,[]);assert.equal(result.entries[0].storeId,'s1');assert.equal(result.entries[0].countryCode,'KR');
 row[2]='서울점';assert.ok(validateImport([header,row],ctx).errors.length);header[2]='매장';assert.deepEqual(validateImport([header,row],ctx).errors,[]);
});

 test('new template includes name, excludes VAT, derives identity from code',async()=>{
 const wb=await buildTemplate(ExcelJS,context);const example=wb.getWorksheet('작성 예시');assert.equal(example.getCell('D1').text,'매장명');assert.equal(example.getCell('D2').text,'서울점');assert.ok(!example.getRow(1).values.includes('부가세'));
 const sheet=wb.getWorksheet('비용 입력');sheet.getRow(2).values=['2026-10','인천 물류센터','SHOP001','','작업비','BOX',2,500,''];sheet.getCell('D2').value={formula:'1+1',result:'서울점'};
 const result=validateImport(workbookLines(wb),context);assert.deepEqual(result.errors,[]);assert.equal(result.entries[0].amount,1000);assert.equal(result.entries[0].storeId,'s1');assert.ok(!('vat' in result.entries[0]));
 });

test('unified workbooks reject numeric store codes and values beyond the declared schema',async()=>{
 const {buildUnifiedTemplate}=await import('./excel.mjs');
 const ctx={...context,countries:[{code:'KR',name:'대한민국'}],centerMasters:[{name:'인천 물류센터',countryCode:'KR'}],groups:[{id:'g1',name:'직영그룹'}]};
 const wb=await buildUnifiedTemplate(ExcelJS,ctx),s=wb.getWorksheet('통합 입력');s.getCell(2,11).value=12;
 assert.throws(()=>workbookLines(wb),/매장코드.*텍스트/);s.getCell(2,11).value='0012';s.getCell(2,32).value=123;
 assert.throws(()=>workbookLines(wb),/추가 열/);
});
