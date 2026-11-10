import {lockedMonths,reconciliationResult} from './controls.mjs';
import {categoryParentOf} from './domain.mjs';
export function dashboardMonthStates(state,months){
 const locked=lockedMonths(state),checks=(state.reconciliations||[]).map(c=>({check:c,result:reconciliationResult(c,state)}));
 return months.map(month=>{const costs=state.costs.filter(r=>r.month===month&&r.recordType!=='count'),related=checks.filter(c=>c.check.months.includes(month)),covered=new Set(related.filter(c=>c.result.matched).flatMap(c=>c.check.recordIds)),coveredCount=costs.filter(r=>covered.has(r.id)).length,bad=related.some(c=>!c.result.matched),complete=costs.length>0&&coveredCount===costs.length&&!bad;
 return {month,status:locked.has(month)?'closed':bad?'review':complete?'reconciled':costs.length?'entering':'empty',costCount:costs.length,coveredCount,checkCount:related.length,hasCounts:state.costs.some(r=>r.month===month&&r.recordType==='count'),hasSales:(state.sales||[]).some(r=>r.month===month)||(state.activity||[]).some(r=>r.month===month)};});
}
export function dashboardChargeMetrics(rows,masters){
 const groups=new Map(),costs=rows.filter(r=>r.domain==='center'&&r.recordType!=='count');
 for(const r of costs){const kind=/^B2[CB] 출고비$/.test(r.category)?'box':r.category==='용차임'?'truck':categoryParentOf(r.category,masters)==='임가공비'?'processing':null;if(!kind)continue;
 const rawUnit=String(r.unit||'원'),unit=kind==='box'&&['BOX','박스'].includes(rawUnit.toUpperCase())?'BOX':kind==='truck'&&['건','회'].includes(rawUnit)?'회':rawUnit;
 const label=kind==='box'?'박스 출고비':kind==='truck'?'용차비':r.category;
 // Total-only invoices have no measurable quantity, and never become a per-unit denominator.
 const measurable=r.quantity!=null&&Number.isFinite(Number(r.quantity))&&Number(r.quantity)>0&&unit!=='원';
 const key=JSON.stringify([kind,kind==='processing'?r.category:'',measurable?unit:'수량 없음']);if(!groups.has(key))groups.set(key,{key,kind,label,unit:measurable?unit:'수량 없음',amount:0,quantity:0,ids:[],measurable});const g=groups.get(key);g.amount+=r.amount;if(measurable)g.quantity+=Number(r.quantity);g.ids.push(r.id);
 }
 return [...groups.values()].map(g=>({...g,unitCost:g.measurable&&g.quantity>0?g.amount/g.quantity:null})).sort((a,b)=>a.kind.localeCompare(b.kind)||a.label.localeCompare(b.label,'ko')||a.unit.localeCompare(b.unit));
}
export function dashboardCostIncreases(current,previous,kind,limit=5){
 const key=r=>kind==='store'?JSON.stringify([r.storeId||'',r.groupId||'']):r.category,groups=new Map();
 for(const [side,rows] of [['current',current],['previous',previous]])for(const r of rows){if(r.recordType==='count')continue;const k=key(r);if(!groups.has(k))groups.set(k,{key:k,current:0,previous:0,ids:[],previousIds:[]});const g=groups.get(k);g[side]+=r.amount;(side==='current'?g.ids:g.previousIds).push(r.id);}
 return [...groups.values()].map(g=>({...g,delta:g.current-g.previous,baselineMissing:!g.previousIds.length,percent:g.previousIds.length&&g.previous>0?(g.current/g.previous-1)*100:null})).filter(g=>g.delta>0).sort((a,b)=>b.delta-a.delta||a.key.localeCompare(b.key,'ko')).slice(0,limit);
}
