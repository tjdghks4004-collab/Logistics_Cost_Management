import {billingUnitsFor,validateBillingUnits} from './units.mjs';
import {validateMaterialMasters,validateMaterialCosts} from './materials.mjs';
import {validateSales} from './sales.mjs';
import {validateTargets} from './periods.mjs';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import {mkdirSync,readFileSync,chmodSync} from 'node:fs';
import {resolve,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validChargeGroupMapping,validateRecord,validParentCategory,assertNoNewCostDuplicates} from './domain.mjs';
const root=dirname(fileURLToPath(import.meta.url)),roles=['admin','editor','viewer'];
const err=(status,message)=>Object.assign(Error(message),{status});
const digest=s=>createHash('sha256').update(s).digest('hex');
const hashPassword=p=>{const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(p,salt,64).toString('hex');};
const validPassword=(p,h)=>{if(typeof p!=='string'||p.length>256)return false;const [salt,hash]=h.split(':');return timingSafeEqual(scryptSync(p,salt,64),Buffer.from(hash,'hex'));};
function credentials(d){if(!/^[A-Za-z0-9_.@-]{3,80}$/.test(d.username||''))throw err(400,'아이디는 영문·숫자·_.@- 3~80자입니다.');if(typeof d.password!=='string'||d.password.length<12||d.password.length>128)throw err(400,'비밀번호는 12~128자로 입력하세요.');}
const cleanUser=u=>({id:u.id,username:u.username,name:u.name,role:u.role,active:!!u.active});
function validateState(next,previous=null,restore=false){
 if(!next||typeof next!=='object'||Array.isArray(next))throw err(400,'올바른 자료 형식이 아닙니다.');
 const keys=['costs','activity','notes','masters','stores','groups','countries','centerMasters'];
 for(const k of keys)if(!Array.isArray(next[k])||next[k].length>100000)throw err(400,`${k} 형식 또는 건수 제한을 확인하세요.`);
 const text=(v,max=100)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
 const unique=(list,key)=>new Set(list.map(r=>String(r[key]).toLowerCase())).size===list.length;
 for(const [list,key] of [['costs','id'],['stores','id'],['stores','code'],['stores','name'],['groups','id'],['countries','code'],['centerMasters','name'],['masters','name']])if(!unique(next[list],key))throw err(400,`${list}의 ${key} 중복이 있습니다.`);
 if(next.countries.some(c=>!text(c.name)||!(/^[A-Z]{2}$/).test(c.code))||next.groups.some(g=>!text(g.id)||!text(g.name)))throw err(400,'국가·그룹 값을 확인하세요.');
 const country=c=>next.countries.some(r=>r.code===c),group=g=>next.groups.some(r=>r.id===g);
 if(next.centerMasters.some(c=>!text(c.name)||!country(c.countryCode)))throw err(400,'센터 국가 연결을 확인하세요.');
 if(next.stores.some(s=>!text(s.id)||!text(s.name,40)||!(/^[A-Z0-9_-]{1,20}$/).test(s.code)||!group(s.groupId)||typeof s.active!=='boolean'))throw err(400,'매장 마스터 값을 확인하세요.');
 if(next.masters.some(m=>!text(m.name,100)||typeof m.active!=='boolean'||(m.allowedChargeGroups!==undefined&&!validChargeGroupMapping(m.allowedChargeGroups))||(m.parentCategory!==undefined&&!validParentCategory(m.parentCategory))))throw err(400,'비용 항목 값을 확인하세요.');
 try{validateBillingUnits(next);validateMaterialMasters(next,restore?null:previous);validateMaterialCosts(next,previous,{restore});validateSales(next.sales??[],next);validateTargets(next.targets??[],next);}catch(e){throw err(400,e.message);}
 const old=new Map((previous?.costs||[]).map(r=>[r.id,r]));
 const ctx={countries:next.countries,groups:next.groups,centerMasters:next.centerMasters,stores:next.stores.map(s=>restore?{...s,active:true}:s),masters:next.masters.map(m=>restore?{...m,active:true}:m),units:billingUnitsFor(next)};
 for(const r of next.costs){
  if(!text(r.id)||!Number.isSafeInteger(r.amount)||r.amount<0||r.amount>1e12||!['center','trade','common'].includes(r.domain)||!['cost','count'].includes(r.recordType))throw err(400,'비용 자료 유형·금액을 확인하세요.');
  if(r.recordType==='count'&&(r.amount!==0||!Number.isSafeInteger(r.quantity)||r.quantity<0))throw err(400,'건수는 정수이며 금액은 0이어야 합니다.');
  if(previous&&JSON.stringify(old.get(r.id))===JSON.stringify(r))continue;
  try{
   const checked=validateRecord({...r,mode:r.calculation==='reverse'?'reverse':r.currency&&r.currency!=='KRW'?'fx':r.quantity==null||r.price==null?'amount':'calculated'},ctx,{previous:restore?r:old.get(r.id)});
   if((r.incoterm||'')!==checked.incoterm||(r.cargoType||'')!==checked.cargoType)throw Error('수출입 부가정보는 지원되는 대문자 코드로 입력하세요.');
   if((r.ciplNo||'')!==checked.ciplNo||(r.internalNo||'')!==checked.internalNo)throw Error('CIPL NO.와 내부 관리번호의 앞뒤 공백을 제거하세요.');
   if((r.chargeGroup||'')!==checked.chargeGroup||(r.namedPlace||'')!==checked.namedPlace)throw Error('비용 그룹 또는 지정 장소를 확인하세요.');
   if((r.containerType||'')!==checked.containerType)throw Error('컨테이너 타입을 확인하세요.');
   if(r.calculation!==undefined&&(r.calculation!=='reverse'||r.recordType!=='cost'||(r.currency||'KRW')!=='KRW'||checked.price!==r.price||checked.quantity!==r.quantity))throw Error('역산 단가·수량·원화 입력 정보를 확인하세요.');
   if(checked.amount!==r.amount)throw Error('수량·단가 또는 외화·환율의 계산 결과와 금액이 일치하지 않습니다.');
   if(!restore&&((r.groupId||'')!==(checked.groupId||'')||(r.countryCode||'')!==(checked.countryCode||'')))throw Error('매장·센터의 소속과 국가 연결을 확인하세요. 과거 내역은 당시 소속을 유지합니다.');
   // Restoring a historical snapshot must preserve its original group/country.
   if(r.groupId&&!group(r.groupId))throw Error('관리그룹이 없습니다.');
   if(r.countryCode&&!country(r.countryCode))throw Error('국가가 없습니다.');
  }catch(e){throw err(400,e.message);}
 }
 if(!restore)try{assertNoNewCostDuplicates(next.costs,previous?.costs||[]);}catch(e){throw err(400,e.message);}
 for(const r of next.activity)if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.month)||!next.centerMasters.some(c=>c.name===r.center)||!['volume','sales'].every(k=>Number.isSafeInteger(r[k])&&r[k]>=0&&r[k]<=1e12))throw err(400,'물동량·매출 값을 확인하세요.');
 for(const r of next.notes)if(!text(r.reason,1000)||!text(r.plan,1000)||!text(r.owner)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.month))throw err(400,'사유·조치 계획 값을 확인하세요.');
 return next;
}
function changes(before,after){const result=[];for(const key of Object.keys(after)){if(JSON.stringify(before?.[key])===JSON.stringify(after[key]))continue;if(key==='costs'){const prev=new Map((before?.costs||[]).map(r=>[r.id,r])),now=new Map(after.costs.map(r=>[r.id,r]));for(const [id,row] of now)if(JSON.stringify(prev.get(id))!==JSON.stringify(row))result.push({area:key,operation:prev.has(id)?'수정':'등록',id,before:prev.get(id)||null,after:row});for(const [id,row] of prev)if(!now.has(id))result.push({area:key,operation:'삭제',id,before:row,after:null});}else result.push({area:key,operation:'변경',before:before?.[key]??null,after:after[key]});}return result;}
export function createApp({dbPath=process.env.LOGISTICS_DB_PATH||resolve(root,'data/logistics.sqlite'),secureCookies=process.env.NODE_ENV==='production'}={}){
 if(dbPath!==':memory:'){mkdirSync(dirname(dbPath),{recursive:true,mode:0o700});}
 const db=new DatabaseSync(dbPath);if(dbPath!==':memory:')chmodSync(dbPath,0o600);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,username TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS drafts(user_id INTEGER NOT NULL REFERENCES users(id),slot TEXT NOT NULL,document TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,slot));
 CREATE TABLE IF NOT EXISTS workspace(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,document TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,details TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS snapshots(id INTEGER PRIMARY KEY,at TEXT NOT NULL,revision INTEGER NOT NULL,document TEXT NOT NULL);`);
 const attempts=new Map();
 const audit=(actor,action,details)=>db.prepare('INSERT INTO audit(at,actor,action,details) VALUES(?,?,?,?)').run(new Date().toISOString(),actor,action,JSON.stringify(details));
 const workspace=()=>{const r=db.prepare('SELECT * FROM workspace WHERE id=1').get();return r?{revision:r.revision,state:JSON.parse(r.document)}:{revision:0,state:null};};
 const requireAdmin=u=>{if(u.role!=='admin')throw err(403,'관리자 권한이 필요합니다.');};
 const readBody=async req=>{let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>10e6)throw err(413,'요청 크기는 10MB 이하입니다.');chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw err(400,'JSON 형식이 올바르지 않습니다.');}};
 function writeWorkspace(next,revision,user,action){
  db.exec('BEGIN IMMEDIATE');try{const current=workspace();if(revision!==current.revision)throw err(409,'다른 사용자가 자료를 변경했습니다. 입력 내용을 보관한 후 새로고침해 다시 확인하세요.');validateState(next,current.state,action==='restore');
   if(user.role==='editor')for(const key of new Set([...Object.keys(current.state||{}),...Object.keys(next)]))if(!['costs','activity','notes','sales'].includes(key)&&JSON.stringify(current.state?.[key])!==JSON.stringify(next[key]))throw err(403,'기준정보 변경은 관리자만 가능합니다.');
   if(current.state){db.prepare('INSERT INTO snapshots(at,revision,document) VALUES(?,?,?)').run(new Date().toISOString(),current.revision,JSON.stringify(current.state));db.exec('DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY id DESC LIMIT 20)');}
   const rev=current.revision+1;db.prepare('INSERT INTO workspace VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,document=excluded.document').run(rev,JSON.stringify(next));audit(user.username,action,{revision:rev,changes:changes(current.state,next)});db.exec('COMMIT');return {revision:rev};
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 const server=http.createServer(async(req,res)=>{
  const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
  try{
   const path=new URL(req.url,'http://localhost').pathname,mutating=!['GET','HEAD'].includes(req.method);
   res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');
   if(path.startsWith('/api/')){
    if(mutating){if(req.headers.origin!==`${secureCookies?'https':'http'}://${req.headers.host}`)throw err(403,'같은 사이트에서 요청하세요.');if(!req.headers['content-type']?.startsWith('application/json'))throw err(415,'JSON 요청이 필요합니다.');}
    if(path==='/api/status'&&req.method==='GET')return json(200,{setupRequired:!db.prepare('SELECT id FROM users LIMIT 1').get()});
    if(path==='/api/setup'&&req.method==='POST'){
     if(secureCookies)throw err(403,'공개 서버의 최초 관리자는 서버 터미널에서 npm run admin:init으로 등록하세요.');
     if(db.prepare('SELECT id FROM users LIMIT 1').get())throw err(409,'초기 설정이 이미 완료되었습니다.');
     if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))throw err(403,'최초 관리자 등록은 서버의 로컬 접속에서 진행하세요.');
     const d=await readBody(req);credentials(d);if(db.prepare('SELECT id FROM users LIMIT 1').get())throw err(409,'초기 설정이 이미 완료되었습니다.');db.prepare('INSERT INTO users(username,name,password_hash,role) VALUES(?,?,?,?)').run(d.username,d.name?.slice(0,80)||d.username,hashPassword(d.password),'admin');audit(d.username,'setup',{});return json(201,{ok:true});
    }
    if(path==='/api/login'&&req.method==='POST'){
     const addr=req.socket.remoteAddress,now=Date.now(),attempt=attempts.get(addr)||{count:0,until:now+300000};if(attempt.until<now){attempt.count=0;attempt.until=now+300000;}if(attempt.count>=10)throw err(429,'로그인 시도가 많습니다. 5분 후 다시 시도하세요.');attempt.count++;attempts.set(addr,attempt);
     const d=await readBody(req),u=typeof d.username==='string'?db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(d.username):null;
     if(!u||!validPassword(d.password,u.password_hash))throw err(401,'아이디 또는 비밀번호가 올바르지 않습니다.');attempts.delete(addr);
     const token=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');db.prepare('DELETE FROM sessions WHERE expires<?').run(now);db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(token),u.id,csrf,now+8*3600000);res.setHeader('Set-Cookie',`logistics_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secureCookies?'; Secure':''}`);audit(u.username,'login',{});return json(200,{user:cleanUser(u),csrf});
    }
    const cookie=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('logistics_session='))?.slice('logistics_session='.length)||'';
    const session=db.prepare('SELECT sessions.csrf,sessions.token_hash,users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires>? AND users.active=1').get(digest(cookie),Date.now());if(!session)throw err(401,'로그인이 필요합니다.');
    if(mutating&&req.headers['x-csrf-token']!==session.csrf)throw err(403,'세션을 새로고침한 후 다시 시도하세요.');
    if(path==='/api/me'&&req.method==='GET')return json(200,{user:cleanUser(session),csrf:session.csrf});
    if(path==='/api/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE token_hash=?').run(session.token_hash);res.setHeader('Set-Cookie','logistics_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(200,{ok:true});}
    if(path==='/api/password'&&req.method==='POST'){const d=await readBody(req);if(!validPassword(d.currentPassword,session.password_hash))throw err(403,'현재 비밀번호를 확인하세요.');credentials({username:session.username,password:d.password});db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(d.password),session.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(session.id);audit(session.username,'password-change',{});return json(200,{ok:true});}
    if(path==='/api/drafts'){
     if(!['admin','editor'].includes(session.role))throw err(403,'임시 저장은 입력 권한이 필요합니다.');
     if(req.method==='GET')return json(200,{drafts:db.prepare('SELECT slot,document,updated_at FROM drafts WHERE user_id=? ORDER BY updated_at DESC').all(session.id).map(r=>({slot:r.slot,data:JSON.parse(r.document),updatedAt:r.updated_at}))});
     if(['PUT','DELETE'].includes(req.method)){const d=await readBody(req);if(typeof d.slot!=='string'||!d.slot.length||d.slot.length>200||/[\u0000-\u001f\u007f]/.test(d.slot))throw err(400,'임시 저장 위치를 확인하세요.');
      if(req.method==='DELETE'){db.prepare('DELETE FROM drafts WHERE user_id=? AND slot=?').run(session.id,d.slot);return json(200,{ok:true});}
      if(!d.data||typeof d.data!=='object'||Array.isArray(d.data))throw err(400,'임시 저장 형식을 확인하세요.');const document=JSON.stringify(d.data);if(Buffer.byteLength(document)>1e6)throw err(413,'임시 저장은 한 건당 1MB 이하입니다.');if(!db.prepare('SELECT 1 FROM drafts WHERE user_id=? AND slot=?').get(session.id,d.slot)&&db.prepare('SELECT COUNT(*) AS n FROM drafts WHERE user_id=?').get(session.id).n>=100)throw err(400,'임시 저장은 계정당 100개까지 보관합니다.');
      const updatedAt=new Date().toISOString();db.prepare('INSERT INTO drafts VALUES(?,?,?,?) ON CONFLICT(user_id,slot) DO UPDATE SET document=excluded.document,updated_at=excluded.updated_at').run(session.id,d.slot,document,updatedAt);return json(200,{ok:true,updatedAt});
     }
    }
    if(path==='/api/state'&&req.method==='GET')return json(200,workspace());
    if(path==='/api/state'&&req.method==='PUT'){if(!['admin','editor'].includes(session.role))throw err(403,'조회 계정은 저장할 수 없습니다.');const d=await readBody(req);if(!workspace().state)requireAdmin(session);return json(200,writeWorkspace(d.state,d.revision,session,'save'));}
    if(path==='/api/users'&&req.method==='GET'){requireAdmin(session);return json(200,{users:db.prepare('SELECT id,username,name,role,active FROM users').all().map(cleanUser)});}
    if(path==='/api/users'&&req.method==='POST'){requireAdmin(session);const d=await readBody(req);credentials(d);if(!roles.includes(d.role))throw err(400,'권한을 확인하세요.');if(db.prepare('SELECT id FROM users WHERE username=?').get(d.username))throw err(409,'이미 등록된 아이디입니다.');db.prepare('INSERT INTO users(username,name,password_hash,role) VALUES(?,?,?,?)').run(d.username,d.name?.slice(0,80)||d.username,hashPassword(d.password),d.role);audit(session.username,'user-create',{username:d.username,role:d.role});return json(201,{ok:true});}
    if(path.startsWith('/api/users/')&&req.method==='PATCH'){requireAdmin(session);const id=Number(path.split('/').at(-1)),d=await readBody(req),u=db.prepare('SELECT * FROM users WHERE id=?').get(id);if(!u)throw err(404,'사용자가 없습니다.');if(id===session.id)throw err(400,'자신의 권한·사용 상태는 변경할 수 없습니다.');if(!roles.includes(d.role)||typeof d.active!=='boolean')throw err(400,'권한·상태를 확인하세요.');db.prepare('UPDATE users SET role=?,active=? WHERE id=?').run(d.role,Number(d.active),id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);audit(session.username,'user-update',{username:u.username,role:d.role,active:d.active});return json(200,{ok:true});}
    if(path==='/api/audit'&&req.method==='GET'){requireAdmin(session);return json(200,{records:db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 200').all().map(r=>({...r,details:JSON.parse(r.details)}))});}
    if(path==='/api/backup'&&req.method==='GET'){requireAdmin(session);audit(session.username,'backup-download',{});return json(200,{schemaVersion:1,exportedAt:new Date().toISOString(),...workspace()});}
    if(path==='/api/snapshots'&&req.method==='GET'){requireAdmin(session);return json(200,{snapshots:db.prepare('SELECT id,at,revision FROM snapshots ORDER BY id DESC LIMIT 20').all()});}
    if(path==='/api/restore'&&req.method==='POST'){requireAdmin(session);const d=await readBody(req);if(!validPassword(d.currentPassword,session.password_hash))throw err(403,'관리자 비밀번호를 확인하세요.');let state;if(d.snapshotId){const s=db.prepare('SELECT document FROM snapshots WHERE id=?').get(Number(d.snapshotId));if(!s)throw err(404,'백업이 없습니다.');state=JSON.parse(s.document);}else{if(d.backup?.schemaVersion!==1)throw err(400,'지원하지 않는 백업입니다.');state=d.backup.state;}return json(200,writeWorkspace(state,d.revision,session,'restore'));}
    throw err(404,'지원하지 않는 API입니다.');
   }
   if(!['GET','HEAD'].includes(req.method))throw err(405,'허용되지 않는 요청입니다.');
   const allowed=new Set(['/index.html','/login.html','/login.mjs','/style.css','/app.mjs','/api-client.mjs','/calc.mjs','/periods.mjs','/domain.mjs','/excel.mjs','/store-import.mjs','/sales.mjs','/cost-tabs.mjs','/materials.mjs','/units.mjs','/quick-entry.mjs','/outbound.mjs','/search.mjs','/import-data.mjs','/node_modules/exceljs/dist/exceljs.min.js']);
   const file=path==='/'?'/index.html':path;if(!allowed.has(file))throw err(404,'파일이 없습니다.');
   const full=resolve(root,'.'+file),mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
   res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?'':readFileSync(full));
  }catch(e){json(e.status||500,{error:e.status?e.message:'서버에서 요청을 처리하지 못했습니다.'});}
 });
 return {server,db,initializeAdmin:d=>{credentials(d);db.exec('BEGIN IMMEDIATE');try{if(db.prepare('SELECT id FROM users LIMIT 1').get())throw Error('관리자가 이미 등록되어 있습니다.');db.prepare('INSERT INTO users(username,name,password_hash,role) VALUES(?,?,?,?)').run(d.username,d.name?.slice(0,80)||d.username,hashPassword(d.password),'admin');audit(d.username,'setup-cli',{});db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}},close:()=>new Promise(r=>server.close(()=>{db.close();r();}))};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const app=createApp(),{server}=app;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{app.close().then(()=>process.exit(0));});server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log(`물류비 서버 실행: 포트 ${server.address().port} (SQLite 저장)`));}
