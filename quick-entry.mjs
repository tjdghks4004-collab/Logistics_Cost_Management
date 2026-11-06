import {validateRecord,assertNoNewCostDuplicates} from './domain.mjs';
export function resolveStoreSearch(value,stores,{existingId=''}={}){
 const q=String(value??'').trim();if(!q||['공통','센터 공통'].includes(q))return {id:'',groupId:''};
 const list=stores.filter(s=>s.active||s.id===existingId),code=list.find(s=>s.code?.toUpperCase()===q.toUpperCase()||`${s.code} · ${s.name}`===q);if(code)return code;
 const matched=list.filter(s=>s.name===q);if(matched.length===1)return matched[0];throw Error('매장코드 또는 매장명을 검색한 뒤 결과를 선택하세요.');
}
export function planQuickEntry(text,settings,context){
 const rows=[],entries=[],errors=[],lines=String(text??'').replace(/^\uFEFF/,'').split(/\r?\n/).filter(v=>v.trim());
 if(lines.length>2001)return {rows,entries,errors:['한 번에 최대 2,000행까지 붙여넣으세요.']};
 for(let i=0;i<lines.length;i++){const cols=lines[i].split('\t').map(v=>v.trim());if(i===0&&['매장','매장코드','매장명'].includes(cols[0])&&['금액','공급가액','건수','금액/건수'].includes(cols[1]))continue;
 try{if(cols.length!==2)throw Error('매장코드(또는 매장명)와 금액/건수 두 열을 복사하세요.');const store=resolveStoreSearch(cols[0],context.stores),value=cols[1].replaceAll(',','').replace(/^₩/,'').replace(/원$/,'').trim();if(!/^\d+$/.test(value))throw Error('금액·건수는 0 이상 정수로 입력하세요.');
 const count=settings.recordType==='count',row={recordType:count?'count':'cost',account:settings.account,storeId:store.id,groupId:store.groupId||'',category:count?settings.account+' 출고 건수':settings.category,chargeGroup:settings.chargeGroup||'',unit:count?'건':'원',mode:'amount',quantity:count?value:'',price:'',amount:count?'':value,memo:'',currency:'KRW',foreignAmount:'',exchangeRate:'',rateBasis:1,rateDate:'',manualEntry:true};
 const entry=validateRecord({...settings.context,...row,domain:settings.domain,rows:undefined},context);rows.push(row);entries.push(entry);
 }catch(error){errors.push(`${i+1}행: ${error.message}`);}}
 if(rows.length>2000)errors.push('한 번에 최대 2,000행까지 붙여넣으세요.');
 if(!rows.length&&!errors.length)errors.push('엑셀에서 두 열을 복사해 붙여넣으세요.');
 if(!errors.length)try{assertNoNewCostDuplicates([...(context.costs||[]),...entries],context.costs||[]);}catch(error){errors.push(error.message);}
 return {rows,entries,errors};
}
