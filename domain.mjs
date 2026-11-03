import {preferScopeTotals,lineAmount,convertForeignAmount} from './calc.mjs';
export const incoterms=['EXW','FCA','CPT','CIP','DAP','DPU','DDP','FAS','FOB','CFR','CIF'];
export const cargoTypes=['LCL','FCL','AIR'];
export const containerTypes={DRY:'일반 (DRY)',HC:'하이큐빅 (HC)',REEFER:'냉장·냉동 (REEFER)',OT:'오픈톱 (OT)',FR:'플랫랙 (FR)',TANK:'탱크 (TANK)',OTHER:'기타'};
export const legacyUnifiedHeaders=['월','비용유형','데이터유형','국가코드','센터','수출입관리번호','수출입구분','출발국','도착국','업무구분','매장코드','매장명','관리그룹','비용항목','청구단위','수량','단가','값','메모'];
export const tradeMetadataHeaders=[...legacyUnifiedHeaders,'인코텀즈','화물타입'];
export const documentHeaders=[...tradeMetadataHeaders,'CIPL NO.','내부 관리번호'];
export const chargeGroups=['국제운송료','출발지 비용','도착지 비용','적하보험료','기타·일괄 청구'];
export const groupedHeaders=[...documentHeaders,'비용그룹','지정장소'];
export const currencies=['USD','EUR','JPY','CNY','VND','HKD','SGD','GBP','AUD','CAD','THB','INR','IDR','MYR','PHP','TWD','AED'];
export const currencyHeaders=[...groupedHeaders,'통화','외화금액','적용환율','환율적용단위','환율기준일'];
export const unifiedHeaders=[...currencyHeaders,'컨테이너타입'];
export const domainLabels={center:'물류센터',trade:'수출입',common:'공통'};
export const countCategories=['B2C 출고 건수','B2B 출고 건수'];
export function validateRecord(raw,ctx,{previous=null}={}){
 const r={...raw},fail=s=>{throw Error(s);};
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.month))fail('월은 YYYY-MM로 입력하세요.');
 if(!['center','trade','common'].includes(r.domain))fail('비용유형을 확인하세요.');
 if(!['cost','count'].includes(r.recordType))fail('데이터유형을 확인하세요.');
 if(r.mode==='fx'&&(r.domain!=='trade'||r.recordType!=='cost'))fail('외화 입력은 수출입 비용에서 사용하세요.');
 if(!['B2C','B2B','공통'].includes(r.account))fail('업무구분은 B2C/B2B/공통입니다.');
 const center=ctx.centerMasters.find(c=>c.name===r.center),sameStore=previous&&previous.storeId===r.storeId;
 if(r.domain==='center'){if(!center)fail('등록된 물류센터를 선택하세요.');r.countryCode=previous?.domain==='center'&&previous.center===r.center&&previous.countryCode?previous.countryCode:center.countryCode;}
 else {r.center='';if(!ctx.countries.some(c=>c.code===r.countryCode))fail('등록된 국가를 선택하세요.');}
 if(r.domain==='trade'){
  for(const [field,label] of [['ciplNo','CIPL NO.'],['internalNo','내부 관리번호'],['namedPlace','지정 장소·항구']]){
   if(r[field]!=null&&typeof r[field]!=='string')fail(`${label}는 문자로 입력하세요.`);
   r[field]=(r[field]??'').trim();
   if(r[field].length>100||/[\u0000-\u001f\u007f]/.test(r[field]))fail(`${label}는 제어문자 없이 100자 이하로 입력하세요.`);
  }
  r.chargeGroup=String(r.chargeGroup??'').trim();if(r.chargeGroup&&!chargeGroups.includes(r.chargeGroup))fail('비용 그룹을 확인하세요.');
  r.incoterm=String(r.incoterm??'').trim().toUpperCase();r.cargoType=String(r.cargoType??'').trim().toUpperCase();
  if(r.incoterm&&!incoterms.includes(r.incoterm))fail('인코텀즈를 확인하세요.');
  if(r.cargoType&&!cargoTypes.includes(r.cargoType))fail('화물 타입은 LCL, FCL, AIR 중 선택하세요.');
  r.containerType=String(r.containerType??'').trim().toUpperCase();
  if(r.containerType&&!Object.hasOwn(containerTypes,r.containerType))fail('컨테이너 타입을 확인하세요.');
  if(r.containerType&&r.cargoType!=='FCL')fail('컨테이너 타입은 FCL 화물에 입력하세요.');
  if(!r.shipment?.trim()||!['수출','수입'].includes(r.direction))fail('수출입관리번호와 수출/수입 구분이 필요합니다.');
  if(![r.origin,r.destination].every(code=>ctx.countries.some(c=>c.code===code)))fail('출발국과 도착국을 기준정보에 등록하세요.');
 }else {r.shipment='';r.direction='';r.origin='';r.destination='';r.incoterm='';r.cargoType='';r.ciplNo='';r.internalNo='';r.chargeGroup='';r.namedPlace='';r.containerType='';}
 if(r.domain==='trade'&&r.chargeGroup&&!categoryChargeGroups(r.category,ctx.masters).includes(r.chargeGroup)&&!(previous?.category===r.category&&previous?.chargeGroup===r.chargeGroup))fail('선택한 비용 항목에서 사용할 수 없는 비용 그룹입니다. 기준정보 또는 그룹을 확인하세요.');
 if(r.recordType==='count'&&r.domain!=='center')fail('출고 건수는 물류센터에서 입력하세요.');
 if(r.storeId){const s=ctx.stores.find(s=>s.id===r.storeId&&(s.active||sameStore));if(!s)fail('등록된 사용 중 매장을 선택하세요.');r.groupId=sameStore?previous.groupId:s.groupId;}
 else {r.storeId='';r.groupId=r.groupId||'';if(r.groupId&&!ctx.groups.some(g=>g.id===r.groupId))fail('관리그룹을 확인하세요.');}
 if(r.recordType==='count'){
  if(!['B2C','B2B'].includes(r.account))fail('출고 건수는 B2C 또는 B2B를 선택하세요.');
  r.category=r.account+' 출고 건수';r.unit='건';r.price=null;
  if(!/^\d+$/.test(String(r.quantity))||Number(r.quantity)>1e12)fail('건수는 0 이상 1조 이하 정수로 입력하세요.');
  r.quantity=Number(r.quantity);r.amount=0;
 }else {
  if(!ctx.masters.some(m=>m.name===r.category&&(m.active||previous?.category===r.category)))fail('사용 중인 비용항목을 선택하세요.');
  if(r.mode==='fx'){
   if(r.domain!=='trade')fail('외화 입력은 수출입 비용에서 사용하세요.');
   if(!currencies.includes(r.currency))fail('외화 통화를 선택하세요.');
   r.foreignAmount=String(r.foreignAmount??'').trim();r.exchangeRate=String(r.exchangeRate??'').trim();r.rateBasis=Number(r.rateBasis??1);
   r.amount=convertForeignAmount(r.foreignAmount,r.exchangeRate,r.rateBasis);
   r.rateDate=String(r.rateDate||'');
   if(r.rateDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(r.rateDate)||!Number.isFinite(Date.parse(r.rateDate+'T00:00:00Z'))||new Date(r.rateDate+'T00:00:00Z').toISOString().slice(0,10)!==r.rateDate))fail('환율 기준일을 확인하세요.');
   r.quantity=null;r.price=null;r.unit='원';
  }else if(r.mode==='amount'){
   if(!/^\d+$/.test(String(r.amount))||Number(r.amount)>1e12)fail('값은 0 이상 1조 이하 정수로 입력하세요.');
   r.amount=Number(r.amount);r.quantity=null;r.price=null;r.unit='원';
  }else {
   if(!ctx.units.includes(r.unit))fail('청구 단위를 확인하세요.');
   r.amount=lineAmount(r.quantity,r.price);r.quantity=Number(r.quantity);r.price=Number(r.price);
  }
 }
 if(r.mode!=='fx'){r.currency='KRW';r.foreignAmount='';r.exchangeRate='';r.rateBasis=1;r.rateDate='';}
 r.memo=String(r.memo||'').trim();if(r.memo.length>500)fail('메모는 500자 이하입니다.');
 delete r.mode;delete r.autoRecommended;delete r.manualEntry;return r;
}
export function fingerprint(r){return JSON.stringify(['month','domain','recordType','countryCode','center','shipment','direction','origin','destination','account','storeId','groupId','category','unit','quantity','price','amount','memo','incoterm','cargoType','ciplNo','internalNo','chargeGroup','namedPlace','currency','foreignAmount','exchangeRate','rateBasis','rateDate','containerType','material'].map(k=>k==='currency'?(r[k]||'KRW'):k==='rateBasis'?(r[k]||1):r[k]??''));}
export function validateUnified(lines,ctx){
 if(lines.length>2001)return {entries:[],errors:['한 번에 2,000행 이하로 업로드하세요.']};
 if(!Array.isArray(lines[0]))return {entries:[],errors:['입력된 자료가 없습니다. 양식에 자료를 작성하세요.']};
 const headers=lines[0].map(v=>String(v).trim()),isUnified=[unifiedHeaders.join(','),currencyHeaders.join(','),groupedHeaders.join(','),documentHeaders.join(','),tradeMetadataHeaders.join(','),legacyUnifiedHeaders.join(',')].includes(headers.join(',')),legacy=headers.includes('값')&&headers.includes('구분2')&&(headers.includes('년/월')||headers.includes('월'));
 if(!isUnified&&!legacy)return null;
 const entries=[],errors=[];
 for(let i=1;i<lines.length;i++){
  if(!lines[i].some(v=>String(v??'').trim()))continue;
  try{
   if(lines[i].slice(headers.length).some(v=>String(v??'').trim()))throw Error('양식 밖의 추가 열에 값이 있습니다. 열 위치를 확인하세요.');
   const d=Object.fromEntries(headers.map((h,j)=>[h,String(lines[i][j]??'').trim()]));
   const storeCode=d.매장코드||d.매장||'',store=ctx.stores.find(s=>s.code?.toUpperCase()===storeCode.toUpperCase()&&s.active);
   if(storeCode&&!['센터 공통','공통'].includes(storeCode)&&!store)throw Error('매장코드를 마스터에 먼저 등록하세요.');
   const count=legacy?['건수','건/수'].includes(d.구분2)||['건수','건/수'].includes(d.구분):d.데이터유형==='건수';
   if(!legacy&&!['비용','건수'].includes(d.데이터유형))throw Error('데이터유형은 비용 또는 건수입니다.');
   const category=d.비용항목||d.구분2,domain=legacy?'center':Object.keys(domainLabels).find(k=>domainLabels[k]===d.비용유형);
   const value=d.값?.replaceAll(',','');if(value==='-')throw Error('값의 - 표시는 0인지 미입력인지 확인 후 숫자로 바꾸세요.');
   const account=d.업무구분||d.계정||'공통';
   const group=ctx.groups.find(g=>g.name===d.관리그룹);
   if(!store&&d.관리그룹&&!group)throw Error('관리그룹을 기준정보에 등록하세요.');
   const raw={month:d.월||d['년/월'],domain,recordType:count?'count':'cost',countryCode:d.국가코드,center:d.센터||d.물류센터,shipment:d.수출입관리번호,direction:d.수출입구분,incoterm:d.인코텀즈,cargoType:d.화물타입,containerType:d.컨테이너타입,ciplNo:d['CIPL NO.'],internalNo:d['내부 관리번호'],chargeGroup:d.비용그룹,namedPlace:d.지정장소,currency:d.통화,foreignAmount:d.외화금액,exchangeRate:d.적용환율,rateBasis:d.환율적용단위||1,rateDate:d.환율기준일,origin:d.출발국,destination:d.도착국,account,storeId:store?.id||'',groupId:group?.id||'',category,unit:d.청구단위,quantity:count?(value||d.수량):d.수량,price:d.단가,amount:value,mode:d.통화&&d.통화!=='KRW'?'fx':legacy||(value!==undefined&&value!=='')?'amount':'calculated',memo:d.메모};
   if((d.외화금액||d.적용환율)&&(!d.통화||d.통화==='KRW'))throw Error('외화 금액·환율을 사용하려면 외화 통화를 선택하세요.');
   const record=validateRecord(raw,ctx);if(raw.mode==='fx'&&value!==undefined&&value!==''&&(!/^\d+$/.test(value)||Number(value)!==record.amount))throw Error('값 열의 원화 금액과 외화 환산 결과가 다릅니다.');
   entries.push(record);
  }catch(e){errors.push(`${i+1}행: ${e.message}`);}
 }
 if(!entries.length&&!errors.length)errors.push('입력된 자료가 없습니다.');
 return {entries,errors};
}
export function costDrivers(currentCost,previousCost,currentCount,previousCount){
 if(!(previousCount>0&&currentCount>0))return null;
 const oldRate=previousCost/previousCount,newRate=currentCost/currentCount;
 return {oldRate,newRate,volumeEffect:(currentCount-previousCount)*oldRate,rateEffect:currentCount*(newRate-oldRate),difference:currentCost-previousCost};
}

export function countVolume(rows){
 const groups=new Map();for(const r of rows.filter(r=>r.recordType==='count')){const key=JSON.stringify([r.month||'',r.center,r.account]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
 let total=0;for(const rr of groups.values()){total+=preferScopeTotals(rr,true).reduce((n,r)=>n+Number(r.quantity),0);}return total;
}

export function tradeGuidance({incoterm='',cargoType='',direction='수출'}={}){
 const group=incoterms.includes(incoterm)?incoterm[0]:'';
 const exporter=direction==='수출';
 const notes={E:'EXW는 수출자의 상품 준비·포장 외 운송비를 통상 수입자가 부담합니다. 상차·수출통관의 별도 약정을 확인하세요.',F:'F 조건은 수출자가 약정 인도 지점까지, 주운송은 통상 수입자가 부담합니다.',C:'C 조건은 수출자가 지정 목적지까지 주운송을 계약·지급합니다. 위험은 그보다 앞선 인도 시점에 이전됩니다.',D:'D 조건은 수출자가 지정 목적지까지 운송을 부담합니다. 통관·하역 부담은 세부 조건마다 다릅니다.'};
 let recommended=[];
 if(group){
  if(exporter){if(group==='F')recommended=['출발지 비용'];if(group==='C')recommended=['출발지 비용','국제운송료'];if(group==='D')recommended=['출발지 비용','국제운송료','도착지 비용'];if(['CIF','CIP'].includes(incoterm))recommended.push('적하보험료');}
  else {if(group==='E')recommended=['출발지 비용','국제운송료','도착지 비용'];if(group==='F')recommended=['국제운송료','도착지 비용'];if(group==='C'||(group==='D'&&incoterm!=='DDP'))recommended=['도착지 비용'];}
 }
 const warnings=[];if(cargoType==='AIR'&&['FAS','FOB','CFR','CIF'].includes(incoterm))warnings.push(`${incoterm}는 해상·내수로 운송용입니다. 항공 화물의 조건은 FCA/CPT/CIP 등 계약서를 확인하세요. 입력은 차단하지 않습니다.`);
 let detail='';if(incoterm==='DAP')detail='DAP: 목적지 하역과 수입통관·관세는 통상 수입자 부담입니다.';if(incoterm==='DPU')detail='DPU: 목적지 하역까지 수출자가 부담하지만 수입통관·관세는 통상 수입자 부담입니다.';if(incoterm==='DDP')detail='DDP: 수입통관·관세도 통상 수출자 부담입니다. 목적지 하역 및 현지 규정·계약을 확인하세요.';
 const insurance=['CIF','CIP'].includes(incoterm)?`${incoterm}: 수출자의 보험 부보 의무가 있는 조건입니다. ${exporter?'보험을 별도 가입했는지, 포워더 일괄 청구에 포함됐는지 확인하세요.':'수출자 제공 보험과 자체 추가 가입 보험을 구분하세요.'} 별도 행이 없다는 이유로 보험 누락으로 판단하지 않습니다.`:'';
 return {group,role:exporter?'수출자 관점':'수입자 관점',summary:notes[group]||'인코텀즈를 선택하면 비용 입력 안내와 권장 비용 그룹이 표시됩니다.',recommended,detail,insurance,warnings,freightLabel:cargoType==='AIR'?'항공 운송료':['LCL','FCL'].includes(cargoType)?'해상 운송료':'국제운송료',cargoHint:({AIR:'AIR: 운송료는 실제 청구 중량(KG) 또는 청구서 합계로 입력하세요.',LCL:'LCL: 부피(CBM)·중량 등 실제 청구 기준을 확인하세요.',FCL:'FCL: 컨테이너별 또는 청구서 합계로 입력할 수 있습니다.'})[cargoType]||'화물 타입을 선택하면 청구 기준 안내가 바뀝니다.'};
}

// Reconcile draft placeholders only. User-touched rows are never removed.
export function syncRecommendedTradeRows(rows,recommended,createRow){
 const needed=[...new Set(recommended)];
 const entered=row=>[row.quantity,row.price,row.amount,row.foreignAmount,row.exchangeRate,row.rateDate,row.memo].some(v=>v!=null&&String(v).trim()!=='');
 let kept=rows.filter(row=>!(row.autoRecommended&&!row.manualEntry&&!entered(row)&&!needed.includes(row.chargeGroup)));
 const missing=needed.filter(group=>!kept.some(row=>row.chargeGroup===group));
 if(missing.length&&kept.length===1){const r=kept[0];if(!r.manualEntry&&!r.autoRecommended&&!r.chargeGroup&&!entered(r)&&!r.storeId&&!r.groupId)kept=[];}
 for(const group of missing)kept.push({...createRow(group),autoRecommended:true});
 return kept;
}

export function filterTradeRows(rows,{query='',incoterm='all',cargoType='all'}={}){
 const q=query.trim().toLocaleLowerCase();
 return rows.filter(r=>r.domain==='trade'&&r.recordType!=='count'&&(incoterm==='all'||r.incoterm===incoterm)&&(cargoType==='all'||r.cargoType===cargoType)&&(!q||[r.shipment,r.ciplNo,r.internalNo].some(v=>String(v||'').toLocaleLowerCase().includes(q))));
}
export function summarizeTradeRows(rows){
 const map=new Map();for(const r of rows){if(r.domain!=='trade'||r.recordType==='count')continue;
  const key=JSON.stringify([r.month,r.shipment||'',r.direction||'',r.countryCode||'',r.origin||'',r.destination||'']);
  if(!map.has(key))map.set(key,{key,month:r.month,shipment:r.shipment||'',direction:r.direction||'',countryCode:r.countryCode||'',origin:r.origin||'',destination:r.destination||'',amount:0,rows:[],ciplNos:[],internalNos:[],incoterms:[],cargoTypes:[],containerTypes:[],currencies:[],costGroups:Object.create(null)});
  const group=map.get(key);group.amount+=Number(r.amount);group.rows.push(r);
  for(const [field,value] of [['ciplNos',r.ciplNo],['internalNos',r.internalNo],['incoterms',r.incoterm],['cargoTypes',r.cargoType],['containerTypes',r.containerType],['currencies',r.currency||'KRW']])if(value&&!group[field].includes(value))group[field].push(value);
  const category=r.chargeGroup||r.category||'미분류';group.costGroups[category]=(group.costGroups[category]||0)+Number(r.amount);
 }
 return [...map.values()].sort((a,b)=>b.month.localeCompare(a.month)||b.amount-a.amount||a.shipment.localeCompare(b.shipment));
}

export function costReviewItems(row){
 if(row.domain!=='trade'||row.recordType==='count')return [];
 const items=[];
 if(!row.incoterm)items.push({key:'terms',label:'인코텀즈 미지정'});
 if(!row.cargoType)items.push({key:'terms',label:'화물 타입 미지정'});
 if(!row.ciplNo)items.push({key:'references',label:'CIPL NO. 미입력'});
 if(!row.internalNo)items.push({key:'references',label:'내부 관리번호 미입력'});
 if(!row.chargeGroup)items.push({key:'group',label:'비용 그룹 미분류'});
 if(row.currency&&row.currency!=='KRW'&&!row.rateDate)items.push({key:'rateDate',label:'환율 기준일 미지정'});
 return items;
}
export function filterCostRecords(rows,{query='',check='all'}={},displayText=()=>[]){
 const q=query.trim().toLocaleLowerCase();
 return rows.filter(row=>(check==='all'||costReviewItems(row).some(item=>item.key===check))&&(!q||[row.month,row.center,row.countryCode,row.account,row.category,row.chargeGroup,row.shipment,row.ciplNo,row.internalNo,row.incoterm,row.cargoType,row.containerType,row.currency,row.memo,row.material?.code,row.material?.name,row.material?.specification,row.material?.supplier,...displayText(row)].some(value=>String(value??'').toLocaleLowerCase().includes(q))));
}

// A category remains the stable import/record key; its parent is master metadata.
export function defaultCategoryParent(name){
 if(countCategories.includes(name)||name==='건수')return '물동량 · 건수';
 if(/임가공|라벨|세트포장/.test(name))return '임가공비';
 if(/보관|임차/.test(name))return '보관·임차비';
 if(/출고|입고/.test(name))return '입출고비';
 if(/포워딩|보험|해상|항공/.test(name))return '포워딩';
 if(/특송|용차|운송/.test(name))return '운송·배송비';
 if(/관세/.test(name))return '관세';
 return '기타 비용';
}
export function categoryParentOf(name,masters){return masters.find(m=>m.name===name)?.parentCategory||defaultCategoryParent(name);}
export function validParentCategory(value){return typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=40&&value!=='all';}

// Existing historical duplicates may be retained or removed; new duplicates cannot be added.
export function assertNoNewCostDuplicates(costs,previous=[]){
 const old=new Map(),seen=new Map();for(const r of previous){const key=fingerprint(r);old.set(key,(old.get(key)||0)+1);}
 for(let i=0;i<costs.length;i++){const key=fingerprint(costs[i]),count=(seen.get(key)||0)+1;seen.set(key,count);if(count>Math.max(1,old.get(key)||0))throw Error(`${i+1}번째 비용·건수 내역이 중복됩니다. 실제 다른 청구라면 문서번호 또는 메모로 구분하세요.`);}
}

export function categoryChargeGroups(category,masters){
 const master=masters.find(m=>m.name===category);if(Array.isArray(master?.allowedChargeGroups))return master.allowedChargeGroups;
 const parent=categoryParentOf(category,masters);if(parent==='포워딩')return [...chargeGroups];
 if(parent==='관세')return ['출발지 비용','도착지 비용'];
 if(parent==='임가공비')return ['출발지 비용','도착지 비용','기타·일괄 청구'];
 return ['기타·일괄 청구'];
}
export function validChargeGroupMapping(value){return Array.isArray(value)&&new Set(value).size===value.length&&value.every(v=>chargeGroups.includes(v));}
