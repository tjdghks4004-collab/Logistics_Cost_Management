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
   page.click('nav [data-view=costs]');page.locator('#operational-controls summary').click()
   def upload(amount,month='2026-11'):
    with page.expect_download() as download:page.click('#csv-template')
    path=Path(tmp)/'template.csv';download.value.save_as(str(path));headers=next(csv.reader(io.StringIO(path.read_text(encoding='utf-8-sig'))))
    values={'월':month,'비용유형':'물류센터','데이터유형':'비용','국가코드':'KR','센터':'임시저장센터','업무구분':'B2C','비용항목':'B2C 출고비','청구단위':'원','값':str(amount)}
    out=io.StringIO();writer=csv.writer(out);writer.writerow(headers);writer.writerow([values.get(h,'') for h in headers]);file=Path(tmp)/('upload-'+str(amount)+'.csv');file.write_text(out.getvalue(),encoding='utf-8-sig');page.set_input_files('#file',str(file));page.wait_for_selector('#commit-import');assert page.locator('#commit-import').is_enabled(),page.locator('#upload-review').inner_text();page.click('#commit-import');page.wait_for_selector('#commit-import',state='detached')
   upload(100)
   assert len(state()['importBatches'])==1 and state()['costs'][0]['amount']==100
   page.locator('#operational-controls summary').click();page.fill('#reconcile-form [name=reference]','11월 청구서');page.fill('#reconcile-form [name=expected]','100');page.once('dialog',lambda d:d.accept());page.click('#reconcile-form button');page.wait_for_function("document.querySelector('[data-check-delete]')!==null")
   assert '일치' in page.locator('#operational-controls').inner_text()
   page.fill('#period-form [name=month]','2026-11');page.fill('#period-form [name=reason]','청구 확인 완료');page.once('dialog',lambda d:d.accept());page.click('#period-form button');page.wait_for_function("document.querySelector('#operational-controls').textContent.includes('마감된 월: 2026-11')")
   page.click('[data-edit]');page.fill('#record-edit [name=amount]','120');page.click('#record-edit button[type=submit]');page.wait_for_function("document.querySelector('#edit-error').textContent.includes('마감')");assert state()['costs'][0]['amount']==100;page.once('dialog',lambda d:d.accept());page.click('#cancel-edit')
   page.once('dialog',lambda d:d.accept('잘못 등록'));page.click('[data-batch-cancel]');page.wait_for_function("document.querySelector('#operational-error').textContent.includes('마감')");assert len(state()['costs'])==1
   page.select_option('#period-form [name=action]','reopen');page.fill('#period-form [name=reason]','정정 필요');page.once('dialog',lambda d:d.accept());page.click('#period-form button');page.wait_for_function("document.querySelector('#operational-controls').textContent.includes('마감된 월: 없음')")
   dialogs=[]
   def cancel_dialog(dialog):
    dialogs.append(dialog.type);dialog.accept('등록 오류') if dialog.type=='prompt' else dialog.accept()
   page.on('dialog',cancel_dialog);page.click('[data-batch-cancel]');page.wait_for_function("document.querySelector('#operational-controls').textContent.includes('취소됨')");page.remove_listener('dialog',cancel_dialog)
   assert dialogs==['prompt','confirm'];assert state()['costs']==[];assert state()['importBatches'][0]['cancelled']['reason']=='등록 오류';assert '누락 1건' in page.locator('#operational-controls').inner_text()
   page.select_option('#period-form [name=action]','close');page.fill('#period-form [name=reason]','재확인');page.once('dialog',lambda d:d.accept());page.click('#period-form button');page.wait_for_function("document.querySelector('#operational-error').textContent.includes('차액')")
   page.reload();page.wait_for_selector('.kpi');page.click('nav [data-view=costs]');page.locator('#operational-controls summary').click();assert '취소됨' in page.locator('#operational-controls').inner_text()
   page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth')<=390
   assert not errors,errors;browser.close();print('PASS: cost file import provenance + live reconciliation + close/reopen + locked cancellation rejection + cancellation evidence + missing-reference close rejection + reload + mobile')
  finally:
   process.terminate()
   try:process.wait(timeout=10)
   except subprocess.TimeoutExpired:process.kill();process.wait()
if __name__=='__main__':main()
