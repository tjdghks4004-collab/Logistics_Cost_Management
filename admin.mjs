import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {createApp} from './server.mjs';
if(!process.stdin.isTTY){console.error('비밀번호를 숨겨 입력할 수 있는 대화형 터미널에서 실행하세요.');process.exit(1);}
let muted=false;const output=new Writable({write(chunk,encoding,callback){if(!muted)process.stdout.write(chunk,encoding);callback();}});
const rl=createInterface({input:process.stdin,output,terminal:true});let app;
try{const username=(await rl.question('관리자 아이디: ')).trim(),name=(await rl.question('이름: ')).trim();process.stdout.write('비밀번호 (12자 이상, 화면에 표시 안 됨): ');muted=true;const password=await rl.question('');muted=false;process.stdout.write('\n');process.stdout.write('비밀번호 확인: ');muted=true;const confirmation=await rl.question('');muted=false;process.stdout.write('\n');if(password!==confirmation)throw Error('비밀번호가 일치하지 않습니다.');app=createApp();app.initializeAdmin({username,name,password});console.log('관리자 등록 완료. 사이트에서 로그인하세요.');}catch(e){muted=false;console.error(e.message);process.exitCode=1;}finally{rl.close();app?.db.close();}
