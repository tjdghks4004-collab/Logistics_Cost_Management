import {unifiedHeaders,domainLabels} from './domain.mjs';
import {buildUnifiedTemplate} from './excel.mjs';
export const costTabLabels={all:'전체 내역',center:'물류센터 비용·건수',trade:'수출입 비용',common:'공통 비용'};
export const costTabHeaders={
 center:['월','데이터유형','센터','업무구분','매장코드','매장명','관리그룹','비용항목','청구단위','수량','단가','값','메모'],
 trade:unifiedHeaders.filter(h=>!['비용유형','데이터유형','센터'].includes(h)),
 common:['월','국가코드','업무구분','매장코드','매장명','관리그룹','비용항목','청구단위','수량','단가','값','메모']
};
export function normalizeCostTabLines(lines,tab='all'){
 if(!Object.hasOwn(costTabLabels,tab))throw Error('비용 탭을 확인하세요.');
 const header=(lines[0]||[]).map(v=>String(v??'').trim());
 const type=Object.keys(costTabHeaders).find(key=>costTabHeaders[key].join(',')===header.join(','));
 if(!type)return lines;
 if(tab!=='all'&&tab!==type)throw Error(costTabLabels[type]+' 양식입니다. 해당 탭에서 업로드하세요.');
 return [unifiedHeaders,...lines.slice(1).map(row=>{if(!row.some(v=>String(v??'').trim()))return unifiedHeaders.map(()=> '');const d=Object.fromEntries(header.map((h,i)=>[h,row[i]??'']));d.비용유형=domainLabels[type];if(type!=='center')d.데이터유형='비용';return unifiedHeaders.map(h=>d[h]??'');})];
}
export async function buildCostTabTemplate(ExcelJS,ctx,tab='all'){
 if(tab==='all')return buildUnifiedTemplate(ExcelJS,ctx);
 if(!costTabHeaders[tab])throw Error('비용 탭을 확인하세요.');
 const wb=await buildUnifiedTemplate(ExcelJS,ctx),headers=costTabHeaders[tab],old=wb.getWorksheet('통합 입력'),example=wb.getWorksheet('작성 예시');
 const formats=headers.map(h=>old.getCell(2,unifiedHeaders.indexOf(h)+1).numFmt),validations=headers.map(h=>structuredClone(old.getCell(2,unifiedHeaders.indexOf(h)+1).dataValidation||{}));
 const examples=[];example.eachRow((row,n)=>{if(n>1&&row.getCell(2).text===domainLabels[tab])examples.push(headers.map(h=>row.getCell(unifiedHeaders.indexOf(h)+1).value));});
 wb.removeWorksheet(old.id);wb.removeWorksheet(example.id);
 const sheet=wb.addWorksheet('통합 입력',{views:[{state:'frozen',ySplit:1}]});sheet.columns=headers.map(header=>({header,width:header.includes('번호')?25:20}));
 for(let n=2;n<=501;n++)headers.forEach((h,i)=>{const cell=sheet.getCell(n,i+1);if(formats[i])cell.numFmt=formats[i];if(validations[i].type)cell.dataValidation=structuredClone(validations[i]);});
 const ex=wb.addWorksheet('작성 예시');ex.columns=headers.map(header=>({header,width:23}));examples.forEach(row=>ex.addRow(row));
 if(tab==='common')ex.addRow(headers.map(h=>({월:ctx.month,국가코드:ctx.countries[0]?.code||'',업무구분:'공통',매장코드:'센터 공통',관리그룹:ctx.groups[0]?.name||'',비용항목:ctx.masters.find(m=>m.active)?.name||'',청구단위:'일괄',값:10000,메모:'공통 비용 예시'}[h]??'')));
 for(const ws of [sheet,ex]){ws.getRow(1).height=30;ws.getRow(1).eachCell(c=>{c.font={bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1E3F70'}};});}
 const guide=wb.getWorksheet('작성 안내');guide.spliceRows(1,guide.rowCount);for(const row of [[costTabLabels[tab]+' 전용 양식','통합 입력 시트에 작성하고 이 업무 탭에서 업로드하세요. 비용유형은 탭에 따라 자동 지정합니다.'],['필수 기준',tab==='center'?'월·센터·데이터유형·업무를 지정하세요. 건수는 비용 합계에서 제외됩니다.':tab==='trade'?'월은 선적 월입니다. 국가코드·수출입관리번호·수출/수입·출발국·도착국을 입력하세요. 외화와 환율·인코텀즈·화물타입·CIPL NO.를 지원합니다.':'월·국가코드·비용 항목을 입력하세요. 센터와 수출입 문서 번호는 필요하지 않습니다.'],['매장','매장코드로 연결하며 매장명은 참고용입니다. 센터 공통도 사용할 수 있습니다.'],['금액','값에 원화 금액을 직접 입력하거나 수량·단가로 계산하세요. 수출입 외화 입력은 통화·외화금액·환율을 사용합니다.'],['검증','최대 2,000행·5MB. 오류가 있으면 전체 저장을 막습니다. 같은 자료의 중복 등록을 차단합니다.'],['기존 양식','기존 통합 양식도 지원하지만 이 탭과 다른 비용유형이 섞여 있으면 등록을 막습니다. 전체 내역 탭은 기존 혼합 업로드를 지원합니다.']])guide.addRow(row);
 guide.eachRow(r=>{r.height=42;r.alignment={wrapText:true,vertical:'middle'};});return wb;
}
