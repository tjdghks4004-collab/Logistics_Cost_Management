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
   before=state();requests=[];page.on('request',lambda r:requests.append((r.url,r.method)))
   page.click('#ai-copy');page.wait_for_selector('#analysis-copy-dialog[open]');text=page.locator('#analysis-markdown').input_value();assert '# 요청' in text and '# 출력 형식' in text;assert '1,120,000원' in text and '410,000원' in text and '1,200원 / BOX' in text;assert '입력 중' in text and '마감' in text;assert '마켓컬리' in text and '예스아시아' in text;assert 'password' not in text
   page.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedMarkdown=text;}}})");page.click('#analysis-copy-confirm');page.wait_for_function("document.querySelector('#analysis-copy-status').textContent.includes('복사했습니다')");assert page.evaluate('window.__copiedMarkdown')==text
   with page.expect_download() as download:page.click('#analysis-download')
   file=Path(tmp)/'analysis.md';download.value.save_as(str(file));assert file.read_text()==text
   # Clipboard rejection must offer manual copy without claiming success.
   page.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied')}}});document.execCommand=()=>false;");page.click('#analysis-copy-confirm');assert '자동 복사가 제한' in page.locator('#analysis-copy-status').inner_text();assert page.locator('#analysis-markdown').evaluate('e=>e.selectionEnd-e.selectionStart')==len(text)
   page.click('[data-analysis-close]');page.locator('#category').evaluate("e=>{[...e.options].forEach(o=>o.selected=o.value==='B2B 출고비');e.dispatchEvent(new Event('change'))}");page.click('#ai-copy');filtered=page.locator('#analysis-markdown').input_value();assert '650,000원' in filtered and '350,000원' not in filtered;assert '1,000건' in filtered;page.click('[data-analysis-close]')
   page.locator('#category').evaluate("e=>{[...e.options].forEach(o=>o.selected=o.value==='B2B 출고 건수');e.dispatchEvent(new Event('change'))}");page.click('#ai-copy');missing=page.locator('#analysis-markdown').input_value();assert '등록 비용 없음' in missing;assert '| 센터 전체 출고 건당 비용 | — |' in missing;page.click('[data-analysis-close]')
   page.select_option('#dashboard-compare','ytd');page.click('#ai-copy');assert '비교 없는 누계' in page.locator('#analysis-markdown').input_value();assert '## 비교 기간 상세 집계' not in page.locator('#analysis-markdown').input_value();page.click('[data-analysis-close]')
   assert state()==before;assert all(method=='GET' for _,method in requests),requests;assert all(url.startswith('http://127.0.0.1:') for url,_ in requests),requests
   page.evaluate("""async password=>{const {api}=await import('/api-client.mjs');await api('users',{method:'POST',body:JSON.stringify({username:'markdownviewer',password,role:'viewer'})});}""",password)
   page.click('#logout');page.wait_for_selector('#login-form');page.fill('[name=username]','markdownviewer');page.fill('[name=password]',password);page.click('#login-form button');page.wait_for_selector('.kpi');assert page.locator('#ai-copy').is_enabled();page.click('#ai-copy');assert '1,120,000원' in page.locator('#analysis-markdown').input_value();
   if os.environ.get('MARKDOWN_SCREENSHOT'):page.screenshot(path=os.environ['MARKDOWN_SCREENSHOT'],full_page=True)
   page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth')<=390;assert page.locator('#analysis-copy-dialog').bounding_box()['width']<=390
   assert not errors,errors;browser.close();print('PASS: scoped markdown totals + actual period/status/unit metrics + clipboard success + denied fallback + exact .md download + filter regeneration + YTD no invented comparison + no writes/external transfer + viewer + mobile')
  finally:
   process.terminate()
   try:process.wait(timeout=10)
   except subprocess.TimeoutExpired:process.kill();process.wait()
if __name__=='__main__':main()
