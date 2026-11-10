import {validateRecord,assertNoNewCostDuplicates} from './domain.mjs';
// Keep ordinary row selection strict; pasted names can opt into a unique keyword match.
function storeNameKeyword(value,{stripNotes=false}={}){
 let name=String(value??'').normalize('NFKC').trim().replace(/^agent(?:\s*[_:·-]\s*|\s+)/i,'');
 if(stripNotes){let old;do{old=name;name=name.replace(/\([^()]*\)|\[[^\[\]]*\]/g,'');}while(old!==name);}
 return name.toLocaleLowerCase().replace(/[\s_·-]+/g,'');
}
export function resolveStoreSearch(value,stores,{existingId='',allowKeyword=false}={}){
 const q=String(value??'').trim();if(!q||['공통','센터 공통'].includes(q))return {id:'',groupId:''};
 const list=stores.filter(s=>s.active||s.id===existingId),code=list.find(s=>s.code?.toUpperCase()===q.toUpperCase()||`${s.code} · ${s.name}`===q);if(code)return code;
 const matched=list.filter(s=>s.name===q);if(matched.length===1)return matched[0];
 if(allowKeyword){
  const named=storeNameKeyword(q),core=storeNameKeyword(q,{stripNotes:true});
  if(core.length<2||!/[\p{L}\p{N}]/u.test(core))throw Error('매장명 키워드는 두 글자 이상 입력하거나 정확한 매장코드를 사용하세요.');
  // Never turn a partial store code into an inferred name match.
  const candidates=list.filter(s=>storeNameKeyword(s.name).includes(named));
  const fallback=list.filter(s=>storeNameKeyword(s.name,{stripNotes:true}).includes(core));
  const choices=candidates.length?candidates:fallback;
  if(choices.length===1)return choices[0];
  if(choices.length>1)throw Error(`매장명 “${q}”의 후보가 여러 개입니다: ${choices.slice(0,5).map(s=>s.code+' · '+s.name).join(', ')}${choices.length>5?' 외 '+(choices.length-5)+'개':''}. 정확한 매장코드를 입력하세요.`);
  throw Error(`매장명 “${q}”에 맞는 사용 중인 매장이 없습니다. 매장코드 또는 키워드를 확인하세요.`);
 }
 throw Error('매장코드 또는 매장명을 검색한 뒤 결과를 선택하세요.');
}

export function planQuickEntry(text,settings,context){
 const rows=[],entries=[],errors=[],lines=String(text??'').replace(/^\uFEFF/,'').split(/\r?\n/).filter(v=>v.trim());
 if(lines.length>2001)return {rows,entries,errors:['한 번에 최대 2,000행까지 붙여넣으세요.']};
 for(let i=0;i<lines.length;i++){const cols=lines[i].split('\t').map(v=>v.trim());if(i===0&&['매장','매장코드','매장명'].includes(cols[0])&&['금액','공급가액','건수','금액/건수'].includes(cols[1]))continue;
 try{if(cols.length!==2)throw Error('매장코드(또는 매장명)와 금액/건수 두 열을 복사하세요.');const store=resolveStoreSearch(cols[0],context.stores,{allowKeyword:true}),value=cols[1].replaceAll(',','').replace(/^₩/,'').replace(/원$/,'').trim();if(!/^\d+$/.test(value))throw Error('금액·건수는 0 이상 정수로 입력하세요.');
 const count=settings.recordType==='count',row={recordType:count?'count':'cost',account:settings.account,storeId:store.id,groupId:store.groupId||'',category:count?settings.account+' 출고 건수':settings.category,chargeGroup:settings.chargeGroup||'',unit:count?'건':'원',mode:'amount',quantity:count?value:'',price:'',amount:count?'':value,memo:'',currency:'KRW',foreignAmount:'',exchangeRate:'',rateBasis:1,rateDate:'',manualEntry:true};
 const entry=validateRecord({...settings.context,...row,domain:settings.domain,rows:undefined},context);rows.push(row);entries.push(entry);
 }catch(error){errors.push(`${i+1}행: ${error.message}`);}}
 if(rows.length>2000)errors.push('한 번에 최대 2,000행까지 붙여넣으세요.');
 if(!rows.length&&!errors.length)errors.push('엑셀에서 두 열을 복사해 붙여넣으세요.');
 if(!errors.length)try{assertNoNewCostDuplicates([...(context.costs||[]),...entries],context.costs||[]);}catch(error){errors.push(error.message);}
 return {rows,entries,errors};
}
