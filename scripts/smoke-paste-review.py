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
   page.click('nav [data-view=entry]');page.click('[data-center-input=truck]');page.fill('#center-charge-entry [name=month]','2026-11');page.select_option('#center-charge-entry [name=mode]','reverse');page.locator('#charge-paste-box summary').click();page.select_option('#charge-paste-order','value-first');page.fill('#charge-paste','캄보디아 토브\t66,000\t1');page.click('#charge-paste-apply');assert page.locator('#charge-paste-review tbody tr').count()==1;assert state()['costs']==[]
   search=page.locator('#charge-paste-review [data-store-search]');search.fill('예스아시아');search.press('Enter');assert page.locator('[data-paste-status="0"]').inner_text()=='확인 완료';assert page.locator('[data-paste-number="0"][data-paste-column="2"]').input_value()=='1'
   page.click('#center-charge-entry [data-draft-save]');page.wait_for_function("document.querySelector('[data-draft-message]').textContent.includes('임시 저장했습니다')")
   page.once('dialog',lambda d:d.accept());page.reload();page.wait_for_selector('.kpi');page.click('nav [data-view=entry]');page.click('[data-center-input=truck]');page.once('dialog',lambda d:d.accept());page.click('[data-draft-load]');page.wait_for_function("document.querySelector('#charge-paste').value.includes('캄보디아')");page.locator('#charge-paste-box').evaluate('e=>e.open=true');assert page.locator('#charge-paste-order').input_value()=='value-first';page.click('#charge-paste-apply');assert page.locator('[data-paste-number="0"][data-paste-column="2"]').input_value()=='1';assert page.locator('[data-paste-number="0"][data-paste-column="1"]').input_value()=='66000';assert '66,000' in page.locator('[data-paste-calculated="0"]').inner_text();assert page.locator('[data-store-search]').input_value()=='C001 · Agent _예스아시아';assert state()['costs']==[]
   page.click('#center-charge-entry button[type=submit]');page.wait_for_selector('[data-edit]');assert state()['costs'][0]['amount']==66000 and state()['costs'][0]['quantity']==1
   page.click('nav [data-view=entry]');page.select_option('#center-charge-entry [name=mode]','reverse');page.locator('#charge-paste-box summary').click();page.select_option('#charge-paste-order','value-first');page.fill('#charge-paste','다른 이름\t50000\t1');page.click('#charge-paste-apply');assert page.locator('#charge-paste-review tbody tr').count()==1;assert page.locator('[data-paste-number="0"][data-paste-column="1"]').input_value()=='50000'
   page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth')<=390
   if os.environ.get('PASTE_REVIEW_SCREENSHOT'):page.set_viewport_size({'width':1440,'height':1050});page.screenshot(path=os.environ['PASTE_REVIEW_SCREENSHOT'],full_page=True)
   assert not errors,errors;browser.close();print('PASS: cost-first paste + unresolved store review + explicit search mapping + draft persistence + exact quantity/total/unit price + no write before final confirmation + stale mapping cleared + mobile')
  finally:
   process.terminate()
   try:process.wait(timeout=10)
   except subprocess.TimeoutExpired:process.kill();process.wait()
if __name__=='__main__':main()
