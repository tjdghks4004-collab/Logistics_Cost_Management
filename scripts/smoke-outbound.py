#!/usr/bin/env python3
"""Existing outbound fee/count summary, source editing, compact entry/draft and three-column paste."""
from pathlib import Path
import os,secrets,subprocess,tempfile
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
def main():
 with tempfile.TemporaryDirectory(prefix='scm-outbound-') as tmp,sync_playwright() as pw:
  password=secrets.token_urlsafe(24);code="import {createApp} from './server.mjs';const a=createApp({dbPath:process.env.LOGISTICS_DB_PATH,secureCookies:false});a.initializeAdmin({username:'outadmin',password:process.env.SCM_TEST_PASSWORD});a.server.listen(0,'127.0.0.1',()=>console.log(a.server.address().port));process.on('SIGTERM',()=>a.close().then(()=>process.exit(0)));"
  p=subprocess.Popen(['node','--input-type=module','-e',code],cwd=ROOT,env={**os.environ,'LOGISTICS_DB_PATH':str(Path(tmp)/'db.sqlite'),'SCM_TEST_PASSWORD':password},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  try:
   port=p.stdout.readline().strip();assert port.isdigit();b=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox']);page=b.new_page(viewport={'width':1440,'height':1050});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   def state():return page.evaluate("async()=>(await(await fetch('/api/state')).json()).state")
   page.goto('http://127.0.0.1:'+port);page.wait_for_selector('#login-form');page.fill('[name=username]','outadmin');page.fill('[name=password]',password);page.click('#login-form button');page.wait_for_selector('#start-empty');page.click('#start-empty');page.wait_for_selector('.kpi')
   status=page.evaluate("""async()=>{const me=await(await fetch('/api/me')).json(),d=await(await fetch('/api/state')).json();d.state.centerMasters=[{name:'요약센터',countryCode:'KR'}];d.state.groups=[{id:'g1',name:'온라인'}];d.state.stores=[{id:'s1',code:'C02833',name:'온라인점',groupId:'g1',active:true},{id:'s2',code:'C2',name:'두번째점',groupId:'g1',active:true}];d.state.masters.push({name:'수도광열비',unit:'일괄',active:true});const row={month:'2026-10',center:'요약센터',countryCode:'KR',domain:'center',recordType:'cost',account:'공통',storeId:'',groupId:'',unit:'원',quantity:null,price:null,memo:''};d.state.costs=[{...row,id:'rent',category:'지급임차료',amount:65913600},{...row,id:'utility',category:'수도광열비',amount:2640864},{...row,id:'fee',category:'B2C 출고비',account:'B2C',storeId:'s1',groupId:'g1',amount:17244352},{...row,id:'count',category:'B2C 출고 건수',account:'B2C',storeId:'s1',groupId:'g1',recordType:'count',unit:'건',quantity:6623,amount:0}];return(await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:JSON.stringify({revision:d.revision,state:d.state})})).status;}""");assert status==200
   page.reload();page.wait_for_selector('.kpi');page.click('nav [data-view=costs]');page.click('[data-cost-tab=center]');assert page.locator('#cost-records-table tbody tr').count()==3;assert page.locator('[data-outbound-summary=true]').count()==1;assert '17,244,352' in page.locator('[data-outbound-summary=true]').inner_text() and '6,623건' in page.locator('[data-outbound-summary=true]').inner_text();assert len(state()['costs'])==4
   if os.environ.get('OUTBOUND_SCREENSHOT'):page.screenshot(path=os.environ['OUTBOUND_SCREENSHOT']+'-summary.png',full_page=True)
   page.click('[data-cost-layout=rows]');assert page.locator('#cost-records-table tbody tr').count()==4;page.click('[data-cost-layout=summary]')
   page.click('[data-edit=fee]');page.fill('#record-edit [name=amount]','17300000');page.click('#record-edit button[type=submit]');page.wait_for_selector('#record-edit',state='detached');assert state()['costs'][2]['amount']==17300000 and state()['costs'][3]['quantity']==6623
   page.click('nav [data-view=entry]');page.click('[data-center-input=outbound]');page.fill('#outbound-entry [name=month]','2026-11');page.select_option('#outbound-entry [name=account]','B2B');page.fill('[data-store-search]','C02833');page.press('[data-store-search]','Enter');page.fill('[data-pair-field=amount]','50000');page.fill('[data-pair-field=quantity]','100');assert page.locator('[data-pair-unit]').inner_text()=='₩500'
   if os.environ.get('OUTBOUND_SCREENSHOT'):page.screenshot(path=os.environ['OUTBOUND_SCREENSHOT']+'-entry.png',full_page=True)
   page.click('[data-draft-save]');page.wait_for_function("document.querySelector('[data-draft-message]').textContent.includes('임시 저장했습니다')");assert len(state()['costs'])==4
   page.once('dialog',lambda d:d.accept());page.reload();page.wait_for_selector('.kpi');page.click('nav [data-view=entry]');page.click('[data-center-input=outbound]');page.once('dialog',lambda d:d.accept());page.click('[data-draft-load]');page.wait_for_function("document.querySelector('[data-pair-field=quantity]').value==='100'");page.click('#outbound-entry button[type=submit]');page.wait_for_selector('[data-outbound-summary=true]');assert len(state()['costs'])==6;assert page.locator('#cost-records-table tbody tr').count()==1
   page.click('nav [data-view=dashboard]');assert page.locator('.kpi .value').first.inner_text()=='₩50,000' and page.locator('.kpi .value').nth(3).inner_text()=='100건'
   page.click('nav [data-view=entry]');page.fill('#outbound-entry [name=month]','2026-12');page.locator('.quick-entry>summary').click();page.fill('#outbound-paste','C02833\t125,000\t500\nC2\t0\t0');page.click('#outbound-paste-apply');assert page.locator('[data-pair-row]').count()==2;page.click('#outbound-entry button[type=submit]');page.wait_for_selector('[data-outbound-summary=true]');assert page.locator('#cost-records-table tbody tr').count()==2 and len(state()['costs'])==10
   page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth')<=390;assert not errors,errors;b.close();print('PASS: preserved original rows + paired summary + raw toggle + source edit + one-row fee/count entry + draft/resume + three-column paste + exact totals + mobile')
  finally:
   p.terminate()
   try:p.wait(timeout=10)
   except subprocess.TimeoutExpired:p.kill();p.wait()
if __name__=='__main__':main()
