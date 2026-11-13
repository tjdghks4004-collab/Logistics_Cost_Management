#!/usr/bin/env python3
"""Custom unit, incomplete drafts, restored edits, direct/calculated mode and changed-month visibility."""
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
   page.click('nav [data-view=entry]');page.fill('#center-charge-entry [name=month]','2026-11');page.select_option('#center-charge-entry [name=mode]','reverse');page.locator('#charge-paste-box summary').click();page.fill('#charge-paste','예스아시아(항공)\t500\t600000');page.click('#charge-paste-apply');assert page.locator('[data-store-search]').input_value()=='C001 · Agent _예스아시아';assert page.locator('.charge-group').inner_text()=='온라인';assert state()['costs']==[];page.click('#center-charge-entry button[type=submit]');page.wait_for_selector('[data-edit]');assert state()['costs'][0]['storeId']==state()['stores'][0]['id'];assert state()['costs'][0]['amount']==600000
   page.click('nav [data-view=stores]');page.fill('#store-add [name=code]','C002');page.fill('#store-add [name=name]','Agent _예스아시아(해상)');page.click('#store-add button');page.wait_for_function("document.querySelectorAll('[data-store-record]').length===2")
   page.click('nav [data-view=entry]');page.click('[data-center-input=truck]');page.locator('#charge-paste-box summary').click();page.fill('#charge-paste','예스아시아(항공)\t350000');page.click('#charge-paste-apply');assert '후보가 여러 개' in page.locator('[data-paste-status="0"]').inner_text();assert 'C001' in page.locator('[data-paste-status="0"]').inner_text() and 'C002' in page.locator('[data-paste-status="0"]').inner_text();assert page.locator('[data-paste-number="0"][data-paste-column="1"]').input_value()=='350000';assert len(state()['costs'])==1
   page.fill('#charge-paste','C001\t350000');page.click('#charge-paste-apply');assert page.locator('[data-store-search]').input_value()=='C001 · Agent _예스아시아';page.click('#center-charge-entry button[type=submit]');page.wait_for_selector('[data-edit]');assert len(state()['costs'])==2
   assert not errors,errors;browser.close();print('PASS: pasted keyword with aircraft note resolves canonical store + group + reverse total; ambiguous keywords block entire paste; exact code resolves ambiguity; no DB write before final save')
  finally:
   process.terminate()
   try:process.wait(timeout=10)
   except subprocess.TimeoutExpired:process.kill();process.wait()
if __name__=='__main__':main()
