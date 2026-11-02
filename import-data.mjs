import {validateUnified} from './domain.mjs';
import {lineAmount} from './calc.mjs';
export const costHeaders=['월','센터','매장코드','매장명','비용항목','청구단위','수량','단가','메모'];
const priorStoreHeaders=['월','센터','매장코드','비용항목','청구단위','수량','단가','부가세','메모'];
const oldHeaders=['월','센터','비용항목','공급가액','부가세','메모'];
const quantityHeaders=['월','센터','비용항목','청구단위','수량','단가','부가세','메모'];
export function validateImport(lines,context){
 const unified=validateUnified(lines,context);if(unified)return unified;
 const {centers,centerMasters=[],stores,masters,units}=context;
 const header=lines[0]?.map(String).join(','),modern=header===costHeaders.join(','),legacyStore=header===priorStoreHeaders.map(v=>v==='매장코드'?'매장':v).join(','),mode=(modern||header===priorStoreHeaders.join(',')||legacyStore)?'store':header===quantityHeaders.join(',')?'quantity':header===oldHeaders.join(',')?'amount':null;
 if(!mode)return {entries:[],errors:['1행: 양식의 열 이름과 순서를 확인하세요.']};
 if(lines.length>2001)return {entries:[],errors:['한 번에 최대 2,000행까지 업로드할 수 있습니다.']};
 const entries=[],errors=[];
 for(let i=1;i<lines.length;i++){
  const row=lines[i];if(!row.some(v=>String(v??'').trim()))continue;
  try{
   if(row.length!==(mode==='store'?9:mode==='quantity'?8:6))throw Error('열 수가 양식과 다릅니다.');
   const r=row.map(v=>String(v??'').trim());let month,center,category,unit,quantity,price,amount,vat,memo,storeId='',groupId='';
   if(mode==='store'){
    const [m,c,name,...tail]=r;let rest=tail;if(modern){const [displayName,categoryValue,unitValue,qtyValue,priceValue,memoValue]=tail;rest=[categoryValue,unitValue,qtyValue,priceValue,'0',memoValue];}const store=stores.find(s=>(legacyStore?s.name===name:s.code?.toUpperCase()===name.toUpperCase())&&s.active);
    if(!store&&name!=='센터 공통')throw Error('매장코드를 기준정보에 등록하거나 사용 상태를 확인하세요.');
    storeId=store?.id||'';groupId=store?.groupId||'';
    [month,center,category,unit,quantity,price,vat,memo]=[m,c,...rest];
   }else if(mode==='quantity')[month,center,category,unit,quantity,price,vat,memo]=r;
   else [month,center,category,amount,vat,memo]=r;
   if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('월은 YYYY-MM 텍스트로 입력하세요.');
   if(!centers.includes(center))throw Error('등록된 센터명을 입력하세요.');
   if(!masters.some(m=>m.name===category&&m.active))throw Error('비용 항목을 기준정보에 등록하거나 사용 상태를 확인하세요.');
   if(mode!=='amount'){
    if(!units.includes(unit))throw Error('청구 단위를 확인하세요.');
    amount=lineAmount(quantity,price);quantity=Number(quantity);price=Number(price);
   }
   if(![amount].every(v=>/^\d+$/.test(String(v))&&Number(v)<=1e12))throw Error('공급가액은 0 이상 1조 이하의 정수로 입력하세요.');
   if(memo.length>500)throw Error('메모는 500자 이하로 입력하세요.');
   entries.push({domain:'center',recordType:'cost',account:'공통',month,center,countryCode:centerMasters.find(c=>c.name===center)?.countryCode||'',storeId,groupId,category,...(mode==='amount'?{}:{unit,quantity,price}),amount:Number(amount),memo});
  }catch(e){errors.push(`${i+1}행: ${e.message}`);}
 }
 if(!entries.length&&!errors.length)errors.push('입력된 비용이 없습니다. 빈 양식 대신 비용을 입력해 주세요.');
 return {entries,errors};
}
