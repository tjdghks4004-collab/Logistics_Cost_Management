import {test} from 'node:test';import assert from 'node:assert/strict';
import {tableNumber,applyTableQuery,tableCellMatches,tableQuery,setTableQuery} from './table-controls.mjs';
const columns=[{key:'name',type:'text',value:r=>r.name},{key:'amount',type:'number',value:r=>r.amount},{key:'month',type:'text',value:r=>r.month}];
test('formatted money, zero and decimal quantities sort numerically with missing values always last',()=>{
 const rows=[{name:'a',amount:'₩10,000'},{name:'b',amount:'₩900'},{name:'z',amount:0},{name:'m',amount:'—'},{name:'d',amount:'3.5박스'}];
 assert.deepEqual(applyTableQuery(rows,columns,{filters:{},sort:{key:'amount',direction:'asc'}}).map(r=>r.name),['z','d','b','a','m']);assert.deepEqual(applyTableQuery(rows,columns,{filters:{},sort:{key:'amount',direction:'desc'}}).map(r=>r.name),['a','b','d','z','m']);assert.equal(tableNumber('₩33.333333 (역산)'),33.333333);assert.equal(tableNumber('001-001'),null);assert.equal(tableNumber('0'),0);assert.equal(tableNumber('EA / 3,000'),3000);assert.equal(tableNumber('₩1,200 / EA · 부가세 별도'),1200);
});
test('combined filters use substring normalization, exact and empty checks, and inclusive numeric ranges',()=>{
 const rows=[{name:'마켓컬리',amount:900,month:'2026-11'},{name:'컬리 부산',amount:10000,month:'2026-10'},{name:'다른 곳',amount:null,month:'2026-11'}];
 const before=structuredClone(rows),q={filters:{name:{text:'컬 리'},amount:{min:'900',max:'1000'}},sort:null};assert.deepEqual(applyTableQuery(rows,columns,q),[rows[0]]);assert.deepEqual(rows,before);assert.ok(tableCellMatches('ＭＡＲＫＥＴ',{text:'market'}));assert.ok(tableCellMatches('—',{mode:'empty'}));assert.ok(!tableCellMatches(0,{mode:'empty'}));assert.ok(tableCellMatches(0,{mode:'filled'}));assert.ok(!tableCellMatches('마켓컬리',{text:'컬리',mode:'exact'}));
});
test('sorting runs over the entire data before paging, is stable, and keeps codes as text',()=>{
 const rows=Array.from({length:250},(_,i)=>({name:'r'+i,amount:249-i,month:'2026-11'}));const sorted=applyTableQuery(rows,columns,{filters:{},sort:{key:'amount',direction:'asc'}});assert.equal(sorted.slice(0,100)[0].amount,0);assert.equal(sorted.at(-1).amount,249);assert.deepEqual(applyTableQuery([{name:'01'},{name:'001'}],columns,{sort:{key:'name',direction:'asc'}}).map(r=>r.name),['001','01']);
 const same=[{name:'a',amount:1},{name:'b',amount:1}];assert.deepEqual(applyTableQuery(same,columns,{sort:{key:'amount',direction:'desc'}}),same);
});
test('view query state is isolated and unknown hidden columns do not change records',()=>{
 setTableQuery('a',{filters:{name:{text:'컬리'}},sort:null});assert.equal(tableQuery('a').filters.name.text,'컬리');assert.deepEqual(tableQuery('b').filters,{});const row={name:'a',amount:1};assert.deepEqual(applyTableQuery([row],columns,{filters:{deleted:{text:'x'}}}),[row]);setTableQuery('a',{filters:{},sort:null});
});

test('localized dates and times sort by actual calendar values rather than unpadded text',()=>{
 const columns=[{key:'when',type:'date',value:r=>r.when}],rows=[{when:'2026. 11. 2. 오후 1:00:00'},{when:'2026. 9. 2. 오전 11:00:00'},{when:'2026. 11. 2. 오전 11:00:00'}];
 assert.deepEqual(applyTableQuery(rows,columns,{sort:{key:'when',direction:'asc'}}),[rows[1],rows[2],rows[0]]);
});

test('column values are evaluated once per row during filtering and sorting',()=>{
 let calls=0;const rows=Array.from({length:250},(_,i)=>({amount:250-i})),columns=[{key:'amount',type:'number',value:r=>{calls++;return r.amount;}}];applyTableQuery(rows,columns,{filters:{amount:{min:'1'}},sort:{key:'amount',direction:'asc'}});assert.equal(calls,250);
});
