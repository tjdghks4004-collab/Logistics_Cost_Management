import {lineAmount} from './calc.mjs';
export const materialKinds=['택배박스','일반 포장박스','팔레트','랩','테이프','완충재','기타'];
export const materialUnits=['EA','BOX','롤','장','개','매','KG','묶음'];
const nonempty=(v,max=100)=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=max;
export function materialDate(value){const s=String(value??'');if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s+'T00:00:00Z'))||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)throw Error('구매일·단가 적용일을 확인하세요.');return s;}
export function materialMoney(quantity,unitPrice,vatIncluded=false,vatRate=10){
 if(![0,10].includes(Number(vatRate)))throw Error('부가세율은 0% 또는 10%입니다.');
 const base=lineAmount(quantity,unitPrice),rate=Number(vatRate),amount=vatIncluded?Number((BigInt(base)*100n+BigInt(100+rate)/2n)/BigInt(100+rate)):base;
 const vat=vatIncluded?base-amount:Math.round(amount*rate/100);return {amount,vat,total:amount+vat};
}
export function validateMaterialMasters(ctx,previous=null){
 const items=ctx.materials??[],prices=ctx.materialPrices??[];
 if(!Array.isArray(items)||!Array.isArray(prices)||items.length>5000||prices.length>20000)throw Error('부자재 마스터 형식·건수 제한을 확인하세요.');
 const ids=new Set(),codes=new Set(),priceIds=new Set(),keys=new Set();
 for(const m of items){if(!m||!nonempty(m.id)||!(/^[A-Z0-9_-]{1,30}$/).test(m.code)||codes.has(m.code)||ids.has(m.id)||!materialKinds.includes(m.kind)||!nonempty(m.name)||!nonempty(m.specification,150)||typeof m.flute!=='string'||m.flute.length>30||!materialUnits.includes(m.unit)||typeof m.active!=='boolean')throw Error('부자재 코드·품명·규격·단위 또는 중복을 확인하세요.');ids.add(m.id);codes.add(m.code);}
 for(const p of prices){if(!p||!nonempty(p.id)||priceIds.has(p.id)||!ids.has(p.materialId)||!nonempty(p.supplier)||typeof p.center!=='string'||p.center&&!ctx.centerMasters.some(c=>c.name===p.center)||!materialUnits.includes(p.unit)||!Number.isSafeInteger(p.moq)||p.moq<0||p.moq>1e12||typeof p.vatIncluded!=='boolean'||![0,10].includes(p.vatRate)||typeof p.active!=='boolean')throw Error('부자재 구매 조건의 공급업체·센터·MOQ·부가세를 확인하세요.');materialDate(p.effectiveFrom);lineAmount('1',p.unitPrice);priceIds.add(p.id);const key=JSON.stringify([p.materialId,p.supplier,p.center,p.effectiveFrom]);if(p.active&&keys.has(key))throw Error('같은 품목·공급업체·입고 센터·적용일의 사용 중 단가가 중복됩니다.');if(p.active)keys.add(key);}
 if(previous){for(const old of previous.materials??[])if(!ids.has(old.id))throw Error('부자재 마스터는 삭제 대신 사용 중지하세요.');for(const old of previous.materialPrices??[]){const now=prices.find(p=>p.id===old.id);if(!now||[...new Set([...Object.keys(old),...Object.keys(now)])].some(k=>k!=='active'&&JSON.stringify(now[k])!==JSON.stringify(old[k])))throw Error('기존 단가는 덮어쓰지 않고 새 적용일로 추가하세요. 정정할 단가는 사용 중지할 수 있습니다.');}}
}
export function applicableMaterialPrices(ctx,materialId,date){materialDate(date);const map=new Map();for(const p of ctx.materialPrices??[]){if(!p.active||p.materialId!==materialId||p.effectiveFrom>date)continue;const key=JSON.stringify([p.supplier,p.center]);if(!map.has(key)||map.get(key).effectiveFrom<p.effectiveFrom)map.set(key,p);}return [...map.values()].sort((a,b)=>a.supplier.localeCompare(b.supplier,'ko')||a.center.localeCompare(b.center,'ko'));}
export function materialPriceChange(price,ctx){const prev=(ctx.materialPrices??[]).filter(p=>p.active&&p.materialId===price.materialId&&p.supplier===price.supplier&&p.center===price.center&&p.effectiveFrom<price.effectiveFrom&&p.unit===price.unit&&p.vatIncluded===price.vatIncluded&&p.vatRate===price.vatRate).sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom))[0];if(!prev||Number(prev.unitPrice)===0)return null;const saving=Number(prev.unitPrice)-Number(price.unitPrice);return {previous:Number(prev.unitPrice),saving,percent:saving/Number(prev.unitPrice)*100};}
export function buildMaterialPurchase(raw,ctx,{previous=null}={}){
 const date=materialDate(raw.purchaseDate),old=previous?.material,m=ctx.materials?.find(m=>m.id===raw.materialId),p=ctx.materialPrices?.find(p=>p.id===raw.priceId);
 if(!old&&(!m?.active||!p||p.materialId!==m.id||!applicableMaterialPrices(ctx,m.id,date).some(v=>v.id===p.id)))throw Error('품목과 구매일에 적용되는 구매 조건을 선택하세요.');
 if(old&&(raw.materialId!==old.materialId||raw.priceId!==old.priceId))throw Error('과거 구매의 품목·구매 조건은 유지하세요. 잘못된 품목은 삭제 후 다시 등록하세요.');
 const center=String(raw.center||''),countryCode=center?ctx.centerMasters.find(c=>c.name===center)?.countryCode:String(raw.countryCode||'');
 if(!countryCode||!ctx.countries.some(c=>c.code===countryCode))throw Error('입고 센터 또는 비용 국가를 선택하세요.');
 if(String(raw.memo??'').trim().length>500)throw Error('메모는 500자 이하로 입력하세요.');
 const info=old?{...old}:{materialId:m.id,code:m.code,kind:m.kind,name:m.name,specification:m.specification,flute:m.flute,unit:p.unit,priceId:p.id,supplier:p.supplier,quotedCenter:p.center,moq:p.moq,quotedPrice:String(p.unitPrice),effectiveFrom:p.effectiveFrom,vatIncluded:p.vatIncluded,vatRate:p.vatRate};
 if(date<info.effectiveFrom)throw Error('구매일이 선택한 단가의 적용 시작일보다 빠릅니다.');
 const amounts=materialMoney(raw.quantity,raw.unitPrice,info.vatIncluded,info.vatRate);if(Number(raw.quantity)<=0)throw Error('구매 수량은 0보다 커야 합니다.');
 const material={...info,purchaseDate:date,quantity:String(raw.quantity),unitPrice:String(raw.unitPrice),vatAmount:amounts.vat,totalAmount:amounts.total};
 return {id:previous?.id||crypto.randomUUID(),domain:center?'center':'common',recordType:'cost',month:date.slice(0,7),countryCode:old&&center&&previous.center===center?previous.countryCode:countryCode,center,account:'공통',storeId:'',groupId:'',category:'부자재 구매비',unit:'원',quantity:null,price:null,amount:amounts.amount,memo:String(raw.memo||'').trim(),material};
}
export function validateMaterialCosts(ctx,previous=null,{restore=false}={}){
 const old=new Map((previous?.costs??[]).map(r=>[r.id,r]));
 for(const r of ctx.costs){if(!r.material)continue;const m=r.material;
 if(!m||typeof m!=='object'||Array.isArray(m)||!['materialId','priceId','code','kind','name','specification','unit','supplier','effectiveFrom','purchaseDate','quantity','unitPrice','quotedPrice'].every(k=>nonempty(m[k],k==='specification'?150:100))||typeof m.flute!=='string'||m.flute.length>30||typeof m.quotedCenter!=='string'||m.quotedCenter.length>100||!materialUnits.includes(m.unit)||!materialKinds.includes(m.kind)||typeof m.vatIncluded!=='boolean'||!Number.isSafeInteger(m.moq)||m.moq<0)throw Error('부자재 구매의 품목·규격·단가 기록을 확인하세요.');
 materialDate(m.effectiveFrom);materialDate(m.purchaseDate);const amounts=materialMoney(m.quantity,m.unitPrice,m.vatIncluded,m.vatRate);lineAmount('1',m.quotedPrice);
 if(Number(m.quantity)<=0||r.month!==m.purchaseDate.slice(0,7)||r.category!=='부자재 구매비'||r.recordType!=='cost'||r.account!=='공통'||r.storeId||r.groupId||r.quantity!==null||r.price!==null||r.unit!=='원'||r.amount!==amounts.amount||m.vatAmount!==amounts.vat||m.totalAmount!==amounts.total||r.domain!==(r.center?'center':'common'))throw Error('부자재 구매의 수량·단가·부가세 계산과 비용 금액이 일치하지 않습니다.');
 const prior=old.get(r.id)?.material;
 if(!restore&&prior){for(const k of ['materialId','priceId','code','kind','name','specification','flute','unit','supplier','quotedCenter','moq','quotedPrice','effectiveFrom','vatIncluded','vatRate'])if(m[k]!==prior[k])throw Error('과거 구매의 품목·규격·구매 조건은 변경할 수 없습니다.');}
 if(!restore&&!prior){const expected=buildMaterialPurchase({purchaseDate:m.purchaseDate,materialId:m.materialId,priceId:m.priceId,quantity:m.quantity,unitPrice:m.unitPrice,center:r.center,countryCode:r.countryCode,memo:r.memo},ctx);if(JSON.stringify(expected.material)!==JSON.stringify(m))throw Error('품목·단가 마스터와 구매 기록이 일치하지 않습니다.');}
 }
 for(const r of previous?.costs??[])if(r.material&&ctx.costs.some(n=>n.id===r.id&&!n.material)&&!restore)throw Error('부자재 구매 정보를 일반 비용으로 제거할 수 없습니다.');
}
