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
   assert page.evaluate("""async()=>{const me=await(await fetch('/api/me')).json(),d=await(await fetch('/api/state')).json(),g=d.state.groups[0].id;d.state.stores.push({id:'second',code:'C002',name:'마켓컬리',groupId:g,active:true});const base={month:'2026-11',domain:'center',recordType:'cost',countryCode:'KR',center:'임시저장센터',account:'공통',storeId:d.state.stores[0].id,groupId:g,category:'박스 출고비',unit:'원',quantity:null,price:null};d.state.costs=Array.from({length:350},(_,i)=>({...base,id:'row-'+i,storeId:i===139?'second':base.storeId,amount:i===139?99999:i===1?2:i,memo:i===139?'숨은 행':i===137?'<img src=x onerror=window.__optionXss=1>':i===0?'':'일반'+i}));d.state.sales=[{id:'low',month:'2026-11',storeId:d.state.stores[0].id,groupId:g,basis:'상품매출',source:'erp',sourceRows:1,amount:2},{id:'high',month:'2026-11',storeId:'second',groupId:g,basis:'상품매출',source:'erp',sourceRows:2,amount:10}];return(await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:JSON.stringify({revision:d.revision,state:d.state})})).status;}""")==200
   page.reload();page.wait_for_selector('.kpi');before=state()
   def wait_table(selector):page.wait_for_selector(selector+' [data-table-control=sort]')
   def sort(selector,key):page.locator(selector+' [data-table-control=sort][data-table-column="'+str(key)+'"]').click()
   def filter_col(selector,key,text='',minimum=None,maximum=None,mode='contains'):
    page.locator(selector+' [data-table-control=filter][data-table-column="'+str(key)+'"]').click();page.wait_for_selector('.table-filter-dialog[open]');page.select_option('.table-filter-dialog [name=mode]',mode);
    if not page.locator('.table-filter-dialog [name=text]').is_disabled():page.fill('.table-filter-dialog [name=text]',text)
    if minimum is not None:page.fill('.table-filter-dialog [name=min]',str(minimum))
    if maximum is not None:page.fill('.table-filter-dialog [name=max]',str(maximum))
    page.click('[data-table-filter-apply]');page.wait_for_function("!document.querySelector('.table-filter-dialog').open")
   def reset(selector):page.locator(selector).locator('..').locator('[data-table-control=reset]').click();wait_table(selector)
   def open_values(selector,key):
    wait_table(selector);page.locator(selector+' [data-table-control=filter][data-table-column="'+str(key)+'"]').click();page.wait_for_selector('.table-filter-dialog[open]')
   def check_value(key,search,checked=True):
    page.fill('.table-filter-dialog [name=valueSearch]',search);keys=page.locator('[data-table-value]').evaluate_all('els=>els.map(e=>e.value)');assert key in keys,keys;page.locator('[data-table-value]').nth(keys.index(key)).set_checked(checked)
   def apply_values():page.click('[data-table-filter-apply]');page.wait_for_function("!document.querySelector('.table-filter-dialog').open")
   page.click('nav [data-view=costs]');page.click('[data-cost-tab=all]');page.locator('#cost-table-settings').evaluate('e=>e.open=true');page.click('[data-cost-columns=detailed]');open_values('#cost-records-table','memo');assert page.locator('[data-table-value]').count()==200;assert page.locator('[data-table-values-more]').is_visible();page.click('[data-table-values-more]');assert page.locator('[data-table-value]').count()==350;assert page.locator('.table-filter-dialog img').count()==0 and page.evaluate('window.__optionXss===undefined')
   page.click('[data-table-values-none]');check_value('s:숨은 행','숨은');check_value('s:일반349','349');apply_values();assert page.locator('#cost-records-table tbody tr').count()==2;assert page.locator('#cost-shown-total').inner_text()=='₩100,348'
   with page.expect_download() as dl:page.click('#export')
   with Path(dl.value.path()).open(encoding='utf-8-sig',newline='') as f:assert len(list(csv.DictReader(f)))==2
   open_values('#cost-records-table','memo');assert '전체 350개' in page.locator('.table-value-status').inner_text();check_value('s:일반12','일반12');page.click('[data-table-filter-close]');assert page.locator('#cost-records-table tbody tr').count()==2
   open_values('#cost-records-table','memo');page.fill('[name=valueSearch]','일반12');keys=page.locator('[data-table-value]').evaluate_all('els=>els.map(e=>e.value)');assert not page.locator('[data-table-value]').nth(keys.index('s:일반12')).is_checked();page.keyboard.press('Escape');reset('#cost-records-table')
   open_values('#cost-records-table','amount');page.click('[data-table-values-none]');check_value('n:0','0');check_value('n:99999','99,999');page.fill('.table-filter-dialog [name=min]','1');apply_values();assert page.locator('#cost-records-table tbody tr').count()==1
   open_values('#cost-records-table','amount');page.fill('.table-filter-dialog [name=min]','');apply_values();assert page.locator('#cost-records-table tbody tr').count()==2
   open_values('#cost-records-table','amount');page.click('[data-table-values-none]');apply_values();assert page.locator('#cost-records-table tbody tr').count()==0
   open_values('#cost-records-table','amount');assert page.locator('[data-table-value]').count()>0;assert page.locator('[data-table-value]:checked').count()==0;page.click('[data-table-values-all]');apply_values();assert page.locator('#cost-records-table tbody tr').count()==100;assert page.locator('#cost-count').inner_text()=='350건'
   open_values('#cost-records-table','store');page.fill('[name=valueSearch]','컬리');page.click('[data-table-values-matching]');apply_values();assert page.locator('#cost-records-table tbody tr').count()==1;assert '99,999' in page.locator('#cost-shown-total').inner_text()
   filter_col('#cost-records-table','amount',minimum=100,maximum=140);assert page.locator('#cost-records-table tbody tr').count()==0;open_values('#cost-records-table','store');assert page.locator('[data-table-value]').count()==2;assert '0행' in page.locator('.table-value-list').inner_text();page.click('[data-table-values-all]');apply_values();assert page.locator('#cost-records-table tbody tr').count()==40;reset('#cost-records-table')
   open_values('#cost-records-table','memo');page.click('[data-table-values-none]');check_value('empty:','빈 값');apply_values();assert page.locator('#cost-records-table tbody tr').count()==1;assert page.locator('#cost-shown-total').inner_text()=='₩0';reset('#cost-records-table')
   page.click('nav [data-view=activity]');open_values('#sales-records-table','storeName');page.click('[data-table-values-none]');check_value('s:마켓컬리','컬리');apply_values();assert page.locator('[data-sales-id]').count()==1;page.check('#sales-select-all');assert page.locator('[data-sales-select]:checked').get_attribute('data-sales-select')=='high';assert page.locator('#sales-total').inner_text()=='₩10'
   with page.expect_download() as dl:page.click('#export')
   with Path(dl.value.path()).open(encoding='utf-8-sig',newline='') as f:assert len(list(csv.DictReader(f)))==1
   page.click('nav [data-view=stores]');master='table:has([data-store-record])';open_values(master,1);page.click('[data-table-values-none]');check_value('s:마켓컬리','컬리');apply_values();assert page.locator('[data-store-record]:not(.table-query-hidden)').count()==1;open_values(master,1);assert page.locator('[data-table-value]').count()==2;page.click('[data-table-values-all]');apply_values();assert page.locator('[data-store-record]:not(.table-query-hidden)').count()==2
   assert state()==before;page.click('nav [data-view=costs]');page.click('[data-cost-tab=all]');page.locator('#cost-table-settings').evaluate('e=>e.open=true');page.click('[data-cost-columns=detailed]');open_values('#cost-records-table','store');page.fill('[name=valueSearch]','컬리')
   if os.environ.get('TABLE_VALUES_SCREENSHOT'):page.screenshot(path=os.environ['TABLE_VALUES_SCREENSHOT'])
   page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth')<=390;assert page.locator('[data-table-filter-apply]').is_visible();page.keyboard.press('Escape');assert not errors,errors;browser.close();print('PASS: full-scope distinct choices beyond paging/render cap + multi-value OR + numeric/text AND + empty/zero + selection persistence/cancel/all/none + other-column facets + retained missing values + safe labels + sales scope/export + generic tables + unchanged records + mobile')
  finally:
   process.terminate()
   try:process.wait(timeout=10)
   except subprocess.TimeoutExpired:process.kill();process.wait()
if __name__=='__main__':main()
