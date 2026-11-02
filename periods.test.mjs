import {test} from 'node:test';
import assert from 'node:assert/strict';
import {comparisonPeriod,shiftMonth,targetPerformance,validateTargets} from './periods.mjs';
const scope={domain:'all',account:'all',country:'all',center:'all',category:'all',group:'all',store:'all'};
test('comparison windows cross years and preserve cumulative and quarter boundaries',()=>{
 assert.equal(shiftMonth('2026-01',-1),'2025-12');
 assert.deepEqual(comparisonPeriod('2026-10','yoy').previous,['2025-10']);
 const ytd=comparisonPeriod('2026-10','ytd_yoy');assert.equal(ytd.current.length,10);assert.equal(ytd.previous[0],'2025-01');assert.equal(ytd.previous.at(-1),'2025-10');
 assert.equal(comparisonPeriod('2026-10','ytd').previous.length,0);
 const q=comparisonPeriod('2026-01','qoq');assert.deepEqual(q.current,['2026-01','2026-02','2026-03']);assert.deepEqual(q.previous,['2025-10','2025-11','2025-12']);
 assert.equal(comparisonPeriod('2026-10','target','ytd').current.length,10);
 assert.throws(()=>comparisonPeriod('2026-13'));assert.throws(()=>comparisonPeriod('2026-10','invalid'));
});
test('targets require complete matching scope, preserve zero and avoid summing overlapping scopes',()=>{
 const targets=[{month:'2026-01',amount:100,scope},{month:'2026-02',amount:200,scope},{month:'2026-01',amount:900,scope:{...scope,center:'서울'}}];
 const result=targetPerformance(240,['2026-01','2026-02'],targets,scope);assert.equal(result.amount,300);assert.equal(result.rate,80);assert.equal(result.gap,-60);
 assert.equal(targetPerformance(240,['2026-01','2026-02','2026-03'],targets,scope).rate,null);
 assert.equal(targetPerformance(10,['2026-01'],[{month:'2026-01',amount:0,scope}],scope).rate,null);
 const ctx={countries:[],centerMasters:[],masters:[],groups:[],stores:[]};assert.doesNotThrow(()=>validateTargets(targets.slice(0,2),ctx));assert.throws(()=>validateTargets([targets[0],targets[0]],ctx));assert.throws(()=>validateTargets([{...targets[0],amount:-1}],ctx));
});

test('multiple selected months compare aligned months and deduplicate cumulative/quarter ranges',()=>{
 const mom=comparisonPeriod(['2026-10','2026-08','2026-10'],'mom');assert.deepEqual(mom.current,['2026-08','2026-10']);assert.deepEqual(mom.previous,['2026-07','2026-09']);assert.equal(mom.currentLabel,'2026-08, 2026-10');
 const yoy=comparisonPeriod(['2026-01','2025-12'],'yoy');assert.deepEqual(yoy.previous,['2024-12','2025-01']);
 const ytd=comparisonPeriod(['2026-08','2026-10','2025-02'],'ytd_yoy');assert.equal(ytd.current.length,12);assert.equal(ytd.previous.length,12);assert.equal(new Set(ytd.current).size,12);assert.ok(!ytd.current.includes('2025-03'));
 const q=comparisonPeriod(['2026-01','2026-03','2026-10'],'qoq');assert.deepEqual(q.current,['2026-01','2026-02','2026-03','2026-10','2026-11','2026-12']);assert.deepEqual(q.previous,['2025-10','2025-11','2025-12','2026-07','2026-08','2026-09']);
 assert.throws(()=>comparisonPeriod([]));assert.throws(()=>comparisonPeriod(['all']));
});
