import {backupDatabase} from './backup-db.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomBytes} from 'node:crypto';import {createApp} from './server.mjs';
const initial=()=>({costs:[],activity:[],notes:[],masters:[{name:'B2C 출고비',unit:'BOX',active:true,allowedChargeGroups:['국제운송료','출발지 비용','도착지 비용','적하보험료','기타·일괄 청구']}],stores:[{id:'s1',name:'서울점',code:'SHOP001',groupId:'g1',active:true}],groups:[{id:'g1',name:'직영그룹'}],countries:[{code:'KR',name:'대한민국'}],centerMasters:[{name:'인천',countryCode:'KR'}]});
const row=(id,amount=50000)=>({id,domain:'center',recordType:'cost',month:'2026-10',center:'인천',countryCode:'KR',account:'B2C',category:'B2C 출고비',unit:'BOX',quantity:100,price:amount/100,amount,storeId:'s1',groupId:'g1',memo:''});
async function start(dbPath=':memory:'){const app=createApp({dbPath,secureCookies:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));return {...app,url:`http://127.0.0.1:${app.server.address().port}`};}
function client(url){let cookie='',csrf='';return async(path,{method='GET',body,origin=url,token=true}={})=>{const headers={Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...(token&&csrf?{'X-CSRF-Token':csrf}:{})};const res=await fetch(url+path,{method,headers,body:body?JSON.stringify(body):undefined});if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];const data=await res.json();if(data.csrf)csrf=data.csrf;return {status:res.status,data};};}
const password=()=>randomBytes(18).toString('hex');
test('auth, permissions, validation, conflicts, audit, backup and atomic restore',async()=>{
 const app=await start(),admin=client(app.url),pass=password();try{
  assert.equal((await admin('/api/state')).status,401);assert.equal((await admin('/data/logistics.sqlite')).status,404);
  assert.equal((await admin('/api/setup',{method:'POST',body:{username:'admin',password:pass},origin:'https://evil.example'})).status,403);
  assert.equal((await admin('/api/setup',{method:'POST',body:{username:'admin',password:pass}})).status,201);
  assert.equal((await admin('/api/login',{method:'POST',body:{username:'admin',password:'invalid'}})).status,401);
  assert.equal((await admin('/api/login',{method:'POST',body:{username:'admin',password:pass}})).status,200);
  assert.notEqual(app.db.prepare('SELECT password_hash FROM users').get().password_hash,pass);
  const doc=initial();assert.equal((await admin('/api/state',{method:'PUT',body:{revision:0,state:doc},token:false})).status,403);
  assert.equal((await admin('/api/state',{method:'PUT',body:{revision:0,state:doc}})).status,200);
  for(const role of ['editor','viewer'])assert.equal((await admin('/api/users',{method:'POST',body:{username:role,password:pass,role}})).status,201);
  const viewer=client(app.url),editor=client(app.url);await viewer('/api/login',{method:'POST',body:{username:'viewer',password:pass}});await editor('/api/login',{method:'POST',body:{username:'editor',password:pass}});
  assert.equal((await viewer('/api/state')).status,200);assert.equal((await viewer('/api/state',{method:'PUT',body:{revision:1,state:doc}})).status,403);assert.equal((await viewer('/api/backup')).status,403);
  assert.equal((await editor('/api/state',{method:'PUT',body:{revision:1,state:{...doc,groups:[...doc.groups,{id:'g2',name:'forbidden'}]}}})).status,403);
  doc.costs=[row('r1')];assert.equal((await editor('/api/state',{method:'PUT',body:{revision:1,state:doc}})).status,200);
  assert.equal((await admin('/api/state',{method:'PUT',body:{revision:1,state:doc}})).status,409);
  const tampered={...doc,costs:[{...row('r1'),amount:999}]};assert.equal((await editor('/api/state',{method:'PUT',body:{revision:2,state:tampered}})).status,400);
  const count={...row('r1'),recordType:'count',quantity:100,amount:500};assert.equal((await editor('/api/state',{method:'PUT',body:{revision:2,state:{...doc,costs:[count]}}})).status,400);
  const backup=(await admin('/api/backup')).data;assert.ok(!JSON.stringify(backup).includes('password_hash'));assert.equal(backup.state.costs[0].amount,50000);
  doc.costs=[row('r1',60000)];assert.equal((await editor('/api/state',{method:'PUT',body:{revision:2,state:doc}})).status,200);
  const audit=(await admin('/api/audit')).data.records;assert.ok(audit.some(a=>a.details.changes?.some(c=>c.operation==='수정'&&c.before.amount===50000&&c.after.amount===60000)));
  assert.equal((await admin('/api/restore',{method:'POST',body:{revision:3,backup,currentPassword:'wrong'}})).status,403);
  assert.equal((await admin('/api/restore',{method:'POST',body:{revision:3,backup:{...backup,state:{...doc,costs:[{...row('r1'),amount:-1}]}},currentPassword:pass}})).status,400);
  assert.equal((await admin('/api/state')).data.revision,3);
  assert.equal((await admin('/api/restore',{method:'POST',body:{revision:3,backup,currentPassword:pass}})).status,200);assert.equal((await admin('/api/state')).data.state.costs[0].amount,50000);
  assert.ok((await admin('/api/snapshots')).data.snapshots.length>=3);
  const users=(await admin('/api/users')).data.users,ed=users.find(u=>u.username==='editor');await admin('/api/users/'+ed.id,{method:'PATCH',body:{role:'editor',active:false}});assert.equal((await editor('/api/state')).status,401);
  await viewer('/api/logout',{method:'POST',body:{}});assert.equal((await viewer('/api/state')).status,401);
 }finally{await app.close();}
});
test('SQLite data and audit survive full server restart',async()=>{const dir=mkdtempSync(join(tmpdir(),'logistics-db-test-')),dbPath=join(dir,'db.sqlite'),pass=password();let app=await start(dbPath);try{let c=client(app.url);await c('/api/setup',{method:'POST',body:{username:'restart',password:pass}});await c('/api/login',{method:'POST',body:{username:'restart',password:pass}});const state=initial();state.costs=[row('persist')];assert.equal((await c('/api/state',{method:'PUT',body:{revision:0,state}})).status,200);await backupDatabase(dbPath,join(dir,'full-backup.sqlite'));await assert.rejects(()=>backupDatabase(dbPath,join(dir,'full-backup.sqlite')));await app.close();app=await start(join(dir,'full-backup.sqlite'));c=client(app.url);await c('/api/login',{method:'POST',body:{username:'restart',password:pass}});assert.equal((await c('/api/state')).data.state.costs[0].id,'persist');assert.ok((await c('/api/audit')).data.records.some(r=>r.action==='save'));}finally{await app.close();rmSync(dir,{recursive:true,force:true});}});

test('trade metadata is persisted and invalid cargo cannot bypass server validation',async()=>{
 const app=await start(),c=client(app.url),pass=password();try{
  await c('/api/setup',{method:'POST',body:{username:'tradeadmin',password:pass}});await c('/api/login',{method:'POST',body:{username:'tradeadmin',password:pass}});
  const state=initial();state.costs=[{...row('trade-1'),domain:'trade',center:'',shipment:'EXP-1',direction:'수출',origin:'KR',destination:'KR',incoterm:'CIP',cargoType:'AIR',ciplNo:'000012-CIPL',internalNo:'SCM-000034',chargeGroup:'국제운송료',namedPlace:'Hanoi Warehouse'}];
  assert.equal((await c('/api/state',{method:'PUT',body:{revision:0,state}})).status,200);assert.equal((await c('/api/state')).data.state.costs[0].incoterm,'CIP');
  const backup=(await c('/api/backup')).data;assert.equal(backup.state.costs[0].cargoType,'AIR');assert.equal(backup.state.costs[0].ciplNo,'000012-CIPL');assert.equal(backup.state.costs[0].internalNo,'SCM-000034');assert.equal(backup.state.costs[0].chargeGroup,'국제운송료');assert.equal(backup.state.costs[0].namedPlace,'Hanoi Warehouse');state.costs[0].cargoType='INVALID';assert.equal((await c('/api/state',{method:'PUT',body:{revision:1,state}})).status,400);assert.equal((await c('/api/state')).data.state.costs[0].cargoType,'AIR');
 }finally{await app.close();}
});

test('server verifies converted KRW and preserves FX evidence through backups',async()=>{const app=await start(),c=client(app.url),pass=password();try{await c('/api/setup',{method:'POST',body:{username:'fxadmin',password:pass}});await c('/api/login',{method:'POST',body:{username:'fxadmin',password:pass}});const state=initial();state.costs=[{...row('fx-1'),domain:'trade',center:'',shipment:'EXP-1',direction:'수출',origin:'KR',destination:'KR',currency:'USD',foreignAmount:'100',exchangeRate:'1350',rateBasis:1,rateDate:'2026-10-01',quantity:null,price:null,unit:'원',amount:135000}];assert.equal((await c('/api/state',{method:'PUT',body:{revision:0,state}})).status,200);const backup=(await c('/api/backup')).data;assert.equal(backup.state.costs[0].foreignAmount,'100');assert.equal(backup.state.costs[0].amount,135000);state.costs[0].exchangeRate='1400';assert.equal((await c('/api/state',{method:'PUT',body:{revision:1,state}})).status,400);assert.equal((await c('/api/state')).data.state.costs[0].exchangeRate,'1350');}finally{await app.close();}});

test('monthly targets validate, persist in backups and are admin-only',async()=>{const app=await start(),c=client(app.url),pass=password();try{
 await c('/api/setup',{method:'POST',body:{username:'targetadmin',password:pass}});await c('/api/login',{method:'POST',body:{username:'targetadmin',password:pass}});
 const state=initial(),scope={domain:'all',account:'all',country:'all',center:'all',category:'all',group:'all',store:'all'};state.targets=[{month:'2026-10',amount:100000,scope}];
 assert.equal((await c('/api/state',{method:'PUT',body:{revision:0,state}})).status,200);assert.equal((await c('/api/backup')).data.state.targets[0].amount,100000);
 await c('/api/users',{method:'POST',body:{username:'targeteditor',password:pass,role:'editor'}});const ed=client(app.url);await ed('/api/login',{method:'POST',body:{username:'targeteditor',password:pass}});
 state.targets[0].amount=200000;assert.equal((await ed('/api/state',{method:'PUT',body:{revision:1,state}})).status,403);
 state.targets.push({...state.targets[0]});assert.equal((await c('/api/state',{method:'PUT',body:{revision:1,state}})).status,400);assert.equal((await c('/api/state')).data.state.targets[0].amount,100000);
 }finally{await app.close();}});

test('category parents persist without rewriting costs and invalid parent metadata is rejected',async()=>{const app=await start(),c=client(app.url),pass=password();try{
 await c('/api/setup',{method:'POST',body:{username:'categoryadmin',password:pass}});await c('/api/login',{method:'POST',body:{username:'categoryadmin',password:pass}});
 const state=initial();state.costs=[row('classified')];assert.equal((await c('/api/state',{method:'PUT',body:{revision:0,state}})).status,200);
 state.masters[0].parentCategory='물류센터 비용';assert.equal((await c('/api/state',{method:'PUT',body:{revision:1,state}})).status,200);
 const backup=(await c('/api/backup')).data;assert.equal(backup.state.masters[0].parentCategory,'물류센터 비용');assert.deepEqual(backup.state.costs,state.costs);
 state.masters[0].parentCategory=' ';assert.equal((await c('/api/state',{method:'PUT',body:{revision:2,state}})).status,400);assert.equal((await c('/api/state')).data.state.masters[0].parentCategory,'물류센터 비용');
 }finally{await app.close();}});

test('ERP sales persist with backups, remain editor-writable and reject duplicates/viewer writes',async()=>{const app=await start(),admin=client(app.url),pass=password();try{
 await admin('/api/setup',{method:'POST',body:{username:'sales_admin',password:pass}});await admin('/api/login',{method:'POST',body:{username:'sales_admin',password:pass}});
 const state=initial();assert.equal((await admin('/api/state',{method:'PUT',body:{revision:0,state}})).status,200);
 for(const role of ['editor','viewer'])await admin('/api/users',{method:'POST',body:{username:'sales_'+role,password:pass,role}});
 const editor=client(app.url),viewer=client(app.url);await editor('/api/login',{method:'POST',body:{username:'sales_editor',password:pass}});await viewer('/api/login',{method:'POST',body:{username:'sales_viewer',password:pass}});
 state.sales=[{id:'sale1',month:'2026-10',storeId:'s1',groupId:'g1',amount:100000,sourceRows:5,basis:'상품매출',source:'erp'}];
 assert.equal((await editor('/api/state',{method:'PUT',body:{revision:1,state}})).status,200);assert.equal((await admin('/api/backup')).data.state.sales[0].amount,100000);
 assert.equal((await viewer('/api/state',{method:'PUT',body:{revision:2,state}})).status,403);
 const bad={...state,sales:[...state.sales,{...state.sales[0],id:'sale2'}]};assert.equal((await editor('/api/state',{method:'PUT',body:{revision:2,state:bad}})).status,400);assert.equal((await admin('/api/state')).data.state.sales.length,1);
 }finally{await app.close();}});

test('new duplicate costs are rejected atomically and inactive historical edits preserve the original allocation',async()=>{
 const app=await start(),c=client(app.url),pass=password();try{
  await c('/api/setup',{method:'POST',body:{username:'historyadmin',password:pass}});await c('/api/login',{method:'POST',body:{username:'historyadmin',password:pass}});
  const state=initial();state.costs=[row('old')];assert.equal((await c('/api/state',{method:'PUT',body:{revision:0,state}})).status,200);
  const duplicate=structuredClone(state);duplicate.costs.push({...duplicate.costs[0],id:'repeat'});
  const rejected=await c('/api/state',{method:'PUT',body:{revision:1,state:duplicate}});assert.equal(rejected.status,400);assert.match(rejected.data.error,/중복/);
  assert.equal((await c('/api/state')).data.revision,1);assert.equal((await c('/api/state')).data.state.costs.length,1);
  state.groups.push({id:'g2',name:'새 소속'});state.stores[0].groupId='g2';state.stores[0].active=false;state.masters[0].active=false;
  assert.equal((await c('/api/state',{method:'PUT',body:{revision:1,state}})).status,200);
  state.costs[0].memo='과거 비용 메모 수정';assert.equal((await c('/api/state',{method:'PUT',body:{revision:2,state}})).status,200);
  const saved=(await c('/api/state')).data.state;assert.equal(saved.costs[0].groupId,'g1');assert.equal(saved.costs[0].memo,'과거 비용 메모 수정');
  const backup=(await c('/api/backup')).data;assert.equal((await c('/api/restore',{method:'POST',body:{revision:3,backup,currentPassword:pass}})).status,200);
  assert.equal((await c('/api/state')).data.state.costs[0].groupId,'g1');
 }finally{await app.close();}
});

test('production refuses browser setup even through a localhost HTTPS reverse proxy',async()=>{
 const app=createApp({dbPath:':memory:',secureCookies:true});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));try{
  const port=app.server.address().port,res=await fetch(`http://127.0.0.1:${port}/api/setup`,{method:'POST',headers:{Origin:`https://127.0.0.1:${port}`,'Content-Type':'application/json'},body:JSON.stringify({username:'publicadmin',password:password()})});
  assert.equal(res.status,403);assert.match((await res.json()).error,/admin:init/);assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM users').get().n,0);
 }finally{await app.close();}
});

test('material masters are admin-only and purchase snapshots persist with supply cost once, tamper rejection and restore',async()=>{
 const {buildMaterialPurchase}=await import('./materials.mjs');const app=await start(),admin=client(app.url),pass=password();try{
  await admin('/api/setup',{method:'POST',body:{username:'materialadmin',password:pass}});await admin('/api/login',{method:'POST',body:{username:'materialadmin',password:pass}});
  const state=initial();state.masters.push({name:'부자재 구매비',unit:'일괄',active:true});state.materials=[{id:'m1',code:'BOX-S',kind:'택배박스',name:'택배박스 S',specification:'210×160×120',flute:'B골',unit:'EA',active:true}];state.materialPrices=[{id:'p1',materialId:'m1',supplier:'공급사',center:'인천',unit:'EA',moq:100,unitPrice:'110',effectiveFrom:'2026-01-01',vatIncluded:true,vatRate:10,active:true}];
  assert.equal((await admin('/api/state',{method:'PUT',body:{revision:0,state}})).status,200);await admin('/api/users',{method:'POST',body:{username:'materialeditor',password:pass,role:'editor'}});const editor=client(app.url);await editor('/api/login',{method:'POST',body:{username:'materialeditor',password:pass}});
  state.costs=[buildMaterialPurchase({purchaseDate:'2026-10-01',materialId:'m1',priceId:'p1',quantity:'100',unitPrice:'110',center:'인천',memo:'청구 1'},state)];assert.equal((await editor('/api/state',{method:'PUT',body:{revision:1,state}})).status,200);
  let backup=(await admin('/api/backup')).data;assert.equal(backup.state.costs[0].amount,10000);assert.equal(backup.state.costs[0].material.vatAmount,1000);assert.equal(backup.state.costs.length,1);
  const bad=structuredClone(state);bad.materials[0].name='권한 없는 수정';assert.equal((await editor('/api/state',{method:'PUT',body:{revision:2,state:bad}})).status,403);
  const tamper=structuredClone(state);tamper.costs[0].material.specification='변조';assert.equal((await editor('/api/state',{method:'PUT',body:{revision:2,state:tamper}})).status,400);
  state.materials[0].name='새 품명';state.materialPrices[0].active=false;assert.equal((await admin('/api/state',{method:'PUT',body:{revision:2,state}})).status,200);
  assert.equal((await admin('/api/restore',{method:'POST',body:{revision:3,backup,currentPassword:pass}})).status,200);backup=(await admin('/api/backup')).data;assert.equal(backup.state.materials[0].name,'택배박스 S');assert.equal(backup.state.costs[0].material.specification,'210×160×120');
 }finally{await app.close();}
});

test('custom billing units persist with admin-only writes and work in server cost calculation',async()=>{
 const app=await start(),admin=client(app.url),pass=password();try{
  await admin('/api/setup',{method:'POST',body:{username:'unitadmin',password:pass}});await admin('/api/login',{method:'POST',body:{username:'unitadmin',password:pass}});
  const state=initial();state.billingUnits=['40FT','판'];state.masters[0].unit='40FT';state.costs=[{...row('custom-unit'),unit:'40FT'}];assert.equal((await admin('/api/state',{method:'PUT',body:{revision:0,state}})).status,200);
  assert.deepEqual((await admin('/api/backup')).data.state.billingUnits,['40FT','판']);
  await admin('/api/users',{method:'POST',body:{username:'uniteditor',password:pass,role:'editor'}});const ed=client(app.url);await ed('/api/login',{method:'POST',body:{username:'uniteditor',password:pass}});
  const bad={...state,billingUnits:['40FT','판','new']};assert.equal((await ed('/api/state',{method:'PUT',body:{revision:1,state:bad}})).status,403);
  state.costs[0].quantity=200;state.costs[0].amount=100000;assert.equal((await ed('/api/state',{method:'PUT',body:{revision:1,state}})).status,200);
 }finally{await app.close();}
});
test('incomplete drafts are private, durable and excluded from workspace revisions, costs and snapshots',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'scm-drafts-')),dbPath=join(dir,'app.sqlite'),pass=password();let app=await start(dbPath);try{
  let admin=client(app.url);await admin('/api/setup',{method:'POST',body:{username:'draftadmin',password:pass}});await admin('/api/login',{method:'POST',body:{username:'draftadmin',password:pass}});
  await admin('/api/state',{method:'PUT',body:{revision:0,state:initial()}});
  for(const role of ['editor','viewer'])await admin('/api/users',{method:'POST',body:{username:'draft_'+role,password:pass,role}});
  const ed=client(app.url),viewer=client(app.url);await ed('/api/login',{method:'POST',body:{username:'draft_editor',password:pass}});await viewer('/api/login',{method:'POST',body:{username:'draft_viewer',password:pass}});
  const data={kind:'entry',domain:'center',draft:{rows:[{quantity:'12',price:''}]}};
  assert.equal((await ed('/api/drafts',{method:'PUT',body:{slot:'entry:center',data}})).status,200);assert.equal((await viewer('/api/drafts')).status,403);
  assert.equal((await admin('/api/drafts')).data.drafts.length,0);assert.equal((await ed('/api/state')).data.revision,1);assert.equal((await ed('/api/state')).data.state.costs.length,0);
  const backup=(await admin('/api/backup')).data;assert.ok(!JSON.stringify(backup).includes('entry:center'));
  assert.equal((await ed('/api/drafts',{method:'PUT',body:{slot:'bad',data:[]}})).status,400);
  await app.close();app=await start(dbPath);const restored=client(app.url);await restored('/api/login',{method:'POST',body:{username:'draft_editor',password:pass}});assert.deepEqual((await restored('/api/drafts')).data.drafts[0].data,data);
  assert.equal((await restored('/api/drafts',{method:'DELETE',body:{slot:'entry:center'}})).status,200);assert.equal((await restored('/api/drafts')).data.drafts.length,0);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('reverse-derived prices persist without changing total and reject inconsistent derived evidence through save/restore',async()=>{
 const {validateRecord}=await import('./domain.mjs');const app=await start(),admin=client(app.url),pass=password();try{
  await admin('/api/setup',{method:'POST',body:{username:'reverseadmin',password:pass}});await admin('/api/login',{method:'POST',body:{username:'reverseadmin',password:pass}});
  const state=initial(),ctx={...state,units:['건','BOX']};state.costs=[validateRecord({...row('reverse'),mode:'reverse',quantity:'6623',amount:'17244352',unit:'건'},ctx)];
  assert.equal((await admin('/api/state',{method:'PUT',body:{revision:0,state}})).status,200);const backup=(await admin('/api/backup')).data;assert.equal(backup.state.costs[0].amount,17244352);assert.equal(backup.state.costs[0].calculation,'reverse');
  const bad=structuredClone(state);bad.costs[0].price+=1;assert.equal((await admin('/api/state',{method:'PUT',body:{revision:1,state:bad}})).status,400);assert.equal((await admin('/api/state')).data.revision,1);
  assert.equal((await admin('/api/restore',{method:'POST',body:{revision:1,backup,currentPassword:pass}})).status,200);assert.equal((await admin('/api/state')).data.state.costs[0].price,state.costs[0].price);
 }finally{await app.close();}
});
