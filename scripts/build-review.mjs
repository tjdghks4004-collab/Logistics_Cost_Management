import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=resolve(root,'artifacts/scm-logistics-review.html');
const read=name=>readFileSync(resolve(root,name),'utf8');
const mock=`
const reviewStorageKey='scm-logistics-review-v1';
let session={user:{id:'review',username:'review',name:'예시 데이터 검토',role:'admin'},csrf:'review-only'};
let revision=0,reviewDocument=null;
async function loadWorkspace(seed){
 try{reviewDocument=JSON.parse(localStorage.getItem(reviewStorageKey));}catch{}
 if(!reviewDocument||!Array.isArray(reviewDocument.costs))reviewDocument=seed();
 return {state:structuredClone(reviewDocument),initialize:true};
}
async function persist(next){
 const copy=structuredClone(next);
 try{localStorage.setItem(reviewStorageKey,JSON.stringify(copy));}catch{throw Error('브라우저가 파일 저장을 차단했습니다. 다른 브라우저에서 열거나 다운로드 설정을 확인하세요.');}
 reviewDocument=copy;revision++;return {revision};
}
async function api(path,options={}){
 if(path==='drafts'){let drafts=JSON.parse(localStorage.getItem('scm-review-drafts')||'[]');const d=JSON.parse(options.body||'{}');if(options.method==='DELETE')drafts=drafts.filter(r=>r.slot!==d.slot);if(options.method==='PUT'){drafts=drafts.filter(r=>r.slot!==d.slot);drafts.push({slot:d.slot,data:d.data,updatedAt:new Date().toISOString()});}localStorage.setItem('scm-review-drafts',JSON.stringify(drafts));return options.method==='PUT'?drafts.find(r=>r.slot===d.slot):{drafts};}
 if(path==='state')return {state:structuredClone(reviewDocument),revision};
 if(path==='me')return session;
 if(path==='backup')return {schemaVersion:1,exportedAt:new Date().toISOString(),state:structuredClone(reviewDocument),revision};
 throw Error('계정과 서버 백업 관리는 실제 서버에서 제공됩니다. 현재는 예시 데이터 화면 검토본입니다.');
}
`;
const stripModules=source=>source.replace(/^import .*?;\s*$/gm,'').replace(/^export\s+/gm,'');
const app=['controls.mjs','calc.mjs','search.mjs','units.mjs','materials.mjs','periods.mjs','domain.mjs','import-data.mjs','excel.mjs','store-import.mjs','sales.mjs','cost-tabs.mjs','quick-entry.mjs','outbound.mjs','center-charges.mjs','app.mjs'].map(name=>stripModules(read(name))).join('\n');
const tail=`
document.querySelector('#review-reset').onclick=()=>{if(confirm('이 검토본의 예시 데이터를 처음 상태로 되돌릴까요?')){localStorage.removeItem(reviewStorageKey);location.reload();}};
`;
// Keep this bootstrap for browser tests without copying any private server data.
const moduleCode=mock+'\n'+app+'\n'+tail;
let html=read('index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
html=html.replace('<title>물류비 인사이트</title>','<title>물류비 인사이트 · 예시 데이터 검토본</title>');
html=html.replace('<link rel="stylesheet" href="style.css">',`<style>${read('style.css')}\n.review-notice{padding:15px 18px;margin:18px 0;background:#fff9dc;border:1px solid #e3d68a;border-radius:8px;color:#696039;font-size:12px;line-height:1.8;display:flex;align-items:center;justify-content:space-between;gap:15px}.review-notice strong{display:block;color:#645600;font-size:14px}.review-notice button{white-space:nowrap}@media(max-width:760px){.review-notice{display:block}.review-notice button{margin-top:10px}}</style>`);
html=html.replace(/<button data-view="settings">[\s\S]*?<\/button>/,'');
html=html.replace('<button id="logout">로그아웃</button>','<button id="logout" hidden>검토본</button>');
html=html.replace('<section class="heading">','<div class="review-notice"><div><strong>예시 데이터 화면 검토본</strong>이 파일에서 자유롭게 입력·수정해 보세요. 자료는 현재 브라우저에만 저장되며 팀원과 공유되지 않습니다. 실제 업무 자료는 사이트 준비 후 입력하세요.</div><button id="review-reset">예시 데이터 초기화</button></div><section class="heading">');
html=html.replace('WORKSPACE <span>SCM</span>','WORKSPACE <span>DEMO</span>');
html=html.replaceAll('독립 프로젝트 · 서버 DB 저장','독립 프로젝트 · 예시 검토본');
const safeScript=code=>code.replace(/<\/script/gi,'<\\/script');
html=html.replace('</body>',()=>`<script>${safeScript(read('node_modules/exceljs/dist/exceljs.min.js'))}</script><script type="module">${safeScript(moduleCode)}</script></body>`);
mkdirSync(dirname(out),{recursive:true});writeFileSync(out,html);
writeFileSync(resolve(root,'artifacts/review-check.mjs'),moduleCode);
console.log('검토본 생성:',out);
