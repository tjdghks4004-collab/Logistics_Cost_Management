#!/usr/bin/env python3
"""Custom unit, incomplete drafts, restored edits, direct/calculated mode and changed-month visibility."""
from pathlib import Path
import os,secrets,subprocess,tempfile
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
   page.click('nav [data-view=masters]');page.fill('#billing-unit-form [name=unit]','40FT');page.click('#billing-unit-form button');page.wait_for_function("[...document.querySelectorAll('.unit-chips span')].some(e=>e.textContent==='40FT')")
   master=page.locator('tbody tr').filter(has=page.get_by_text('B2C 출고비',exact=True))
   with page.expect_response(lambda r:r.url.endswith('/api/state') and r.request.method=='PUT'):master.locator('[data-master-unit]').select_option('40FT')
   page.click('nav [data-view=entry]');page.fill('#unified-entry [name=month]','2026-11');page.select_option('[data-u=category]','B2C 출고비');assert page.locator('[data-u=unit]').input_value()=='40FT';page.fill('[data-u=quantity]','12')
   page.click('#unified-entry [data-draft-save]');page.wait_for_function("document.querySelector('[data-draft-message]').textContent.includes('임시 저장했습니다')");assert state()['costs']==[] and len(drafts())==1
   page.once('dialog',lambda d:d.accept());page.reload();page.wait_for_selector('.kpi');page.click('nav [data-view=entry]');page.once('dialog',lambda d:d.accept());page.click('[data-draft-load]');page.wait_for_function("document.querySelector('[data-u=quantity]').value==='12'");assert page.locator('[data-u=quantity]').input_value()=='12';assert page.locator('[data-u=price]').input_value()==''
   page.fill('[data-u=price]','500');page.click('#unified-entry button[type=submit]');page.wait_for_selector('[data-edit]');assert state()['costs'][0]['amount']==6000 and state()['costs'][0]['unit']=='40FT';assert drafts()==[];cost_id=state()['costs'][0]['id']
   page.click('[data-edit]');assert page.locator('#record-edit [name=amount]').is_disabled();page.fill('#record-edit [name=price]','600');assert page.locator('#record-edit [name=amount]').input_value()=='7200'
   page.click('#record-edit [data-draft-save]');page.wait_for_function("document.querySelector('[data-draft-message]').textContent.includes('임시 저장했습니다')");assert state()['costs'][0]['amount']==6000
   page.once('dialog',lambda d:d.accept());page.reload();page.wait_for_selector('.kpi');page.click('nav [data-view=costs]');page.click('[data-edit]');page.once('dialog',lambda d:d.accept());page.click('#record-edit [data-draft-load]');page.wait_for_function("document.querySelector('#record-edit [name=price]').value==='600'");assert page.locator('#record-edit [name=price]').input_value()=='600'
   page.click('#record-edit button[type=submit]');page.wait_for_selector('#record-edit',state='detached');assert state()['costs'][0]['amount']==7200 and state()['costs'][0]['id']==cost_id and len(state()['costs'])==1 and drafts()==[]
   page.click('[data-edit]');page.select_option('#record-edit [name=mode]','amount');assert page.locator('#record-edit [name=quantity]').is_disabled() and page.locator('#record-edit [name=price]').is_disabled();page.fill('#record-edit [name=amount]','9000');page.fill('#record-edit [name=month]','2026-12');page.click('#record-edit button[type=submit]');page.wait_for_selector('#record-edit',state='detached')
   assert state()['costs'][0]['amount']==9000 and state()['costs'][0]['quantity'] is None;assert page.locator('[data-edit]').count()==1 and '2026-12' in page.locator('#cost-records-table').inner_text()
   with page.expect_download() as download:page.click('#template')
   template=Path(tmp)/'custom-units.xlsx';download.value.save_as(str(template));subprocess.run(['node','--input-type=module','-e',"import ExcelJS from 'exceljs';const w=new ExcelJS.Workbook();await w.xlsx.readFile(process.argv[1]);if(!w.getWorksheet('기준정보').getColumn(7).values.includes('40FT'))throw Error('Missing custom unit');",str(template)],cwd=ROOT,check=True,capture_output=True)
   page.reload();page.wait_for_selector('.kpi');assert page.locator('.kpi .value').first.inner_text()=='₩9,000'
   if os.environ.get('DRAFT_SCREENSHOT'):page.screenshot(path=os.environ['DRAFT_SCREENSHOT'],full_page=True)
   page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth')<=390
   assert not errors,errors;browser.close();print('PASS: custom units + Excel units + incomplete server drafts + reload/resume + edit draft + calculated/direct edits + changed-month visibility + persistence + mobile')
  finally:
   process.terminate()
   try:process.wait(timeout=10)
   except subprocess.TimeoutExpired:process.kill();process.wait()
if __name__=='__main__':main()
