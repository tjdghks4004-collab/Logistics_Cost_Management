import './build-review.mjs';
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const html=readFileSync(resolve(root,'artifacts/scm-logistics-review.html'));
const server=http.createServer((req,res)=>{
 if(req.method!=='GET'||!['/','/review.html','/favicon.ico'].includes(req.url)){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('검토 화면만 제공합니다.');return;}
 if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return;}
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(html);
});
server.listen(Number(process.env.REVIEW_PORT||3002),'127.0.0.1',()=>console.log(`예시 데이터 검토 서버 실행: 포트 ${server.address().port}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
