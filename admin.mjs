import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {createApp} from './server.mjs';
if(!process.stdin.isTTY){console.error('Run this command in an interactive terminal.');process.exit(1);}
let muted=false;const output=new Writable({write(chunk,encoding,callback){if(!muted)process.stdout.write(chunk,encoding);callback();}});
const rl=createInterface({input:process.stdin,output,terminal:true});let app;
try{const username=(await rl.question('Admin username (letters/numbers, 3+ characters): ')).trim(),name=(await rl.question('Display name: ')).trim();process.stdout.write('Password (12+ characters, hidden): ');muted=true;const password=await rl.question('');muted=false;process.stdout.write('\n');process.stdout.write('Confirm password (hidden): ');muted=true;const confirmation=await rl.question('');muted=false;process.stdout.write('\n');if(password!==confirmation)throw Error('Passwords do not match.');app=createApp();app.initializeAdmin({username,name,password});console.log('ADMIN_CREATED: administrator registered. You can log in on the website.');}catch(e){muted=false;console.error(e.message);process.exitCode=1;}finally{rl.close();app?.db.close();}
