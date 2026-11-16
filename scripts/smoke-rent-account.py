#!/usr/bin/env python3
"""One editable sheet, automatic drafts, fixed cost columns, details and mobile layout."""
from pathlib import Path
import os,secrets,subprocess,tempfile,csv,io
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
def main():
 with tempfile.TemporaryDirectory(prefix='scm-draft-ui-') as tmp,sync_playwright() as pw:
  password=secrets.token_urlsafe(24)
  code="import {createApp} from './server.mjs';const app=createApp({dbPath:process.env.LOGISTICS_DB_PATH,secureCookies:false});app.initializeAdmin({username:'draftadmin',password:process.env.SCM_TEST_PASSWORD});app.server.listen(0,'127.0.0.1',()=>console.log(app.server.address().port));process.on('SIGTERM',()=>app.close().then(()=>process.exit(0)));"
  process=subprocess.Popen(['node','--input-type=module','-e',code],cwd=ROOT,env={**os.environ,'LOGISTICS_DB_PATH':str(Path(tmp)/'test.sqlite'),'SCM_TEST_PASSWORD':password},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  try:
   port=process.stdout.readline().strip();assert port.isdigit();browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox']);page=browser.new_page(viewport={'width':1440,'height':1050});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   page.add_init_script("const actualConfirm=window.confirm.bind(window);window.confirm=m=>/^(등록을|수정을) 확정하시겠습니까/.test(String(m))?true:actualConfirm(m);")
   def state():return page.evaluate("async()=>(await(await fetch('/api/state')).json()).state")
   def drafts():return page.evaluate("async()=>(await(await fetch('/api/drafts')).json()).drafts")
   page.goto('http://127.0.0.1:'+port);page.wait_for_selector('#login-form');page.fill('[name=username]','draftadmin');page.fill('[name=password]',password);page.click('#login-form button');page.wait_for_selector('#start-empty');page.click('#start-empty');page.wait_for_selector('.kpi')
   page.click('nav [data-view=locations]');page.fill('#center-add [name=name]','임시저장센터');page.click('#center-add button');page.wait_for_selector('[data-center-country]')
   page.click('nav [data-view=stores]');page.fill('#group-add [name=name]','온라인');page.click('#group-add button');page.wait_for_function("document.querySelector('#store-add [name=groupId]').options.length>0");page.fill('#store-add [name=code]','C001');page.fill('#store-add [name=name]','Agent _예스아시아');page.click('#store-add button');page.wait_for_selector('[data-store-record]')
   # Seed an actual historical B2C row, then ensure every new form leaves it intact.
   code="""async()=>{const me=await(await fetch('/api/me')).json(),d=await(await fetch('/api/state')).json();d.state.costs.push({id:'legacy-b2c',month:'2026-11',domain:'center',recordType:'cost',countryCode:'KR',center:'임시저장센터',account:'B2C',storeId:'',groupId:'',category:'B2C 출고비',unit:'원',quantity:null,price:null,amount:50,memo:'기존 자료'});return(await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:JSON.stringify({revision:d.revision,state:d.state})})).status;}""";assert page.evaluate(code)==200;page.reload();page.wait_for_selector('.kpi');legacy=state()['costs'][0]
   def entry(tab):
    page.click('nav [data-view=costs]');page.click('[data-cost-tab=center]');page.click('[data-cost-workspace=entry]');page.click('[data-center-input='+tab+']')
   entry('box');assert page.locator('#center-charge-entry select[name=account]').count()==0;page.fill('#center-charge-entry [name=month]','2026-11');page.fill('[data-charge-field=quantity]','2');page.fill('[data-charge-field=price]','100');page.click('#center-charge-entry button[type=submit]');page.wait_for_selector('[data-edit]');box=state()['costs'][-1];assert box['category']=='박스 출고비' and box['account']=='공통' and box['amount']==200
   entry('rent');assert page.locator('#rent-entry select[name=account],#rent-entry [data-store-search]').count()==0;page.fill('#rent-entry [name=month]','2026-11');page.fill('#rent-entry [name=amount]','1000');page.fill('#rent-entry [name=memo]','11월 계약 임차료');page.wait_for_function("document.querySelector('[data-draft-message]').textContent.includes('자동 임시 저장 완료')");assert len(state()['costs'])==2
   page.click('[data-center-input=box]');assert page.locator('#center-charge-entry select[name=account]').count()==0;page.click('[data-center-input=rent]');assert page.locator('#rent-entry [name=amount]').input_value()=='1000'
   page.once('dialog',lambda d:d.accept());page.reload();page.wait_for_selector('.kpi');entry('rent');page.once('dialog',lambda d:d.accept());page.click('[data-draft-load]');page.wait_for_function("document.querySelector('#rent-entry [name=amount]').value==='1000'");page.click('#rent-entry button[type=submit]');page.wait_for_selector('[data-edit]');rent=state()['costs'][-1];assert rent['category']=='지급임차료' and rent['account']=='공통' and rent['storeId']=='' and rent['amount']==1000;assert state()['costs'][0]==legacy
   entry('rent');page.fill('#rent-entry [name=month]','2026-11');page.fill('#rent-entry [name=amount]','1000');page.fill('#rent-entry [name=memo]','11월 계약 임차료');page.click('#rent-entry button[type=submit]');assert page.locator('#rent-error').inner_text();assert len(state()['costs'])==3
   page.click('[data-cost-workspace=list]');page.locator('[data-edit="'+rent['id']+'"]').click();assert page.locator('#record-edit select[name=account]').count()==0;page.fill('#record-edit [name=amount]','1100');page.click('#record-edit button[type=submit]');page.wait_for_selector('[data-edit]');assert next(r for r in state()['costs'] if r['id']==rent['id'])['amount']==1100
   # Old B2C drafts resume under their original category, without becoming generic.
   payload={'kind':'center-charges','draft':{'type':'box','month':'2026-11','center':'임시저장센터','account':'B2C','mode':'amount','unit':'BOX','category':'B2C 출고비','rows':[{'storeId':'','amount':'80','memo':'기존 임시본'}],'paste':''}}
   assert page.evaluate("""async data=>{const me=await(await fetch('/api/me')).json();return(await fetch('/api/drafts',{method:'PUT',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:JSON.stringify({slot:'entry:charges:box',data})})).status;}""",payload)==200
   page.once('dialog',lambda d:d.accept());page.reload();page.wait_for_selector('.kpi');entry('box');page.once('dialog',lambda d:d.accept());page.click('[data-draft-load]');page.wait_for_function("document.querySelector('[data-charge-field=amount]')?.value==='80'");assert '기존 업무: B2C' in page.locator('#center-charge-entry').inner_text();assert page.locator('#center-charge-entry select[name=account]').count()==0;page.click('#center-charge-entry button[type=submit]');page.wait_for_selector('[data-edit]');assert state()['costs'][-1]['category']=='B2C 출고비' and state()['costs'][-1]['account']=='B2C';assert state()['costs'][0]==legacy
   entry('rent');page.evaluate('window.scrollTo(0,0)')
   if os.environ.get('RENT_SCREENSHOT'):page.screenshot(path=os.environ['RENT_SCREENSHOT'],full_page=True)
   page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth')<=390
   assert not errors,errors;browser.close();print('PASS: no business selectors + generic new box costs + monthly rent draft/tab persistence/reload/save/edit/duplicate rejection + historical B2C row and draft preservation + mobile')
  finally:
   process.terminate()
   try:process.wait(timeout=10)
   except subprocess.TimeoutExpired:process.kill();process.wait()
if __name__=='__main__':main()
