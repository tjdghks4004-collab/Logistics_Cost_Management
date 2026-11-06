#!/usr/bin/env python3
"""Real substring results and native cancel/confirm; Enter in fields never persists financial records."""
from pathlib import Path
import os,secrets,subprocess,tempfile
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
def main():
 with tempfile.TemporaryDirectory(prefix='scm-search-confirm-') as tmp,sync_playwright() as pw:
  password=secrets.token_urlsafe(24);code="import {createApp} from './server.mjs';const a=createApp({dbPath:process.env.LOGISTICS_DB_PATH,secureCookies:false});a.initializeAdmin({username:'searchadmin',password:process.env.SCM_TEST_PASSWORD});a.server.listen(0,'127.0.0.1',()=>console.log(a.server.address().port));process.on('SIGTERM',()=>a.close().then(()=>process.exit(0)));"
  p=subprocess.Popen(['node','--input-type=module','-e',code],cwd=ROOT,env={**os.environ,'LOGISTICS_DB_PATH':str(Path(tmp)/'db.sqlite'),'SCM_TEST_PASSWORD':password},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  try:
   port=p.stdout.readline().strip();assert port.isdigit();b=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox']);page=b.new_page(viewport={'width':1440,'height':1050});errors=[];page.on('pageerror',lambda e:errors.append(str(e)));dialogs=[];accept=[False]
   def handle(d):dialogs.append(d.message);d.accept() if accept[0] else d.dismiss()
   page.on('dialog',handle)
   def state():return page.evaluate("async()=>(await(await fetch('/api/state')).json()).state")
   page.goto('http://127.0.0.1:'+port);page.wait_for_selector('#login-form');page.fill('[name=username]','searchadmin');page.fill('[name=password]',password);page.click('#login-form button');page.wait_for_selector('#start-empty');page.click('#start-empty');page.wait_for_selector('.kpi')
   assert page.evaluate("""async()=>{const me=await(await fetch('/api/me')).json(),d=await(await fetch('/api/state')).json();d.state.centerMasters=[{name:'동탄센터',countryCode:'KR'}];d.state.groups=[{id:'g1',name:'온라인'}];d.state.stores=[{id:'s1',code:'C100',name:'마켓컬리',groupId:'g1',active:true},{id:'s2',code:'C101',name:'컬리 온라인',groupId:'g1',active:true},{id:'s3',code:'C102',name:'네이버',groupId:'g1',active:true}];return(await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:JSON.stringify({revision:d.revision,state:d.state})})).status;}""")==200
   page.reload();page.wait_for_selector('.kpi');page.click('nav [data-view=entry]');page.click('[data-center-input=outbound]');page.fill('#outbound-entry [name=month]','2026-11')
   page.fill('[data-store-search]','컬리');assert page.locator('#store-search-results [role=option]').count()==2;assert '마켓컬리' in page.locator('#store-search-results').inner_text() and '네이버' not in page.locator('#store-search-results').inner_text()
   if os.environ.get('SEARCH_SCREENSHOT'):page.screenshot(path=os.environ['SEARCH_SCREENSHOT'])
   page.locator('[data-store-search]').focus();page.fill('[data-store-search]','컬리')
   page.locator('#store-search-results [role=option]').filter(has_text='마켓컬리').click();assert page.locator('[data-pair-store]').input_value()=='s1'
   page.fill('[data-pair-field=amount]','10000');page.fill('[data-pair-field=quantity]','10');page.press('[data-pair-field=quantity]','Enter');assert dialogs==[] and state()['costs']==[]
   page.click('#outbound-entry button[type=submit]');assert len(dialogs)==1 and '등록을 확정하시겠습니까' in dialogs[0] and '10,000' in dialogs[0];assert state()['costs']==[] and page.locator('[data-pair-field=amount]').input_value()=='10000'
   accept[0]=True;page.click('#outbound-entry button[type=submit]');page.wait_for_selector('[data-outbound-summary=true]');assert len(state()['costs'])==2 and sum(r['amount'] for r in state()['costs'])==10000
   fee=next(r for r in state()['costs'] if r['recordType']=='cost');page.click('[data-edit="'+fee['id']+'"]');page.fill('#record-edit [name=amount]','15000');before=len(dialogs);page.press('#record-edit [name=amount]','Enter');assert len(dialogs)==before and state()['costs'][0]['amount']==10000
   accept[0]=False;page.click('#record-edit button[type=submit]');assert '수정을 확정하시겠습니까' in dialogs[-1] and state()['costs'][0]['amount']==10000
   accept[0]=True;page.click('#record-edit button[type=submit]');page.wait_for_selector('#record-edit',state='detached');assert state()['costs'][0]['amount']==15000 and len(state()['costs'])==2
   page.locator('[data-multi=store]>summary').click();page.fill('[data-multi=store] .filter-search','컬리');labels=page.locator('[data-multi=store] .category-children label:not([hidden])').all_text_contents();assert any('마켓컬리' in t for t in labels) and any('컬리 온라인' in t for t in labels) and not any('네이버' in t for t in labels)
   page.locator('[data-multi=center]>summary').click();page.fill('[data-multi=center] .filter-search','탄센');assert any('동탄센터' in t for t in page.locator('[data-multi=center] .multi-options>label:not([hidden])').all_text_contents())
   page.fill('#cost-query','컬리');assert page.locator('[data-outbound-summary=true]').count()==1
   page.set_viewport_size({'width':390,'height':844});page.click('nav [data-view=entry]');page.fill('[data-store-search]','컬리');assert page.locator('#store-search-results [role=option]').count()==2;assert page.evaluate('document.documentElement.scrollWidth')<=390
   assert not errors,errors;b.close();print('PASS: substring store suggestions + code/group/category filters + no Enter submission + native confirmation cancel/accept + edit cancellation + totals + mobile')
  finally:
   p.terminate()
   try:p.wait(timeout=10)
   except subprocess.TimeoutExpired:p.kill();p.wait()
if __name__=='__main__':main()
