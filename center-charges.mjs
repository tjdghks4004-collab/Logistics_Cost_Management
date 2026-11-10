import {validateRecord,assertNoNewCostDuplicates,categoryParentOf} from './domain.mjs';
import {resolveStoreSearch} from './quick-entry.mjs';
export const centerChargeTypes={box:{label:'박스 출고비',quantity:'박스 수',unit:'BOX',mode:'calculated'},truck:{label:'용차비',quantity:'용차 횟수',unit:'건',mode:'amount'},processing:{label:'임가공비',quantity:'작업 수량',unit:'EA',mode:'calculated'}};
export function centerChargeCategories(type,account,masters){return masters.filter(m=>m.active&&(type==='box'?m.name===account+' 출고비':type==='truck'?m.name==='용차임':type==='processing'&&categoryParentOf(m.name,masters)==='임가공비')).map(m=>m.name);}
export function planCenterCharges(draft,context){
 const entries=[],errors=[];if(!centerChargeTypes[draft.type]||!['amount','calculated','reverse'].includes(draft.mode))return {entries,errors:['비용 유형·입력 방식을 확인하세요.']};
 if(!Array.isArray(draft.rows)||draft.rows.length>1000)return {entries,errors:['한 번에 최대 1,000행까지 입력하세요.']};
 const categories=centerChargeCategories(draft.type,draft.account,context.masters),category=draft.type==='processing'?draft.category:categories[0];
 if(!category||!categories.includes(category))return {entries,errors:['해당 유형의 사용 가능한 비용 항목을 기준정보에서 확인하세요.']};
 for(let i=0;i<draft.rows.length;i++){const r=draft.rows[i];if(!r||typeof r!=='object'){errors.push(`${i+1}행: 입력 형식을 확인하세요.`);continue;}if(!['quantity','price','amount','memo','storeQuery'].some(k=>String(r[k]??'').trim()))continue;
  try{if(r.storeQuery)throw Error('매장 검색 결과를 선택하세요.');entries.push(validateRecord({month:draft.month,center:draft.center,account:draft.account,domain:'center',recordType:'cost',category,unit:draft.unit,mode:draft.mode,storeId:r.storeId||'',groupId:r.groupId||'',quantity:r.quantity,price:r.price,amount:r.amount,memo:r.memo||''},context));}catch(error){errors.push(`${i+1}행: ${error.message}`);}}
 if(!entries.length&&!errors.length)errors.push('비용을 한 행 이상 입력하세요.');
 if(!errors.length)try{assertNoNewCostDuplicates([...(context.costs||[]),...entries],context.costs||[]);}catch(error){errors.push(error.message);}return {entries,errors};
}
export function parseCenterChargePaste(text,draft,context){
 const rows=[],errors=[],lines=String(text||'').replace(/^\uFEFF/,'').split(/\r?\n/).filter(s=>s.trim()),direct=draft.mode==='amount';
 if(lines.length>1001)return {rows,errors:['한 번에 최대 1,000행까지 붙여넣으세요.']};
 const clean=v=>v.replaceAll(',','').replace(/^₩/,'').replace(/(?:원|박스|회|개|건)$/,'').trim();
 for(let i=0;i<lines.length;i++){const cols=lines[i].split('\t').map(s=>s.trim());if(i===0&&['매장','매장코드','매장명'].includes(cols[0]))continue;
  try{if(cols.length!==(direct?2:3))throw Error(direct?'매장 / 총비용 두 열을 붙여넣으세요.':'매장 / 수량 / 단가(또는 총비용) 세 열을 붙여넣으세요.');const store=resolveStoreSearch(cols[0],context.stores,{allowKeyword:true});rows.push({storeId:store.id,groupId:store.groupId||'',quantity:direct?'':clean(cols[1]),price:draft.mode==='calculated'?clean(cols[2]):'',amount:direct?clean(cols[1]):draft.mode==='reverse'?clean(cols[2]):'',memo:''});}catch(error){errors.push(`${i+1}행: ${error.message}`);}}
 if(!rows.length&&!errors.length)errors.push('붙여넣을 자료를 입력하세요.');if(!errors.length)errors.push(...planCenterCharges({...draft,rows},context).errors);return {rows,errors};
}
