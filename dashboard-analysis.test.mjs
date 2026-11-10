import {test} from 'node:test';import assert from 'node:assert/strict';
import {dashboardMonthStates,dashboardChargeMetrics,dashboardCostIncreases} from './dashboard-analysis.mjs';
const r=(id,amount,extra={})=>({id,month:'2026-10',domain:'center',recordType:'cost',category:'B2B 출고비',amount,...extra});
test('monthly status never infers completion from presence; only full matched coverage and actual closing count',()=>{
 const state={costs:[r('a',100),r('b',200)],activity:[],sales:[],reconciliations:[]};assert.equal(dashboardMonthStates(state,['2026-10'])[0].status,'entering');assert.equal(dashboardMonthStates(state,['2026-09'])[0].status,'empty');
 state.reconciliations=[{id:'c',months:['2026-10'],recordIds:['a'],expected:100}];let m=dashboardMonthStates(state,['2026-10'])[0];assert.equal(m.coveredCount,1);assert.equal(m.status,'entering');state.reconciliations.push({id:'d',months:['2026-10'],recordIds:['b'],expected:200});assert.equal(dashboardMonthStates(state,['2026-10'])[0].status,'reconciled');state.costs[1].amount=201;assert.equal(dashboardMonthStates(state,['2026-10'])[0].status,'review');state.periodEvents=[{month:'2026-10',action:'close'}];assert.equal(dashboardMonthStates(state,['2026-10'])[0].status,'closed');
});
test('typed averages separate source quantities from outbound counts, total-only costs, job kinds and incompatible units',()=>{
 const rows=[r('a',600000,{quantity:500,unit:'BOX'}),r('b',50000,{quantity:null,unit:'원'}),r('c',350000,{category:'용차임',quantity:2,unit:'건'}),r('d',20000,{category:'임가공비(라벨링)',quantity:100,unit:'EA'}),r('e',9000,{category:'임가공비(라벨링)',quantity:3,unit:'BOX'}),r('f',0,{recordType:'count',quantity:9999}),r('g',100000,{domain:'trade',category:'임가공비(라벨링)',quantity:100,unit:'EA'})];
 const g=dashboardChargeMetrics(rows,[]);assert.equal(g.find(x=>x.kind==='box'&&x.measurable).unitCost,1200);assert.equal(g.find(x=>x.kind==='box'&&!x.measurable).amount,50000);assert.equal(g.find(x=>x.kind==='truck').unitCost,175000);assert.equal(g.find(x=>x.kind==='processing'&&x.unit==='EA').unitCost,200);assert.equal(g.filter(x=>x.kind==='processing').length,2);assert.ok(g.every(x=>!x.ids.includes('f')&&!x.ids.includes('g')));
 const zero=dashboardChargeMetrics([r('z',100,{quantity:0,unit:'BOX'})],[]);assert.equal(zero[0].unitCost,null);
});
test('increase ranking uses financial differences, excludes counts, preserves historical group and marks missing baselines',()=>{
 const current=[r('a',300,{category:'A',storeId:'s',groupId:'g'}),r('b',200,{category:'B'}),r('c',99999,{recordType:'count'}),r('d',20,{category:'D'})],old=[r('oa',100,{category:'A',storeId:'s',groupId:'g'}),r('od',30,{category:'D'})];
 const ranks=dashboardCostIncreases(current,old,'item');assert.deepEqual(ranks.map(x=>x.delta),[200,200]);assert.equal(ranks.find(x=>x.key==='B').baselineMissing,true);assert.equal(ranks.find(x=>x.key==='A').percent,200);const stores=dashboardCostIncreases(current,old,'store');assert.equal(stores.find(x=>x.key==='["s","g"]').delta,200);assert.deepEqual(stores.find(x=>x.key==='["s","g"]').ids,['a']);
});
