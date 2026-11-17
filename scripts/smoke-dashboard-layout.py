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
   page.evaluate("""async()=>{const {persist}=await import('/api-client.mjs');const doc=(await(await fetch('/api/state')).json()).state;const base=doc.costs.find(r=>r.id==='box');for(let i=0;i<17;i++){const id='extra-'+i;doc.stores.push({id,code:'X'+i,name:'테스트매장'+i,groupId:'g',active:true});doc.costs.push({...base,id:'extra-cost-'+i,storeId:id,amount:100+i,quantity:1,price:100+i});}await persist(doc);}""")
   page.reload();page.wait_for_selector('.kpi');before=state()
   assert page.locator('section.kpis').bounding_box()['y']<430
   assert page.locator('#dashboard-primary-filters #month').is_hidden()
   assert page.locator('#dashboard-data-status').is_hidden()
   assert page.locator('.outbound-quantities').is_hidden()
   assert page.locator('#dashboard-increase-item').is_hidden()
   page.screenshot(path='/tmp/scm-dashboard-compact.png',full_page=True)
   page.click('[data-dashboard-tab=comparison]')
   assert page.locator('#cost-store-chart .item-chart-group').count()==5
   assert page.locator('#cost-store-chart .item-chart-list').evaluate('e=>e.scrollHeight<=e.clientHeight+1')
   page.click('[data-breakdown-kind=store][data-breakdown-page="1"]');assert page.locator('#cost-store-chart .breakdown-pagination').inner_text().find('6–10')>=0
   page.fill('[data-breakdown-search=store]','테스트매장16');assert page.locator('#cost-store-chart .item-chart-group').count()==1;assert '테스트매장16' in page.locator('#cost-store-chart .item-chart-group').inner_text()
   assert page.locator('.kpi .value').first.inner_text()=='₩1,121,836'
   page.screenshot(path='/tmp/scm-dashboard-comparison.png',full_page=True)
   page.fill('[data-breakdown-search=store]','없음');assert page.locator('#cost-store-chart .item-chart-group').count()==0
   page.fill('[data-breakdown-search=store]','');assert page.locator('#cost-store-chart .item-chart-group').count()==5
   page.click('[data-dashboard-tab=quantities]');assert page.locator('.outbound-quantities').is_visible();assert page.locator('#dashboard-charge-metrics').is_visible()
   page.click('[data-dashboard-tab=overview]');page.locator('#dashboard-advanced-filters').evaluate('e=>e.open=true');page.locator('[data-multi=account]>summary').click();page.locator('[data-multi=account] input[value=B2B]').check();assert 'B2B' in page.locator('#dashboard-active-filters').inner_text()
   page.click('nav [data-view=costs]');page.click('nav [data-view=dashboard]');assert page.locator('#account').count()==1;assert 'B2B' in page.locator('#dashboard-active-filters').inner_text()
   page.set_viewport_size({'width':390,'height':844});page.locator('#dashboard-advanced-filters').evaluate('e=>e.open=false');assert page.evaluate('document.documentElement.scrollWidth')<=390
   page.screenshot(path='/tmp/scm-dashboard-mobile.png',full_page=True)
   assert state()==before;assert not errors,errors;browser.close();print('PASS: compact scope bar + first-screen KPIs + folded data status + focused tabs + top 5 pagination/search + full-scope totals unchanged + filter continuity + mobile')
  finally:
   process.terminate()
   try:process.wait(timeout=10)
   except subprocess.TimeoutExpired:process.kill();process.wait()
if __name__=='__main__':main()
