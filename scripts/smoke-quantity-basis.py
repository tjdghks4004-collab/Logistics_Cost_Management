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
   for kind,quantity,amount in [('legacy',7,7000),('parcel',1,3000),('box',2,1000)]:
    page.click('nav [data-view=costs]');page.click('[data-cost-tab=center]');page.click('[data-cost-workspace=entry]');page.click('[data-center-input=outbound]');page.fill('#outbound-entry [name=month]','2026-11');page.select_option('#outbound-entry [name=countKind]',kind);page.fill('[data-pair-field=amount]',str(amount));page.fill('[data-pair-field=quantity]',str(quantity));page.click('#outbound-entry button[type=submit]');page.wait_for_selector('[data-edit]')
   records=state()['costs'];assert len(records)==6;assert sum(r['amount'] for r in records)==11000
   counts=[r for r in records if r['recordType']=='count'];assert [(r['category'],r['quantity'],r['unit']) for r in counts]==[('출고 건수',7,'건'),('택배 발송 건수',1,'건'),('출고 박스 수',2,'BOX')];assert page.locator('[data-outbound-summary=true]').count()==3
   page.click('nav [data-view=dashboard]');page.click('[data-dashboard-tab=quantities]');assert page.locator('[data-quantity-kind=parcel] strong').inner_text()=='1건';assert page.locator('[data-quantity-kind=box] strong').inner_text()=='2박스';assert page.locator('[data-quantity-kind=legacy] strong').inner_text()=='7건';assert '500' in page.locator('[data-quantity-kind=box] p').inner_text();assert '3,000' in page.locator('[data-quantity-kind=parcel] p').inner_text()
   for kind,quantity in [('legacy',7),('parcel',1),('box',2)]:
    page.select_option('#dashboard-count-kind',kind);assert page.locator('.kpi .value').nth(3).inner_text()==str(quantity)+('박스' if kind=='box' else '건');assert '11,000' in page.locator('.kpi .value').first.inner_text()
   page.click('#ai-copy');page.wait_for_selector('#analysis-copy-dialog[open]');text=page.locator('#analysis-markdown').input_value();assert '# 수량 집계 기준\n출고 박스 수' in text;assert '서로 합산 금지' in text;assert '택배 발송 건수' in text;page.keyboard.press('Escape')
   page.select_option('#dashboard-count-kind','parcel');page.click('#ai-copy');assert '# 수량 집계 기준\n택배 발송 건수' in page.locator('#analysis-markdown').input_value();page.keyboard.press('Escape')
   assert state()['costs']==records
   page.locator('#category').evaluate("e=>{for(const o of e.options)o.selected=o.value==='택배비';e.dispatchEvent(new Event('change'))}");page.click('#ai-copy');assert '| 출고 박스 수 | 2 | 미등록 |' in page.locator('#analysis-markdown').input_value();page.keyboard.press('Escape');page.locator('#category').evaluate("e=>{for(const o of e.options)o.selected=o.value==='all';e.dispatchEvent(new Event('change'))}")
   box=next(r for r in counts if r['unit']=='BOX');page.click('nav [data-view=costs]');page.locator('[data-edit="'+box['id']+'"]').click();assert page.locator('#record-edit [name=category]').input_value()=='출고 박스 수';page.fill('#record-edit [name=memo]','수량 기준 보존');page.click('#record-edit button[type=submit]');page.wait_for_selector('[data-edit]');edited=next(r for r in state()['costs'] if r['id']==box['id']);assert edited['unit']=='BOX' and edited['category']=='출고 박스 수' and edited['quantity']==2
   page.click('nav [data-view=dashboard]');page.evaluate('window.scrollTo(0,0)')
   if os.environ.get('QUANTITY_SCREENSHOT'):page.screenshot(path=os.environ['QUANTITY_SCREENSHOT'],full_page=True)
   page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth')<=390
   assert not errors,errors;browser.close();print('PASS: three count bases + exact costs + compatible legacy preservation + paired summaries without mixing + scoped KPIs + matching unit costs + AI basis refresh + mobile')
  finally:
   process.terminate()
   try:process.wait(timeout=10)
   except subprocess.TimeoutExpired:process.kill();process.wait()
if __name__=='__main__':main()
