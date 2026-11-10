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
   page.click('nav [data-view=stores]');page.fill('#group-add [name=name]','온라인');page.click('#group-add button');page.wait_for_function("document.querySelector('#store-add [name=groupId]').options.length>0");page.fill('#store-add [name=code]','C001');page.fill('#store-add [name=name]','마켓컬리');page.click('#store-add button');page.wait_for_selector('[data-store-record]')
   page.click('nav [data-view=entry]');assert page.locator('nav [data-view=tradeReport],nav [data-view=commonEntry]').count()==0;assert page.locator('nav [data-view=entry]').inner_text()=='비용 관리'
   assert page.locator('[data-center-input=box]').get_attribute('aria-selected')=='true'
   page.fill('#center-charge-entry [name=month]','2026-11');page.select_option('#center-charge-entry [name=account]','B2B');page.fill('[data-store-search]','컬리');page.press('[data-store-search]','Enter');page.fill('[data-charge-field=quantity]','500');page.fill('[data-charge-field=price]','1200');assert page.locator('#charge-total').inner_text()=='₩600,000'
   page.click('[data-center-input=truck]');assert page.locator('#center-charge-entry [name=month]').input_value()=='2026-11';assert page.locator('[data-charge-field=quantity]').count()==0;page.fill('[data-store-search]','C001');page.press('[data-store-search]','Enter');page.fill('[data-charge-field=amount]','350000')
   page.click('[data-center-input=box]');assert page.locator('[data-charge-field=quantity]').input_value()=='500';page.click('#center-charge-entry [data-draft-save]');page.wait_for_function("document.querySelector('[data-draft-message]').textContent.includes('임시 저장했습니다')")
   page.click('#center-charge-entry button[type=submit]');page.wait_for_selector('[data-edit]');assert len(state()['costs'])==1 and state()['costs'][0]['amount']==600000 and state()['costs'][0]['unit']=='BOX'
   page.click('nav [data-view=entry]');page.click('[data-center-input=truck]');assert page.locator('[data-charge-field=amount]').input_value()=='350000';page.click('#center-charge-entry button[type=submit]');page.wait_for_selector('[data-edit]');assert len(state()['costs'])==2 and state()['costs'][1]['category']=='용차임'
   page.click('nav [data-view=entry]');page.click('[data-center-input=processing]');page.select_option('#center-charge-entry [name=category]','임가공비(라벨링)');page.locator('#charge-paste-box summary').click();page.fill('#charge-paste','C001\t100\t200');page.click('#charge-paste-apply');assert page.locator('[data-charge-row]').count()==1;assert state()['costs'][1]['amount']==350000;assert page.locator('#charge-total').inner_text()=='₩20,000'
   page.click('#center-charge-entry button[type=submit]');page.wait_for_selector('[data-edit]');assert len(state()['costs'])==3;assert state()['costs'][2]['category']=='임가공비(라벨링)' and state()['costs'][2]['amount']==20000
   page.click('nav [data-view=entry]');page.click('[data-center-input=box]');page.locator('#charge-paste-box summary').click();page.select_option('#charge-paste-type','truck');assert page.locator('[data-center-input=truck]').get_attribute('aria-selected')=='true';page.fill('#charge-paste','C001\t700000');page.click('#charge-paste-apply');assert page.locator('[data-charge-field=amount]').input_value()=='700000';page.click('#center-charge-entry [data-draft-save]');page.wait_for_function("document.querySelector('[data-draft-message]').textContent.includes('임시 저장했습니다')")
   page.once('dialog',lambda d:d.accept());page.reload();page.wait_for_selector('.kpi');page.click('nav [data-view=entry]');page.click('[data-center-input=truck]');page.once('dialog',lambda d:d.accept());page.click('[data-draft-load]');page.wait_for_function("document.querySelector('[data-charge-field=amount]').value==='700000'")
   page.click('[data-cost-section=tradeReport]');assert page.locator('#trade-tab-report').count()==1;assert page.locator('nav [data-view=entry]').get_attribute('class')=='active';page.click('[data-cost-section=commonEntry]');assert page.locator('[data-material-tab]').count()>0;page.click('[data-cost-section=entry]');assert page.locator('[data-charge-field=amount]').input_value()=='700000'
   page.click('[data-center-input=box]');page.select_option('#center-charge-entry [name=mode]','reverse');page.fill('[data-store-search]','C001');page.press('[data-store-search]','Enter');page.fill('[data-charge-field=quantity]','3');page.fill('[data-charge-field=amount]','1000');assert '333.333333' in page.locator('[data-charge-price]').inner_text();page.click('#center-charge-entry button[type=submit]');page.wait_for_selector('[data-edit]');assert state()['costs'][-1]['amount']==1000 and state()['costs'][-1]['calculation']=='reverse'
   page.click('nav [data-view=entry]');page.click('[data-center-input=outbound]');page.locator('.quick-entry summary').click();page.select_option('#outbound-paste-type','processing');assert page.locator('[data-center-input=processing]').get_attribute('aria-selected')=='true';assert page.locator('#charge-paste-box').evaluate('e=>e.open')
   assert all(r['recordType']=='cost' for r in state()['costs']);page.click('nav [data-view=dashboard]');assert page.locator('.kpi .value').nth(3).inner_text()=='0건'
   page.click('nav [data-view=entry]');page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth')<=390,page.evaluate("[...document.querySelectorAll('#content *')].filter(e=>e.getBoundingClientRect().right>391&&e.getBoundingClientRect().width>0&&!(()=>{for(let p=e.parentElement;p&&p!==document.body;p=p.parentElement)if(['hidden','auto','scroll'].includes(getComputedStyle(p).overflowX))return true;return false})()).map(e=>[e.tagName,e.className,e.id,e.getBoundingClientRect().right]).slice(0,15)")
   if os.environ.get('CHARGE_SCREENSHOT'):page.set_viewport_size({'width':1440,'height':1050});page.screenshot(path=os.environ['CHARGE_SCREENSHOT'],full_page=True)
   assert not errors,errors;browser.close();print('PASS: consolidated cost navigation + typed box/truck/processing entry + context/row preservation + preset paste + exact cost-only totals + private draft reload + internal navigation + mobile')
  finally:
   process.terminate()
   try:process.wait(timeout=10)
   except subprocess.TimeoutExpired:process.kill();process.wait()
if __name__=='__main__':main()
