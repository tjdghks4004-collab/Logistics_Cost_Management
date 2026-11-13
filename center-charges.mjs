import {validateRecord,assertNoNewCostDuplicates,categoryParentOf,fingerprint} from './domain.mjs';
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
 const rows=[],errors=[],resolutions=[],lines=String(text||'').replace(/^\uFEFF/,'').split(/\r?\n/).filter(s=>s.trim()),direct=draft.mode==='amount',swapped=draft.pasteOrder==='value-first';
 if(lines.length>1001)return {rows,resolutions,errors:['한 번에 최대 1,000행까지 붙여넣으세요.']};
 const clean=v=>v.replaceAll(',','').replace(/^₩/,'').replace(/(?:원|박스|회|개|건)$/,'').trim();
 for(let i=0;i<lines.length;i++){const cols=lines[i].split('\t').map(s=>s.trim());if(i===0&&['매장','매장코드','매장명'].includes(cols[0]))continue;
  const resolution={index:i,input:cols[0],values:cols.slice(1),storeId:'',error:''};resolutions.push(resolution);
  try{
   if(cols.length!==(direct?2:3))throw Error(direct?'매장 / 총비용 두 열을 붙여넣으세요.':'선택한 열 순서에 맞는 세 열을 붙여넣으세요.');
   if(draft.pastePending?.[i])throw Error('매장 검색 결과를 선택하세요.');const override=draft.pasteStores?.[i];let store;
   if(override&&override.input===cols[0]){store=override.common&&override.storeId===''?{id:'',groupId:''}:context.stores.find(s=>s.id===override.storeId&&s.active);if(!store)throw Error('지정한 매장이 사용 중지·삭제되었습니다. 다시 선택하세요.');resolution.manual=true;}
   else store=resolveStoreSearch(cols[0],context.stores,{allowKeyword:true});
   resolution.storeId=store.id;const quantity=direct?'':clean(cols[swapped?2:1]),value=clean(cols[direct||swapped?1:2]);
   rows.push({storeId:store.id,groupId:store.groupId||'',quantity,price:draft.mode==='calculated'?value:'',amount:direct?clean(cols[1]):draft.mode==='reverse'?value:'',memo:draft.pasteMemos?.[i]?.input===cols[0]?draft.pasteMemos[i].text:''});
  }catch(error){resolution.error=error.message;errors.push(`${i+1}행: ${error.message}`);}
 }
 if(!rows.length&&!errors.length)errors.push('붙여넣을 자료를 입력하세요.');if(!errors.length)errors.push(...planCenterCharges({...draft,rows},context).errors);return {rows,errors,resolutions};
}
// Combine pending paste with ordinary rows without mutating either draft; confirmation comes later.
export function prepareCenterChargeSave(draft,context){
 const rows=(draft.rows||[]).filter(r=>['quantity','price','amount','memo','storeQuery'].some(k=>String(r[k]??'').trim()));
 const paste=String(draft.paste||'').trim()?parseCenterChargePaste(draft.paste,draft,context):null;
 if(paste?.errors.length)return {entries:[],rows,errors:paste.errors.map(e=>'붙여넣기 '+e),paste};
 const combined=[...rows,...(paste?.rows||[])],checked=planCenterCharges({...draft,rows:combined},context);return {...checked,rows:combined,paste};
}
export function editCenterChargePasteValue(text,index,column,value){
 const lines=String(text||'').replace(/^\uFEFF/,'').split(/\r?\n/).filter(s=>s.trim());
 if(!Number.isInteger(index)||index<0||index>=lines.length||![1,2].includes(column))throw Error('수정할 붙여넣기 위치를 확인하세요.');
 const cols=lines[index].split('\t');if(column>=cols.length)throw Error('열 개수가 맞지 않습니다. 원문 또는 열 순서를 확인하세요.');cols[column]=String(value);lines[index]=cols.join('\t');return lines.join('\n');
}

export function inspectCenterChargeSheet(draft,context){
 const occupied=r=>['quantity','price','amount','memo','storeQuery'].some(k=>String(r[k]??'').trim()),paste=String(draft.paste||'').trim()?parseCenterChargePaste(draft.paste,draft,context):null;
 const rows=(draft.rows||[]).map((row,index)=>({source:'manual',index,row,occupied:occupied(row)})).filter(item=>!paste||item.occupied||item.row.explicit);
 for(const r of paste?.resolutions||[]){const swapped=draft.pasteOrder==='value-first',direct=draft.mode==='amount',clean=v=>String(v??'').replaceAll(',','').replace(/^₩/,'').replace(/(?:원|박스|회|개|건)$/,'').trim(),memo=draft.pasteMemos?.[r.index];rows.push({source:'paste',index:r.index,input:r.input,error:r.error,occupied:true,row:{storeId:r.storeId||'',storeQuery:draft.pastePending?.[r.index]||'',quantity:direct?'':clean(r.values[swapped?1:0]),price:draft.mode==='calculated'?clean(r.values[swapped?0:1]):'',amount:direct?clean(r.values[0]):draft.mode==='reverse'?clean(r.values[swapped?0:1]):'',memo:memo?.input===r.input?memo.text:''}});}
 let valid=0,total=0;const seen=new Set(),known=new Set((context.costs||[]).map(fingerprint));for(const item of rows){if(!item.occupied)continue;if(!item.error){const result=planCenterCharges({...draft,rows:[item.row]},{...context,costs:[]});item.error=result.errors[0]||'';if(!item.error){const key=fingerprint(result.entries[0]);if(known.has(key))item.error='이미 저장된 같은 내역이 있습니다.';else if(seen.has(key))item.error='입력 표에 같은 내역이 중복됩니다.';else{seen.add(key);valid++;total+=result.entries[0].amount;}}}}
 return {rows,paste,total,progress:{total:rows.filter(r=>r.occupied).length,valid,invalid:rows.filter(r=>r.occupied&&r.error).length}};
}
export function removeCenterChargePasteRow(draft,index){
 const lines=String(draft.paste||'').replace(/^\uFEFF/,'').split(/\r?\n/).filter(s=>s.trim());if(!Number.isInteger(index)||index<0||index>=lines.length)throw Error('삭제할 행을 확인하세요.');lines.splice(index,1);const result={...draft,paste:lines.join('\n')};
 for(const key of ['pasteStores','pastePending','pasteMemos'])result[key]=Object.fromEntries(Object.entries(draft[key]||{}).filter(([i])=>Number(i)!==index).map(([i,v])=>[Number(i)>index?Number(i)-1:Number(i),v]));return result;
}
