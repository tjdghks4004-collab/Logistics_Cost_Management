export const sum = rows => rows.reduce((n,r)=>n+(r.recordType==='count'?0:Number(r.amount)),0);
export function metrics(rows, activity) {
 const cost=sum(rows), vat=rows.reduce((n,r)=>n+Number(r.vat||0),0);
 const volume=activity.reduce((n,r)=>n+Number(r.volume),0), sales=activity.reduce((n,r)=>n+Number(r.sales),0);
 return {cost,vat,volume,sales,unit:volume?cost/volume:null,ratio:sales?cost/sales*100:null};
}
export const change=(current,previous)=>previous?(current/previous-1)*100:null;
export function parseCSV(text) {
 const lines=[]; let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i]; if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(field);field='';}else if(c==='\n'&&!quoted){row.push(field.replace(/\r$/,''));lines.push(row);row=[];field='';}else field+=c;}
 if(quoted)throw Error('닫히지 않은 따옴표가 있습니다.');
 if(field||row.length){row.push(field.replace(/\r$/,''));lines.push(row);}
 return lines.filter(r=>r.some(v=>v.trim()));
}

// Use scaled integers to round decimal quantities and prices to whole KRW.
export function lineAmount(quantity, price) {
 const scaled=v=>{const s=String(v);if(!/^\d+(\.\d{1,3})?$/.test(s)||Number(s)>1e12)throw Error('수량·단가는 0 이상 1조 이하, 소수 셋째 자리까지 입력하세요.');const [a,b='']=s.split('.');return BigInt(a)*1000n+BigInt(b.padEnd(3,'0'));};
 const amount=(scaled(quantity)*scaled(price)+500000n)/1000000n;
 if(amount>1000000000000n)throw Error('공급가액은 1조 원 이하로 입력하세요.');
 return Number(amount);
}

export function matchesStoreScope(row, storeId='all', groupId='all') {
 return (storeId==='all'||(row.storeId||'')===storeId)&&(groupId==='all'||(row.groupId||'')===groupId);
}

export function convertForeignAmount(foreignAmount, exchangeRate, rateBasis=1){
 const scale=(value,digits,label,limit)=>{const text=String(value).trim();if(!new RegExp('^\\d+(\\.\\d{1,'+digits+'})?$').test(text)||Number(text)>limit)throw Error(`${label} 형식·범위를 확인하세요.`);const [a,b='']=text.split('.');return BigInt(a)*10n**BigInt(digits)+BigInt(b.padEnd(digits,'0'));};
 const amount=scale(foreignAmount,4,'외화 금액',1e12),rate=scale(exchangeRate,6,'환율',1e9);
 if(rate<=0n)throw Error('환율은 0보다 커야 합니다.');
 if(![1,100,1000].includes(Number(rateBasis)))throw Error('환율 적용단위는 1/100/1000입니다.');
 const denominator=10000000000n*BigInt(Number(rateBasis)),result=(amount*rate+denominator/2n)/denominator;
 if(result>1000000000000n)throw Error('환산 금액은 1조 원 이하로 입력하세요.');
 return Number(result);
}

export function preferScopeTotals(rows,wholeScope=false){
 const overall=rows.filter(r=>!r.storeId&&!r.groupId);
 if(wholeScope&&overall.length)return overall;
 return [...new Set(rows.map(r=>r.groupId||''))].flatMap(group=>{const same=rows.filter(r=>(r.groupId||'')===group),common=same.filter(r=>!r.storeId);return common.length?common:same;});
}

export function costWaterfall(current,previous){
 const costs=rr=>rr.filter(r=>r.recordType!=='count'),now=costs(current),old=costs(previous),start=sum(old),end=sum(now);
 const names=[...new Set([...now,...old].map(r=>r.category))];
 const changes=names.map(name=>({name,delta:sum(now.filter(r=>r.category===name))-sum(old.filter(r=>r.category===name))})).filter(r=>r.delta!==0).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)||a.name.localeCompare(b.name,'ko'));
 let running=start;const steps=changes.map(r=>{const from=running;running+=r.delta;return {...r,from,to:running};});return {start,end,steps};
}
