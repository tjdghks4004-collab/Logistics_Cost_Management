export const salesBases=['상품매출','순매출','총매출'];
export const salesSignature=ctx=>JSON.stringify({sales:ctx.sales||[],stores:ctx.stores,groups:ctx.groups});
export function salesDate(value){
 const raw=String(value??'').trim(),v=/^\d{8}$/.test(raw)?raw.slice(0,4)+'-'+raw.slice(4,6)+'-'+raw.slice(6):raw.replace(/\//g,'-');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw Error('매출일자는 YYYYMMDD 또는 YYYY-MM-DD 날짜입니다.');return v;
}
function salesScaled(value){
 let s=String(value??'').trim().replace(/,/g,'');if(/^\(.*\)$/.test(s))s='-'+s.slice(1,-1);
 if(!/^[+-]?\d+(\.\d{1,6})?$/.test(s))throw Error('매출은 숫자로 입력하세요 (소수 최대 6자리).');
 const negative=s.startsWith('-');s=s.replace(/^[+-]/,'');const [whole,fraction='']=s.split('.');const n=BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));if(n>1000000000000000000n)throw Error('행별 매출은 절댓값 1조원 이하여야 합니다.');return negative?-n:n;
}
export function planSalesImport(lines,ctx,{basis='상품매출',fileName=''}={}){
 const plan={entries:[],errors:[],warnings:[],basis,fileName,baseSignature:salesSignature(ctx),sourceRows:0};
 if(!salesBases.includes(basis)){plan.errors.push('매출 기준을 선택하세요.');return plan;}
 const h=lines.findIndex((row,i)=>i<20&&['매출일자','매장코드',basis].every(key=>row.map(v=>String(v??'').trim()).includes(key)));
 if(h<0){plan.errors.push('매출일자·매장코드·'+basis+' 열이 필요합니다. 매출 기준과 파일을 확인하세요.');return plan;}
 if(lines.length-h-1>50000){plan.errors.push('한 번에 최대 50,000행을 지원합니다.');return plan;}
 const headers=lines[h].map(v=>String(v??'').trim()),idx=key=>headers.indexOf(key);
 if(['매출일자','매장코드',basis].some(key=>headers.filter(v=>v===key).length!==1)){plan.errors.push('필수 열이 중복되었습니다.');return plan;}
 const sums=new Map();
 for(let i=h+1;i<lines.length;i++){
  const row=lines[i];if(!row.some(v=>String(v??'').trim()))continue;
  try{const date=salesDate(row[idx('매출일자')]),code=String(row[idx('매장코드')]??'').trim().toUpperCase(),store=ctx.stores.find(s=>s.code.toUpperCase()===code);if(!store)throw Error('미등록 매장코드: '+(code||'(빈 값)'));
   const name=idx('매장명')<0?'':String(row[idx('매장명')]??'').trim();if(name&&name!==store.name)throw Error('매장코드와 매장명이 다릅니다: '+code+' / '+name);
   const amount=salesScaled(row[idx(basis)]),month=date.slice(0,7),key=month+'|'+store.id,existing=(ctx.sales||[]).find(r=>r.month===month&&r.storeId===store.id);
   const entry=sums.get(key)||{month,storeId:store.id,groupId:existing?.groupId??store.groupId,scaled:0n,sourceRows:0,existing};entry.scaled+=amount;entry.sourceRows++;sums.set(key,entry);plan.sourceRows++;
  }catch(error){if(plan.errors.length<100)plan.errors.push(`${i+1}행: ${error.message}`);}
 }
 for(const entry of sums.values()){
  const sign=entry.scaled<0n?-1n:1n,absolute=entry.scaled*sign,amount=Number(((absolute+500000n)/1000000n)*sign);
  if(!Number.isSafeInteger(amount)||Math.abs(amount)>1e12){plan.errors.push(entry.month+' 월 매출 합계가 허용 범위를 넘었습니다.');continue;}
  const row={month:entry.month,storeId:entry.storeId,groupId:entry.groupId,amount,sourceRows:entry.sourceRows,basis,source:'erp'};
  const existing=entry.existing;plan.entries.push({...row,id:existing?.id||null,previousAmount:existing?.amount??null,operation:existing?(existing.amount===amount&&existing.basis===basis&&existing.sourceRows===entry.sourceRows?'변경 없음':'교체'):'신규'});
 }
 if(!plan.entries.length&&!plan.errors.length)plan.errors.push('집계할 매출 자료가 없습니다.');
 if(plan.entries.some(e=>e.previousAmount!==null))plan.warnings.push('기존 월·매장 매출은 이 파일의 합계로 교체합니다. 해당 월·매장의 전체 자료를 업로드하세요.');
 plan.warnings.push('매출 원장 행은 삭제·중복 제거하지 않고 합산합니다. 동일 금액의 정상 거래를 구분할 전표번호가 없으므로 ERP에서 중복 없는 원장을 내려받으세요.');
 return plan;
}
export function applySalesImport(plan,ctx,makeId=()=>crypto.randomUUID()){
 if(plan.errors.length)throw Error('오류를 수정하고 다시 업로드하세요.');if(plan.baseSignature!==salesSignature(ctx))throw Error('매출 또는 매장 정보가 변경되었습니다. 파일을 다시 업로드하세요.');
 const sales=[...(ctx.sales||[])];for(const e of plan.entries){if(e.operation==='변경 없음')continue;const row={id:e.id||makeId(),month:e.month,storeId:e.storeId,groupId:e.groupId,amount:e.amount,sourceRows:e.sourceRows,basis:e.basis,source:'erp'};const index=sales.findIndex(s=>s.month===e.month&&s.storeId===e.storeId);if(index<0)sales.push(row);else sales[index]=row;}return {...ctx,sales};
}
export function validateSales(sales,ctx){
 if(!Array.isArray(sales)||sales.length>100000)throw Error('매출 자료 형식을 확인하세요.');const keys=new Set(),ids=new Set();
 for(const r of sales){const key=r.month+'|'+r.storeId;if(!r||typeof r.id!=='string'||!r.id||r.id.length>100||ids.has(r.id)||keys.has(key)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.month)||!ctx.stores.some(s=>s.id===r.storeId)||!ctx.groups.some(g=>g.id===r.groupId)||!Number.isSafeInteger(r.amount)||Math.abs(r.amount)>1e12||!salesBases.includes(r.basis)||r.source!=='erp'||!Number.isSafeInteger(r.sourceRows)||r.sourceRows<1||r.sourceRows>50000)throw Error('매출의 월·매장·그룹·금액·기준 또는 중복을 확인하세요.');ids.add(r.id);keys.add(key);}
}
export function salesWorkbookLines(wb,basis='상품매출'){
 for(const sheet of wb.worksheets){
  let headerRow=0;for(let n=1;n<=Math.min(20,sheet.rowCount);n++){const values=sheet.getRow(n).values.slice(1).map(v=>String(v??'').trim());if(['매출일자','매장코드',basis].every(key=>values.includes(key))){headerRow=n;break;}}
  if(!headerRow)continue;if(sheet.rowCount-headerRow>50000)throw Error('최대 50,000행을 지원합니다.');
  const width=Math.min(sheet.columnCount,200),headers=Array.from({length:width},(_,i)=>sheet.getCell(headerRow,i+1).text.trim()),needed=['매출일자','매장코드','매장명',basis].map(name=>headers.indexOf(name)+1).filter(c=>c>0),lines=[headers];
  for(let n=headerRow+1;n<=sheet.rowCount;n++){const row=Array(width).fill('');for(const c of needed){const cell=sheet.getCell(n,c);if(cell.formula||cell.value?.sharedFormula)throw Error(`${n}행: 입력 열의 수식 대신 값으로 저장하세요.`);if(headers[c-1]==='매장코드'&&typeof cell.value==='number')throw Error(`${n}행: 매장코드는 앞자리 0을 보존한 텍스트여야 합니다.`);row[c-1]=cell.value instanceof Date?cell.value.toISOString().slice(0,10):typeof cell.value==='number'?(Number.isInteger(cell.value)?String(cell.value):cell.value.toFixed(6)):cell.text;}lines.push(row);}return lines;
 }throw Error('매출일자·매장코드·'+basis+' 열이 있는 ERP 시트를 찾지 못했습니다.');
}
export async function buildSalesTemplate(ExcelJS){
 const wb=new ExcelJS.Workbook(),guide=wb.addWorksheet('작성 안내');guide.columns=[{width:24},{width:100}];
 for(const row of [['ERP 매출 업로드','ERP 원장의 매출일자·매장코드·매장명·상품매출 열을 그대로 읽습니다. 기본 금액 열은 상품매출입니다. 순매출·총매출로 변경할 수 있습니다.'],['집계 기준','월·매장별 합계. 반품 등 음수 매출을 포함하며 소수 금액은 월별 합산 후 원 단위 반올림합니다.'],['출고 건수와 구분','판매수량은 출고 건수가 아닙니다. 판매수량은 출고 KPI에 반영하지 않습니다.'],['재업로드','월·매장별 기존 금액을 교체합니다. 파일에 없는 월·매장은 유지합니다. 재업로드할 월·매장의 전체 자료를 사용하세요.'],['센터 배분 없음','매출은 센터·국가·업무에 임의 배분하지 않습니다. 이 필터를 좁히면 해당 ERP 매출을 분모로 하는 물류비율은 계산하지 않습니다.']])guide.addRow(row);
 guide.eachRow(r=>{r.height=45;r.alignment={wrapText:true,vertical:'middle'};});const sheet=wb.addWorksheet('매출 입력');sheet.columns=['매출일자','매장코드','매장명','상품매출'].map(header=>({header,width:25}));sheet.getColumn(1).numFmt='@';sheet.getColumn(2).numFmt='@';sheet.views=[{state:'frozen',ySplit:1}];return wb;
}

export function planSalesDeletion(ids,ctx){
 const selected=new Set(ids);if(!selected.size)throw Error('삭제할 매출을 선택하세요.');
 const rows=(ctx.sales||[]).filter(r=>selected.has(r.id));if(rows.length!==selected.size)throw Error('선택한 매출 자료가 변경되었거나 없습니다. 다시 조회하세요.');
 return {rows:structuredClone(rows),signature:JSON.stringify(rows)};
}
export function applySalesDeletion(plan,ctx){
 const ids=new Set(plan.rows.map(r=>r.id)),current=(ctx.sales||[]).filter(r=>ids.has(r.id));
 if(!ids.size||JSON.stringify(current)!==plan.signature)throw Error('삭제 대상이 변경되었습니다. 다시 선택해 확인하세요.');
 return {...ctx,sales:(ctx.sales||[]).filter(r=>!ids.has(r.id))};
}
