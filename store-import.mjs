export const storeImportHeaders=['매장코드','매장명','관리그룹','사용상태'];
export const storeMasterSignature=ctx=>JSON.stringify({stores:ctx.stores,groups:ctx.groups});
export function planStoreImport(lines,ctx,{allowNewGroups=false}={}){
 const result={entries:[],newGroups:[],errors:[],baseSignature:storeMasterSignature(ctx)};
 if(!Array.isArray(lines)||!lines.length){result.errors.push('입력 자료가 없습니다.');return result;}
 const header=lines[0].map(v=>String(v??'').trim()),indices=storeImportHeaders.map(name=>header.indexOf(name));
 if(indices.slice(0,3).some(i=>i<0)||header.some((h,i)=>h&&header.indexOf(h)!==i)){result.errors.push('첫 행에 중복 없는 매장코드·매장명·관리그룹 열이 필요합니다.');return result;}
 if(lines.length>2001){result.errors.push('한 번에 최대 2,000행까지 등록할 수 있습니다.');return result;}
 const codes=new Set(),groups=new Map();for(const g of ctx.groups){const key=g.name.toLocaleLowerCase();if(groups.has(key)){result.errors.push('같은 이름의 관리그룹이 여러 개 있습니다. 기준정보를 정리하세요.');return result;}groups.set(key,g);}
 const newGroups=new Map();
 for(let i=1;i<lines.length;i++){
  const line=lines[i];if(!line.some(v=>String(v??'').trim()))continue;
  const [rawCode,name,rawGroup,status]=indices.map(n=>n<0?'':String(line[n]??'').trim()),code=rawCode.toUpperCase(),existing=ctx.stores.find(s=>s.code.toUpperCase()===code),prefix=`${i+1}행: `;
  const fail=message=>result.errors.push(prefix+message);
  if(!/^[A-Z0-9_-]{1,20}$/.test(code)){fail('매장코드는 영문·숫자·하이픈·밑줄 1~20자입니다.');continue;}
  if(codes.has(code)){fail('파일 안에 매장코드가 중복되었습니다: '+code);continue;}codes.add(code);
  if(!name||name.length>40||name==='센터 공통'){fail('매장명은 센터 공통을 제외한 1~40자로 입력하세요.');continue;}
  if(!rawGroup||rawGroup.length>40||rawGroup==='센터 공통'){fail('관리그룹은 센터 공통을 제외한 1~40자로 입력하세요.');continue;}
  const statusKey=status.replace(/\s/g,'').toUpperCase(),states={'사용':true,'사용중':true,'Y':true,'미사용':false,'사용제외':false,'N':false};
  if(statusKey&&!Object.hasOwn(states,statusKey)){fail('사용상태는 사용 또는 사용 제외로 입력하세요.');continue;}
  const active=statusKey?states[statusKey]:(existing?.active??true),group=groups.get(rawGroup.toLocaleLowerCase());
  if(!group&&!allowNewGroups){fail('미등록 관리그룹입니다: '+rawGroup);continue;}
  if(!group&&!newGroups.has(rawGroup.toLocaleLowerCase()))newGroups.set(rawGroup.toLocaleLowerCase(),rawGroup);
  const groupName=group?.name||newGroups.get(rawGroup.toLocaleLowerCase()),operation=existing?(existing.name===name&&existing.active===active&&existing.groupId===group?.id?'변경 없음':'수정'):'신규';
  result.entries.push({row:i+1,code,name,groupName,active,existingId:existing?.id||null,operation,before:existing?{name:existing.name,groupName:ctx.groups.find(g=>g.id===existing.groupId)?.name||'미지정',active:existing.active}:null});
 }
 const finalStores=new Map(ctx.stores.map(s=>[s.code.toUpperCase(),s.name]));for(const e of result.entries)finalStores.set(e.code,e.name);
 const names=new Set();for(const name of finalStores.values()){const key=name.toLocaleLowerCase();if(names.has(key))result.errors.push('최종 매장명 중복: '+name);names.add(key);}
 if(!result.entries.length&&!result.errors.length)result.errors.push('작성된 매장 행이 없습니다.');
 result.newGroups=[...newGroups.values()];return result;
}
export function applyStoreImport(plan,ctx,makeId=()=>crypto.randomUUID()){
 if(plan.errors.length)throw Error('오류를 수정한 뒤 다시 업로드하세요.');
 if(plan.baseSignature!==storeMasterSignature(ctx))throw Error('기준정보가 변경되었습니다. 파일을 다시 업로드해 검토하세요.');
 const groups=[...ctx.groups,...plan.newGroups.map(name=>({id:makeId(),name}))],stores=ctx.stores.map(s=>({...s}));
 for(const e of plan.entries){const groupId=groups.find(g=>g.name.toLocaleLowerCase()===e.groupName.toLocaleLowerCase())?.id;if(!groupId)throw Error('관리그룹 연결을 확인하세요.');const row={id:e.existingId||makeId(),code:e.code,name:e.name,groupId,active:e.active},index=stores.findIndex(s=>s.id===e.existingId);if(index<0)stores.push(row);else stores[index]={...stores[index],...row};}
 return {...ctx,groups,stores};
}
export async function buildStoreImportTemplate(ExcelJS,ctx){
 const wb=new ExcelJS.Workbook();wb.creator='물류비 인사이트';
 const guide=wb.addWorksheet('작성 안내');guide.columns=[{width:26},{width:110}];
 for(const row of [['매장 마스터 일괄 등록','매장 마스터 입력 시트에 작성하세요. 예시는 별도 시트에 있으며 업로드하지 않습니다.'],['매장코드 (필수)','텍스트 형식. 영문·숫자·하이픈·밑줄 1~20자. 앞자리 0을 보존하며 영문은 대문자로 등록합니다. 같은 코드는 기존 매장을 수정합니다.'],['매장명 (필수)','1~40자. 최종 매장명은 중복될 수 없습니다.'],['관리그룹 (필수)','현재 등록된 그룹명. 새 그룹은 업로드 화면의 새 관리그룹 생성 옵션을 선택한 경우 미리보기 후 함께 등록합니다.'],['사용상태 (선택)','사용 또는 사용 제외. 빈 칸이면 신규 매장은 사용, 기존 매장은 이전 상태를 유지합니다.'],['검토·저장','최대 2,000행. 오류가 하나라도 있으면 전체 저장을 막습니다. 미리보기 후 일괄 저장하세요.'],['기존 자료 보존','파일에 없는 매장은 삭제하지 않습니다. 기존 매장의 ID와 과거 비용의 관리그룹은 유지됩니다.']])guide.addRow(row);
 guide.eachRow(row=>{row.height=40;row.alignment={wrapText:true,vertical:'middle'};});
 const refs=wb.addWorksheet('관리그룹 참고');refs.columns=[{header:'관리그룹',width:35}];ctx.groups.forEach(g=>refs.addRow([g.name]));
 if(ctx.groups.length)wb.definedNames.add(`'관리그룹 참고'!$A$2:$A$${ctx.groups.length+1}`,'StoreImportGroups');
 const sheet=wb.addWorksheet('매장 마스터 입력');sheet.columns=storeImportHeaders.map((header,i)=>({header,width:[24,30,30,18][i]}));sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter='A1:D1';sheet.getColumn(1).numFmt='@';
 sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF245BC4'}};
 for(let n=2;n<=2001;n++){if(ctx.groups.length)sheet.getCell(n,3).dataValidation={type:'list',allowBlank:false,formulae:['StoreImportGroups']};sheet.getCell(n,4).dataValidation={type:'list',allowBlank:true,formulae:['"사용,사용 제외"']};}
 const example=wb.addWorksheet('작성 예시');example.columns=sheet.columns.map(c=>({header:c.header,width:c.width}));example.getColumn(1).numFmt='@';example.addRow(['S200000','경영지원부문',ctx.groups[0]?.name||'본사 관리그룹','사용']);example.addRow(['0052100','GTM 1팀',ctx.groups[0]?.name||'본사 관리그룹','사용']);
 return wb;
}
export function storeWorkbookLines(wb){
 const sheet=wb.getWorksheet('매장 마스터 입력');if(!sheet)throw Error('매장 마스터 입력 시트가 없습니다. 전용 양식을 사용하세요.');
 // Validation dropdowns extend to row 2001, so styled blank rows are allowed.
 if(sheet.rowCount>2001)throw Error('최대 2,000행까지 업로드할 수 있습니다.');
 const header=Array.from({length:sheet.columnCount},(_,i)=>sheet.getCell(1,i+1).text.trim()),width=Math.max(4,header.length),codeColumn=header.indexOf('매장코드')+1;
 const lines=[];for(let n=1;n<=sheet.rowCount;n++){const row=[];for(let c=1;c<=width;c++){const cell=sheet.getCell(n,c);if(cell.formula||cell.value?.sharedFormula)throw Error(`${n}행 ${c}열: 수식 대신 값으로 입력하세요.`);if(cell.value instanceof Date)throw Error(`${n}행 ${c}열: 날짜 대신 텍스트로 입력하세요.`);if(n>1&&c===codeColumn&&typeof cell.value==='number')throw Error(`${n}행: 매장코드는 텍스트로 입력하세요. 앞자리 0이 사라질 수 있습니다.`);row.push(cell.value==null?'':cell.text);}lines.push(row);}return lines;
}
