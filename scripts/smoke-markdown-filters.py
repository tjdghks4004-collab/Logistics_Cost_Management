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
   page.evaluate("""async()=>{const {validateRecord}=await import('/domain.mjs'),{billingUnitsFor}=await import('/units.mjs'),{persist}=await import('/api-client.mjs');const doc=(await(await fetch('/api/state')).json()).state;doc.groups=[{id:'g',name:'온라인'}];doc.stores=[{id:'s1',code:'C001',name:'마켓컬리',groupId:'g',active:true},{id:'s2',code:'C002',name:'예스아시아',groupId:'g',active:true}];const ctx={...doc,units:billingUnitsFor(doc)};const cost=(id,month,category,amount,extra={})=>({...validateRecord({domain:'center',recordType:'cost',month,center:'임시저장센터',account:'B2B',storeId:'s1',category,unit:'원',mode:'amount',amount,memo:'',...extra},ctx),id});doc.costs=[cost('old-box','2026-09','B2B 출고비',100000),cost('old-truck','2026-09','용차임',200000),cost('old-work','2026-09','임가공비(라벨링)',10000),cost('old-rent','2026-09','지급임차료',100000,{storeId:''}),cost('box','2026-10','B2B 출고비',600000,{mode:'calculated',quantity:500,price:1200,unit:'BOX'}),cost('truck','2026-10','용차임',350000,{mode:'reverse',quantity:2,unit:'건'}),cost('work','2026-10','임가공비(라벨링)',20000,{mode:'calculated',quantity:100,price:200,unit:'EA',storeId:'s2'}),cost('total-box','2026-10','B2B 출고비',50000),cost('rent','2026-10','지급임차료',100000,{storeId:''}),cost('counts','2026-10','B2B 출고비',0,{recordType:'count',quantity:1000})];const at=new Date().toISOString();doc.reconciliations=[{id:'old-check',reference:'9월 전체',expected:410000,recordIds:doc.costs.filter(r=>r.month==='2026-09').map(r=>r.id),months:['2026-09'],actor:'draftadmin',at},{id:'partial',reference:'10월 일부',expected:600000,recordIds:['box'],months:['2026-10'],actor:'draftadmin',at}];doc.periodEvents=[{id:'close',month:'2026-09',action:'close',reason:'대조 확인',actor:'draftadmin',at}];await persist(doc);} """)
   page.reload();page.wait_for_selector('.kpi');assert page.locator('[data-status-month="2026-10"]').get_attribute('data-status')=='entering';assert '1/5건' in page.locator('#dashboard-data-status').inner_text();assert page.locator('.kpi .value').first.inner_text()=='₩1,120,000';assert page.locator('.kpi .value').nth(1).inner_text()=='₩1,120/건'
   before=state();page.click('#ai-copy');assert '1,120,000원' in page.locator('#analysis-markdown').input_value();assert '조회 비용 5건' in page.locator('#analysis-copy-scope').inner_text()
   def select(id,values):page.locator('#'+id).evaluate("(e,values)=>{[...e.options].forEach(o=>o.selected=values.includes(o.value));e.dispatchEvent(new Event('change'))}",values)
   # An already-open clean preview refreshes immediately with the active dashboard filters.
   select('category',['B2B 출고비']);text=page.locator('#analysis-markdown').input_value();assert '650,000원' in text and '350,000원' not in text;assert '조회 비용 2건' in page.locator('#analysis-copy-scope').inner_text();assert '| 2026-10 | 입력 중 | 2 | 1 |' in text
   select('category',['용차임']);text=page.locator('#analysis-markdown').input_value();assert '350,000원' in text and '600,000원' not in text;assert '| 2026-10 | 입력 중 | 1 | 0 |' in text
   page.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedMarkdown=text}}})");page.click('#analysis-copy-confirm');assert page.evaluate('window.__copiedMarkdown')==text
   with page.expect_download() as download:page.click('#analysis-download')
   file=Path(tmp)/'filtered.md';download.value.save_as(str(file));assert file.read_text()==text
   # Preserve manual prompt edits and refuse stale copy/download until explicitly regenerated.
   page.fill('#analysis-markdown',text+'\n추가 요청: 임의 수정 보존');select('category',['임가공비(라벨링)']);assert '임의 수정 보존' in page.locator('#analysis-markdown').input_value();page.click('#analysis-copy-confirm');assert '다시 생성' in page.locator('#analysis-copy-status').inner_text();assert page.evaluate('window.__copiedMarkdown')==text
   page.once('dialog',lambda d:d.accept());page.click('#analysis-refresh');assert '20,000원' in page.locator('#analysis-markdown').input_value();assert '임의 수정 보존' not in page.locator('#analysis-markdown').input_value()
   select('category',['all']);select('store',['["s1","g"]']);scoped=page.locator('#analysis-markdown').input_value();assert '1,000,000원' in scoped and '예스아시아' not in scoped;assert '조회 비용 3건' in page.locator('#analysis-copy-scope').inner_text();assert '| 2026-10 | 입력 중 | 3 | 1 |' in scoped
   select('store',['all']);select('center',['임시저장센터']);assert '1,120,000원' in page.locator('#analysis-markdown').input_value();select('account',['B2C']);empty=page.locator('#analysis-markdown').input_value();assert '등록 비용 없음' in empty;assert '조회 비용 0건' in page.locator('#analysis-copy-scope').inner_text();select('account',['all']);select('domain',['trade']);assert '조회 비용 0건' in page.locator('#analysis-copy-scope').inner_text();select('domain',['all']);select('country',['KR']);assert '1,120,000원' in page.locator('#analysis-markdown').input_value();select('country',['all']);select('month',['2026-09']);assert '| 2026-09 | 마감 | 4 | 4 |' in page.locator('#analysis-markdown').input_value()
   page.click('#analysis-change-filters');assert not page.locator('#analysis-copy-dialog').is_visible();page.select_option('#dashboard-compare','ytd');page.click('#ai-copy');assert '비교 없는 누계' in page.locator('#analysis-markdown').input_value();assert '## 비교 기간 상세 집계' not in page.locator('#analysis-markdown').input_value();assert state()==before
   page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth')<=390;assert page.locator('#analysis-copy-dialog').bounding_box()['width']<=390
   assert not errors,errors;browser.close();print('PASS: live current filter refresh + scope banner + scoped reconciliation counts + category/store/center/account/month/comparison + filtered copy/download + manual edits preserved and stale output blocked + filter-change shortcut + unchanged DB + mobile')
  finally:
   process.terminate()
   try:process.wait(timeout=10)
   except subprocess.TimeoutExpired:process.kill();process.wait()
if __name__=='__main__':main()
