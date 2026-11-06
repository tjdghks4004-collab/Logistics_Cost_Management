#!/usr/bin/env python3
"""Searchable stores and two-column paste -> review -> draft -> final save, disposable DB only."""
from pathlib import Path
import os,secrets,subprocess,tempfile
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
def main():
 with tempfile.TemporaryDirectory(prefix='scm-quick-') as tmp,sync_playwright() as pw:
  password=secrets.token_urlsafe(24);code="import {createApp} from './server.mjs';const a=createApp({dbPath:process.env.LOGISTICS_DB_PATH,secureCookies:false});a.initializeAdmin({username:'quickadmin',password:process.env.SCM_TEST_PASSWORD});a.server.listen(0,'127.0.0.1',()=>console.log(a.server.address().port));process.on('SIGTERM',()=>a.close().then(()=>process.exit(0)));"
  process=subprocess.Popen(['node','--input-type=module','-e',code],cwd=ROOT,env={**os.environ,'LOGISTICS_DB_PATH':str(Path(tmp)/'db.sqlite'),'SCM_TEST_PASSWORD':password},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  try:
   port=process.stdout.readline().strip();assert port.isdigit();browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox']);page=browser.new_page(viewport={'width':1440,'height':1050});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   page.add_init_script("const actualConfirm=window.confirm.bind(window);window.confirm=m=>/^(등록을|수정을) 확정하시겠습니까/.test(String(m))?true:actualConfirm(m);")
   def state():return page.evaluate("async()=>(await(await fetch('/api/state')).json()).state")
   page.goto('http://127.0.0.1:'+port);page.wait_for_selector('#login-form');page.fill('[name=username]','quickadmin');page.fill('[name=password]',password);page.click('#login-form button');page.wait_for_selector('#start-empty');page.click('#start-empty');page.wait_for_selector('.kpi')
   status=page.evaluate("""async()=>{const me=await(await fetch('/api/me')).json(),d=await(await fetch('/api/state')).json();d.state.centerMasters=[{name:'간편센터',countryCode:'KR'}];d.state.groups=[{id:'g1',name:'그룹1'},{id:'g2',name:'그룹2'}];d.state.stores=[{id:'s1',code:'0001',name:'서울점',groupId:'g1',active:true},{id:'s2',code:'00010',name:'부산점',groupId:'g2',active:true}];return(await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:JSON.stringify({revision:d.revision,state:d.state})})).status;}""");assert status==200
   page.reload();page.wait_for_selector('.kpi');page.click('nav [data-view=entry]');page.fill('#unified-entry [name=month]','2026-11')
   page.fill('[data-store-search]','0001');page.type('[data-store-search]','0');assert page.locator('[data-store-search]').input_value()=='00010';page.press('[data-store-search]','Enter');assert page.locator('[data-u=storeId]').input_value()=='s2'
   page.fill('[data-store-search]','서울점');page.press('[data-store-search]','Enter');assert page.locator('[data-u=storeId]').input_value()=='s1'
   page.locator('.quick-entry>summary').click();page.select_option('#quick-category','B2C 출고비');page.fill('#quick-text','missing\t100');assert page.locator('#quick-apply').is_disabled()
   page.fill('#quick-text','매장코드\t금액\n0001\t125,000\n부산점\t250,000');assert page.locator('#quick-apply').is_enabled();assert '375,000' in page.locator('#quick-preview').inner_text()
   if os.environ.get('QUICK_SCREENSHOT'):page.screenshot(path=os.environ['QUICK_SCREENSHOT'],full_page=True)
   page.click('#quick-apply');assert page.locator('[data-unified-row]').count()==2;assert state()['costs']==[];assert page.locator('[data-unified-row="1"] [data-u=storeId]').input_value()=='s2'
   page.click('[data-draft-save]');page.wait_for_function("document.querySelector('[data-draft-message]').textContent.includes('임시 저장했습니다')")
   page.once('dialog',lambda d:d.accept());page.reload();page.wait_for_selector('.kpi');page.click('nav [data-view=entry]');page.once('dialog',lambda d:d.accept());page.click('[data-draft-load]');page.wait_for_function('document.querySelectorAll("[data-unified-row]").length===2');page.click('#unified-entry button[type=submit]');page.wait_for_selector('[data-edit]');assert len(state()['costs'])==2 and sum(r['amount'] for r in state()['costs'])==375000
   page.click('nav [data-view=entry]');page.fill('#unified-entry [name=month]','2026-11');page.locator('.quick-entry>summary').click();page.select_option('#quick-type','count');page.select_option('#quick-account','B2B');page.fill('#quick-text','0001\t100\n00010\t50');page.click('#quick-apply');page.click('#unified-entry button[type=submit]');page.wait_for_selector('[data-edit]')
   s=state();assert len(s['costs'])==4 and sum(r['amount'] for r in s['costs'])==375000;assert sum(r['quantity'] for r in s['costs'] if r['recordType']=='count')==150
   page.click('nav [data-view=dashboard]');assert page.locator('.kpi .value').first.inner_text()=='₩375,000' and page.locator('.kpi .value').nth(3).inner_text()=='150건'
   page.set_viewport_size({'width':390,'height':844});page.click('nav [data-view=entry]');assert page.evaluate('document.documentElement.scrollWidth')<=390
   assert not errors,errors;browser.close();print('PASS: store search by code/name + prefix safety + two-column cost/count paste + validation + preview + server drafts + final totals + mobile')
  finally:
   process.terminate()
   try:process.wait(timeout=10)
   except subprocess.TimeoutExpired:process.kill();process.wait()
if __name__=='__main__':main()
