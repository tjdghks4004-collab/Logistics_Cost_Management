export const comparisonModes={mom:'MoM · 전월 대비',yoy:'YoY · 전년 동월 대비',ytd:'YTD · 연초 누계',ytd_yoy:'YTD · 전년 누계 대비',qoq:'QoQ · 전분기 대비',target:'목표 대비'};
export const targetScopeKeys=['domain','account','country','center','category','group','store'];
export function shiftMonth(month,offset){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('기준 월을 확인하세요.');const [y,m]=month.split('-').map(Number),date=new Date(Date.UTC(y,m-1+offset,1));return date.toISOString().slice(0,7);}
const monthsFrom=(month,count)=>Array.from({length:count},(_,i)=>shiftMonth(month,i));
const rangeLabel=list=>list.length>1?`${list[0]} ~ ${list.at(-1)}`:list[0]||'비교 없음';
export function comparisonPeriod(anchor,mode='mom',targetRange='month'){
 if(Array.isArray(anchor)){
  const selected=[...new Set(anchor)].sort();if(!selected.length)throw Error('조회 월을 선택하세요.');
  const periods=selected.map(month=>comparisonPeriod(month,mode,targetRange)),current=[...new Set(periods.flatMap(p=>p.current))].sort(),previous=[...new Set(periods.flatMap(p=>p.previous))].sort();
  return {mode,current,previous,label:periods[0].label,currentLabel:monthSelectionLabel(current),previousLabel:monthSelectionLabel(previous)};
 }
 shiftMonth(anchor,0);const y=Number(anchor.slice(0,4)),m=Number(anchor.slice(5)),quarterStart=`${y}-${String(Math.floor((m-1)/3)*3+1).padStart(2,'0')}`;
 let current=[anchor],previous=[],label='전월 대비';
 if(mode==='mom')previous=[shiftMonth(anchor,-1)];
 else if(mode==='yoy'){previous=[shiftMonth(anchor,-12)];label='전년 동월 대비';}
 else if(mode==='ytd'||mode==='ytd_yoy'){current=monthsFrom(`${y}-01`,m);if(mode==='ytd_yoy')previous=current.map(month=>shiftMonth(month,-12));label=mode==='ytd'?'연초 누계':'전년 누계 대비';}
 else if(mode==='qoq'){current=monthsFrom(quarterStart,3);previous=monthsFrom(shiftMonth(quarterStart,-3),3);label='전분기 대비';}
 else if(mode==='target'){if(targetRange==='ytd')current=monthsFrom(`${y}-01`,m);else if(targetRange==='quarter')current=monthsFrom(quarterStart,3);label='목표 대비';}
 else throw Error('비교 기준을 확인하세요.');
 return {mode,current,previous,label,currentLabel:rangeLabel(current),previousLabel:rangeLabel(previous)};
}
export function scopeKey(scope){return JSON.stringify(targetScopeKeys.map(key=>scope[key]??'all'));}
export function targetPerformance(actual,months,targets,scope){
 const matched=targets.filter(t=>scopeKey(t.scope)===scopeKey(scope)&&months.includes(t.month));
 const missing=months.filter(month=>!matched.some(t=>t.month===month));
 const amount=matched.reduce((n,t)=>n+t.amount,0);
 return {amount,missing,registered:months.length-missing.length,rate:!missing.length&&amount>0?actual/amount*100:null,gap:!missing.length?actual-amount:null};
}
export function validateTargets(targets,ctx){
 if(!Array.isArray(targets)||targets.length>20000)throw Error('월별 목표 자료 형식을 확인하세요.');
 const seen=new Set();
 for(const t of targets){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(t.month)||!Number.isSafeInteger(t.amount)||t.amount<0||t.amount>1e12)throw Error('월별 목표는 0 이상 1조 이하 정수입니다.');
  if(!t.scope||targetScopeKeys.some(key=>typeof t.scope[key]!=='string'||t.scope[key].length>100))throw Error('목표의 필터 범위를 확인하세요.');
  const s=t.scope,known=(value,list)=>value==='all'||list.includes(value);
  if(!known(s.domain,['center','trade','common'])||!known(s.account,['B2C','B2B','공통'])||!known(s.country,ctx.countries.map(c=>c.code))||!known(s.center,ctx.centerMasters.map(c=>c.name))||!known(s.category,ctx.masters.map(c=>c.name))||!known(s.group,ctx.groups.map(c=>c.id))||!known(s.store,['',...ctx.stores.map(c=>c.id)]))throw Error('목표의 기준정보 연결을 확인하세요.');
  const key=t.month+scopeKey(s);if(seen.has(key))throw Error('동일 월·필터 범위의 목표가 중복되었습니다.');seen.add(key);
 }
}

export function monthSelectionLabel(months){
 const sorted=[...new Set(months)].sort();if(!sorted.length)return '비교 없음';
 const ranges=[];let start=sorted[0],end=start;for(const month of sorted.slice(1)){if(shiftMonth(end,1)===month)end=month;else{ranges.push(start===end?start:start+' ~ '+end);start=end=month;}}ranges.push(start===end?start:start+' ~ '+end);return ranges.join(', ');
}
