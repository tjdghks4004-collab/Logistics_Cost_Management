import {containerTypes,currencies,chargeGroups,incoterms,cargoTypes,unifiedHeaders} from './domain.mjs';
import {costHeaders} from './import-data.mjs';
const fullHeaders=[...costHeaders,'공급가액 (자동 계산)','관리그룹 (참고)'];
export async function buildTemplate(ExcelJS,{centers,stores,masters,units,month,countries=[],centerMasters=[]}){
 const wb=new ExcelJS.Workbook();wb.creator='물류비 인사이트';
 const guide=wb.addWorksheet('작성 안내');guide.columns=[{width:28},{width:110}];
 const instructions=[['물류비 일괄 업로드 양식','입력 완료 후 .xlsx 형식으로 저장하여 업로드하세요.'],['1. 비용 입력','비용 입력 시트의 2행부터 작성합니다. 예시 시트는 업로드하지 않습니다. 최대 2,000건 지원.'],['2. 월','2026-10처럼 YYYY-MM 텍스트로 입력합니다. 날짜 형식으로 변환하지 마세요.'],['3. 매장 · 관리그룹','매장코드는 드롭다운에서 선택합니다. 매장명은 코드로 자동 표시합니다. 관리그룹은 업로드 시 현재 기준정보에서 자동 결정됩니다.'],['4. 수량 · 단가','수량 × 단가를 원 단위 반올림하여 공급가액을 계산합니다. 소수 셋째 자리까지 지원합니다.'],['6. 자동 계산 열','D열 매장명·J열 공급가액·K열 그룹은 참고용입니다. 업로드 시 프로그램이 다시 계산하며 입력 열의 수식은 허용하지 않습니다.'],['7. 기준정보','다운로드 시점의 사용 중인 매장·비용 항목이 드롭다운에 반영됩니다. 기준정보 시트 수정으로 앱 마스터가 변경되지는 않습니다.'],['8. 중복 · 저장','업로드 검토 후 일괄 저장합니다. 같은 자료 재업로드는 중복 추가될 수 있으니 확인하세요.'],['9. 보존','기존 자료를 덮어쓰지 않고 추가합니다. 센터 공통 비용은 매장에 자동 배분하지 않습니다.']];instructions.forEach(r=>guide.addRow(r));guide.eachRow(r=>{r.height=34;r.alignment={vertical:'middle',wrapText:true};});
 const refs=wb.addWorksheet('기준정보');refs.columns=[{header:'센터',width:24},{header:'매장코드',width:26},{header:'관리그룹',width:26},{header:'비용항목',width:28},{header:'청구단위',width:18},{header:'매장명',width:26},{header:'센터 국가',width:28}];
 const ss=[{code:'센터 공통',name:'센터 공통',groupName:'미지정'},...stores.filter(s=>s.active)];
 centers.forEach((v,i)=>{refs.getCell(i+2,1).value=v;const code=centerMasters.find(c=>c.name===v)?.countryCode;refs.getCell(i+2,7).value=code?`${code} · ${countries.find(c=>c.code===code)?.name||code}`:'';});ss.forEach((s,i)=>{refs.getCell(i+2,2).value=s.code||s.name;refs.getCell(i+2,6).value=s.name;refs.getCell(i+2,3).value=s.groupName;});masters.filter(m=>m.active).forEach((m,i)=>refs.getCell(i+2,4).value=m.name);units.forEach((u,i)=>refs.getCell(i+2,5).value=u);
 for(const [name,col,count] of [['Centers','A',centers.length],['Stores','B',ss.length],['Categories','D',masters.filter(m=>m.active).length],['Units','E',units.length]])wb.definedNames.add(`'기준정보'!$${col}$2:$${col}$${Math.max(2,count+1)}`,name);
 const sheet=wb.addWorksheet('비용 입력',{views:[{state:'frozen',ySplit:1}]});sheet.columns=fullHeaders.map((header,i)=>({header,width:[16,24,25,26,26,16,16,18,35,25,27][i]}));sheet.autoFilter='A1:K501';
 for(let i=2;i<=501;i++){
  sheet.getCell(i,1).numFmt='@';
  for(const [col,name] of [[2,'Centers'],[3,'Stores'],[5,'Categories'],[6,'Units']])sheet.getCell(i,col).dataValidation={type:'list',allowBlank:true,formulae:[name],showErrorMessage:true,errorTitle:'기준정보 확인',error:'드롭다운의 값을 선택하세요.'};
  for(const col of [7,8]){sheet.getCell(i,col).numFmt='#,##0.###';sheet.getCell(i,col).dataValidation={type:'decimal',operator:'between',formulae:[0,1e12],allowBlank:true,showErrorMessage:true,error:'0 이상 1조 이하로 입력하세요.'};}
  sheet.getCell(i,10).value={formula:`IF(OR(G${i}="",H${i}=""),"",ROUND(G${i}*H${i},0))`};sheet.getCell(i,10).numFmt='#,##0';
  sheet.getCell(i,11).value={formula:`IF(C${i}="","",IFERROR(VLOOKUP(C${i},'기준정보'!$B$2:$C$${ss.length+1},2,FALSE),"미등록 매장"))`};
  sheet.getCell(i,4).value={formula:`IF(C${i}="","",IFERROR(VLOOKUP(C${i},'기준정보'!$B$2:$F$${ss.length+1},5,FALSE),"미등록 매장"))`};
  for(const col of [4,10,11])sheet.getCell(i,col).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF0F4FA'}};
 }
 const example=wb.addWorksheet('작성 예시');example.columns=fullHeaders.map(header=>({header,width:25}));example.addRow([month,centers[0],ss.at(-1).code||ss.at(-1).name,ss.at(-1).name,masters.find(m=>m.active)?.name||'항목 등록 필요','BOX',100,500,'예시: 매장별 작업비',50000,ss.at(-1).groupName]);
 for(const ws of [sheet,refs,example]){ws.getRow(1).height=30;ws.getRow(1).eachCell(c=>{c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1E3F70'}};c.font={bold:true,color:{argb:'FFFFFFFF'}};c.alignment={vertical:'middle'};});}
 wb.calcProperties.fullCalcOnLoad=true;return wb;
}
export function workbookLines(wb){
 const unified=wb.getWorksheet('통합 입력');
 if(unified){const values=unified.getRow(1).values;let width=values.length-1;while(width>0&&!unified.getCell(1,width).text.trim())width--;return readGrid(unified,1,width);}
 let legacy;
 for(const ws of wb.worksheets)for(let n=1;n<=Math.min(ws.rowCount,20);n++){const vals=ws.getRow(n).values.map(v=>String(v||'').trim());if(vals.includes('값')&&vals.includes('구분2')&&(vals.includes('년/월')||vals.includes('월'))){legacy={ws,n};break;}}
 if(legacy)return readGrid(legacy.ws,legacy.n,legacy.ws.getRow(legacy.n).cellCount);
 const sheet=wb.getWorksheet('비용 입력');if(!sheet)throw Error('비용 입력 시트가 없습니다. 제공된 엑셀 양식을 사용하세요.');
 if(sheet.rowCount>2001)throw Error('비용 입력 시트는 최대 2,000행까지 지원합니다.');
 const header=costHeaders.map((_,i)=>sheet.getCell(1,i+1).text.trim());
 const modern=header.join(',')===costHeaders.join(',');
 const lines=[header];
 for(let n=2;n<=sheet.rowCount;n++){
  const r=[];for(let c=1;c<=9;c++){const cell=sheet.getCell(n,c);if(modern&&c===4){r.push(cell.formula?'':cell.text);continue;}if(cell.formula||cell.value?.sharedFormula)throw Error(`${n}행 ${c}열: 입력 열의 수식 대신 값을 입력하세요.`);if(cell.value instanceof Date)throw Error(`${n}행: 월은 YYYY-MM 텍스트로 입력하세요.`);r.push(cell.value===null?'':cell.text);}
  lines.push(r);
 }
 return lines;
}

function readGrid(sheet,headerRow,width){
 if(sheet.rowCount-headerRow>2000)throw Error('한 번에 최대 2,000행을 지원합니다.');
 const lines=[];
 for(let n=headerRow;n<=sheet.rowCount;n++){
  const row=[];sheet.getRow(n).eachCell((cell,c)=>{if(c>width&&String(cell.value??'').trim())throw Error(`${n}행: 양식 밖의 추가 열에 값이 있습니다.`);});for(let c=1;c<=width;c++){const cell=sheet.getCell(n,c);if(n>headerRow&&sheet.getCell(headerRow,c).text.trim()==='매장코드'&&typeof cell.value==='number')throw Error(`${n}행: 매장코드는 앞자리 0을 보존한 텍스트로 입력하세요.`);if(cell.formula||cell.value?.sharedFormula)throw Error(`${n}행 ${c}열: 수식 대신 값으로 붙여넣으세요.`);if(cell.value instanceof Date)row.push(cell.value.toISOString().slice(0,sheet.getCell(headerRow,c).text.trim()==='환율기준일'?10:7));else row.push(cell.value===null?'':cell.text);}
  lines.push(row);
 }
 return lines;
}
export async function buildUnifiedTemplate(ExcelJS,ctx){
 const wb=new ExcelJS.Workbook(),guide=wb.addWorksheet('작성 안내');guide.columns=[{width:25},{width:120}];
 [['통합 자료 입력 양식','비용과 건수를 모두 입력합니다. 통합 입력 시트만 가져옵니다. 최대 2,000행·5MB.'],['비용유형','물류센터 / 수출입 / 공통. 센터는 물류센터 유형에만 필수입니다.'],['데이터유형','비용 / 건수. 건수는 물류센터 유형에서만 사용하며 단가 없이 값을 입력합니다.'],['업무구분','B2C / B2B / 공통. 출고 건수는 B2C 또는 B2B로 지정합니다.'],['금액 · 건수','값에 금액을 직접 입력하거나, 값을 비워 두고 수량·단가로 비용을 계산합니다. 건수는 값 또는 수량에 입력합니다.'],['매장 마스터','매장코드로 식별하며 매장명은 참고용입니다. 미배분은 센터 공통. 매장을 지정하면 관리그룹은 마스터 기준으로 자동 연결됩니다.'],['수출입 비용','월 열은 수출입 자료의 선적 월입니다. 수출입관리번호, 수출/수입, 선적 국가코드, 출발국·도착국을 입력합니다. 국가는 마스터에 먼저 등록하세요.'],['기존 관리엑셀','년/월,물류센터,계정,매장코드,매장명,구분,구분2,값 열도 지원합니다. 건수는 비용에 합산하지 않습니다. - 표시는 0인지 미입력인지 확인 후 숫자로 바꾸세요.'],['수출입 문서 번호','CIPL NO.와 내부 관리번호는 별도 선택 항목입니다. 문자로 입력하며 앞자리 0을 보존합니다. 각 100자 이하로 입력하세요.'],['수출입 추가 정보','인코텀즈는 EXW/FCA/CPT/CIP/DAP/DPU/DDP/FAS/FOB/CFR/CIF, 화물타입은 LCL/FCL/AIR 중 선택합니다. 미지정도 허용합니다. 비용은 자동 변경하지 않습니다.'],['외화·환율','외화 통화를 선택하면 외화금액 × 적용환율 ÷ 환율적용단위로 원화 금액을 계산합니다. 기준단위는 1/100/1000입니다. 환율 기준일은 선택 사항이며 환율은 직접 입력합니다. KRW 또는 통화 공란은 기존 원화 입력입니다.'],['컨테이너 타입','FCL만 DRY(일반)/HC(하이큐빅)/REEFER(냉장·냉동)/OT/FR/TANK/OTHER를 선택합니다. LCL/AIR는 비워 두세요. 지정 장소는 선택 사항입니다.'],['중복 · 합계','동일 행 재업로드를 차단합니다. 비용 합계는 비용 유형만 합산합니다. 원화 환산 기준이며 부가세 입력은 없습니다.']].forEach(r=>guide.addRow(r));guide.eachRow(r=>{r.alignment={wrapText:true};r.height=40;});
 const sheet=wb.addWorksheet('통합 입력',{views:[{state:'frozen',ySplit:1}]});sheet.columns=unifiedHeaders.map(header=>({header,width:header.includes('번호')?25:20}));
 const refs=wb.addWorksheet('기준정보');refs.columns=['국가코드','센터','매장코드','매장명','관리그룹','비용항목','청구단위'].map(header=>({header,width:27}));
 for(const [col,list] of [[1,ctx.countries.map(c=>c.code)],[2,ctx.centers],[3,['센터 공통',...ctx.stores.filter(s=>s.active).map(s=>s.code)]],[4,['센터 공통',...ctx.stores.filter(s=>s.active).map(s=>s.name)]],[5,ctx.groups.map(g=>g.name)],[6,ctx.masters.filter(m=>m.active).map(m=>m.name)],[7,ctx.units]])list.forEach((v,i)=>refs.getCell(i+2,col).value=v);
 const definitions=[['UCountries','A',ctx.countries.length],['UCenters','B',ctx.centers.length],['UStores','C',ctx.stores.filter(s=>s.active).length+1],['UGroups','E',ctx.groups.length],['UCats','F',ctx.masters.filter(m=>m.active).length],['UUnits','G',ctx.units.length]];
 for(const [name,col,count] of definitions)wb.definedNames.add(`'기준정보'!$${col}$2:$${col}$${Math.max(2,count+1)}`,name);
 for(let n=2;n<=501;n++){
  for(const c of [1,4,8,9,11,22,23])sheet.getCell(n,c).numFmt='@';
  sheet.getCell(n,27).numFmt='#,##0.####';sheet.getCell(n,28).numFmt='#,##0.######';sheet.getCell(n,30).numFmt='yyyy-mm-dd';
  for(const [col,formula] of [[2,'"물류센터,수출입,공통"'],[3,'"비용,건수"'],[4,'UCountries'],[5,'UCenters'],[7,'"수출,수입"'],[8,'UCountries'],[9,'UCountries'],[10,'"B2C,B2B,공통"'],[11,'UStores'],[13,'UGroups'],[14,'UCats'],[15,'UUnits'],[20,'"'+incoterms.join(',')+'"'],[21,'"'+cargoTypes.join(',')+'"'],[24,'"'+chargeGroups.join(',')+'"'],[26,'"KRW,'+currencies.join(',')+'"'],[29,'"1,100,1000"'],[31,'"'+Object.keys(containerTypes).join(',')+'"']])sheet.getCell(n,col).dataValidation={type:'list',allowBlank:true,formulae:[formula],showErrorMessage:true,error:'기준정보의 값을 선택하세요.'};
 }
 const ex=wb.addWorksheet('작성 예시');ex.columns=unifiedHeaders.map(header=>({header,width:23}));const country=ctx.countries[0].code,store=ctx.stores.find(s=>s.active),code=store?.code||'센터 공통',name=store?.name||'센터 공통';
 ex.addRow([ctx.month,'물류센터','건수',country,ctx.centers[0],'','','','','B2C',code,name,'','B2C 출고 건수','건','','',100,'건수는 금액 합산 제외']);
 ex.addRow([ctx.month,'물류센터','비용',country,ctx.centers[0],'','','','','B2C',code,name,'','B2C 출고비','BOX',100,500,'','비용 50,000원']);
 ex.addRow([ctx.month,'수출입','비용',country,'','EXP-2026-001','수출',country,country,'공통','센터 공통','','','포워딩','일괄','','','','국가와 관리번호를 실제 값으로 변경','FCA','AIR','CIPL-2026-001','SCM-2026-001','국제운송료','계약상 지정 장소','USD',100,1350,1,'2026-10-01']);
 const containerExample=ex.getRow(4).values.slice(1);containerExample[5]='EXP-2026-002';containerExample[18]='해상 FCL 하이큐빅 예시';containerExample[19]='CIF';containerExample[20]='FCL';containerExample[21]='CIPL-2026-002';containerExample[22]='SCM-2026-002';containerExample[30]='HC';ex.addRow(containerExample);
 for(const ws of [sheet,refs,ex]){ws.getRow(1).height=30;ws.getRow(1).eachCell(c=>{c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1E3F70'}};c.font={bold:true,color:{argb:'FFFFFFFF'}};});}
 return wb;
}
