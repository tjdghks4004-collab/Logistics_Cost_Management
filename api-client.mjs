export let session=null,revision=0;
export async function api(path,options={}){
 const res=await fetch('/api/'+path,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(session?{'X-CSRF-Token':session.csrf}:{}),...options.headers}});
 const data=await res.json();if(!res.ok){const error=Error(data.error||'요청에 실패했습니다.');error.status=res.status;throw error;}return data;
}
try{session=await api('me');}catch{location.replace('/login.html');await new Promise(()=>{});}
export async function loadWorkspace(seed){
 const data=await api('state');revision=data.revision;if(data.state)return {state:data.state,initialize:false};
 const main=document.querySelector('#content');
 if(session.user.role!=='admin'){main.innerHTML='<section class="card panel"><h2>관리자의 초기 자료 설정을 기다리고 있습니다.</h2><p>초기 설정 후 새로고침하세요.</p></section>';await new Promise(()=>{});}
 const sample=await new Promise(resolve=>{main.innerHTML='<section class="card panel"><h2>처음 시작하기</h2><div class="notice">서버에 자료가 없습니다. 예시 데이터로 기능을 검증하거나 빈 자료로 시작하세요. 기존 브라우저 자료는 자동 업로드하지 않습니다.</div><div class="toolbar"><button id="start-sample" class="primary">예시 데이터로 시작</button><button id="start-empty">빈 자료로 시작</button></div></section>';document.querySelector('#start-sample').onclick=()=>resolve(true);document.querySelector('#start-empty').onclick=()=>resolve(false);});
 return {state:sample?seed():{costs:[],activity:[],notes:[],groups:[],stores:[],countries:[{code:'KR',name:'대한민국'}],centerMasters:[],masters:[{name:'포워딩',unit:'일괄',active:true},{name:'관세',unit:'일괄',active:true}]},initialize:true};
}
export async function persist(next){const result=await api('state',{method:'PUT',body:JSON.stringify({revision,state:next})});revision=result.revision;return result;}
