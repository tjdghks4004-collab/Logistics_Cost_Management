import {spawn} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
if(Number(process.versions.node.split('.')[0])<24){console.error('Node.js 24 이상을 설치한 뒤 다시 실행하세요.');process.exit(1);}
const {createApp}=await import('../server.mjs');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.PORT??3310);
if(!Number.isInteger(port)||port<0||port>65535){console.error('PORT는 0~65535의 정수여야 합니다.');process.exit(1);}
const app=createApp({dbPath:process.env.LOGISTICS_DB_PATH||resolve(root,'data/logistics.sqlite'),secureCookies:false});
app.server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'이 프로그램의 포트가 이미 사용 중입니다. 기존 프로그램을 종료하지 말고 PORT를 다른 번호로 지정하세요.':'서버 시작 실패: '+error.message);app.db.close();process.exitCode=1;});
app.server.listen(port,'127.0.0.1',()=>{
 const url=`http://127.0.0.1:${app.server.address().port}`;
 console.log(`SCM 물류비 관리 실행: ${url}`);
 console.log('현재 PC에서만 접속됩니다. 최초 관리자 계정은 로그인 화면에서 직접 등록하세요. 종료: Ctrl+C');
 if(process.argv.includes('--no-browser'))return;
 const command=process.platform==='win32'?['cmd',['/c','start','',url]]:process.platform==='darwin'?['open',[url]]:['xdg-open',[url]];
 const browser=spawn(command[0],command[1],{stdio:'ignore'});browser.on('error',()=>console.log('브라우저 자동 열기에 실패했습니다. 위 주소를 이 PC의 브라우저에 입력하세요.'));browser.unref();
});
let stopping=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{if(stopping)return;stopping=true;app.close().then(()=>process.exit(0));});
