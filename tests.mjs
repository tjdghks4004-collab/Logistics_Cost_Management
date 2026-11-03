import {test} from 'node:test';
import assert from 'node:assert/strict';
import {metrics,change,parseCSV} from './calc.mjs';
test('KPI excludes VAT and handles missing denominators',()=>{assert.deepEqual(metrics([{amount:100,vat:10}],[{volume:4,sales:1000}]),{cost:100,vat:10,volume:4,sales:1000,unit:25,ratio:10});assert.equal(metrics([],[]).unit,null);assert.equal(change(10,0),null);});
test('CSV accepts quoted commas and rejects broken quotes',()=>{assert.deepEqual(parseCSV('a,b\n"센터, A",100\n'),[['a','b'],['센터, A','100']]);assert.throws(()=>parseCSV('"broken'));});

import {lineAmount} from './calc.mjs';
test('quantity × rate uses exact decimal rounding and limits',()=>{assert.equal(lineAmount('100','500'),50000);assert.equal(lineAmount('1.005','100'),101);assert.equal(lineAmount('2.5','1200'),3000);assert.equal(lineAmount('0','500'),0);for(const pair of [['-1','3'],['1.0001','1'],['1000000000000','2'],['','1']])assert.throws(()=>lineAmount(...pair));});

import {matchesStoreScope} from './calc.mjs';
test('store/group scopes preserve common costs and saved historical group',()=>{assert.equal(matchesStoreScope({},'','all'),true);assert.equal(matchesStoreScope({},'s1','all'),false);assert.equal(matchesStoreScope({storeId:'s1',groupId:'g1'},'s1','g1'),true);assert.equal(matchesStoreScope({storeId:'s1',groupId:'g1'},'all','g2'),false);});

test('group totals take precedence over selected store details without mixing groups',async()=>{
 const {preferScopeTotals}=await import('./calc.mjs');
 const rows=[{groupId:'g1',storeId:'',volume:100},{groupId:'g1',storeId:'s1',volume:60},{groupId:'g2',storeId:'s2',volume:40}];
 assert.equal(preferScopeTotals(rows).reduce((n,r)=>n+r.volume,0),140);
 assert.deepEqual(preferScopeTotals(rows.filter(r=>r.storeId)),rows.filter(r=>r.storeId));
 const overall={groupId:'',storeId:'',volume:140};assert.deepEqual(preferScopeTotals([...rows,overall],true),[overall]);
});

test('waterfall reconciles cost deltas, including new/removed categories and excluding counts',async()=>{
 const {costWaterfall}=await import('./calc.mjs');const old=[{category:'A',amount:100},{category:'B',amount:50}],now=[{category:'A',amount:80},{category:'C',amount:120},{category:'count',recordType:'count',amount:999}];const result=costWaterfall(now,old);
 assert.equal(result.start,150);assert.equal(result.end,200);assert.equal(result.steps.reduce((n,s)=>n+s.delta,result.start),result.end);assert.equal(result.steps.at(-1).to,200);assert.deepEqual(result.steps.map(s=>s.delta).sort((a,b)=>a-b),[-50,-20,120]);assert.equal(costWaterfall(old,old).steps.length,0);
});

import {csvCell} from './calc.mjs';
test('CSV exports numeric refunds as numbers and neutralizes text formulas including leading whitespace',()=>{
 assert.equal(csvCell(-1234),'"-1234"');assert.equal(csvCell(0),'"0"');
 for(const value of ['=1+1','  =1+1','\t@SUM(A1)','\r+1+1','-external'])assert.ok(csvCell(value).startsWith('"\''));
 assert.equal(csvCell('메모 "검증"'),'"메모 ""검증"""');
});
