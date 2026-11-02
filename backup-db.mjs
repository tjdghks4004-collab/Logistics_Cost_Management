import {DatabaseSync,backup} from 'node:sqlite';
import {existsSync,mkdirSync,chmodSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
export async function backupDatabase(source,destination){
 const src=resolve(source),dest=resolve(destination);
 if(!existsSync(src))throw Error('원본 DB가 없습니다.');if(existsSync(dest))throw Error('대상 파일이 이미 있습니다. 새 경로를 지정하세요.');
 mkdirSync(dirname(dest),{recursive:true,mode:0o700});const db=new DatabaseSync(src,{readOnly:true});
 try{await backup(db,dest);chmodSync(dest,0o600);}finally{db.close();}return dest;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const root=dirname(fileURLToPath(import.meta.url));
 try{const source=process.env.LOGISTICS_DB_PATH||resolve(root,'data/logistics.sqlite'),dest=process.argv[2]||resolve(root,'backups',`logistics-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);console.log('DB 백업 완료:',await backupDatabase(source,dest));}catch(e){console.error(e.message);process.exitCode=1;}
}
