#!/usr/bin/env python3
"""Material master -> quotes -> purchase -> historical edits -> RBAC/backup, using a disposable DB."""
from pathlib import Path
import csv,os,secrets,subprocess,tempfile
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
def main():
 with tempfile.TemporaryDirectory(prefix='scm-materials-') as tmp,sync_playwright() as pw:
  password=secrets.token_urlsafe(24)
  code="import {createApp} from './server.mjs';const app=createApp({dbPath:process.env.LOGISTICS_DB_PATH,secureCookies:false});app.initializeAdmin({username:'materialadmin',password:process.env.SCM_TEST_PASSWORD});app.server.listen(0,'127.0.0.1',()=>console.log(app.server.address().port));process.on('SIGTERM',()=>app.close().then(()=>process.exit(0)));"
  process=subprocess.Popen(['node','--input-type=module','-e',code],cwd=ROOT,env={**os.environ,'LOGISTICS_DB_PATH':str(Path(tmp)/'test.sqlite'),'SCM_TEST_PASSWORD':password},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  try:
   port=process.stdout.readline().strip();assert port.isdigit();origin='http://127.0.0.1:'+port
   browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox']);page=browser.new_page(viewport={'width':1440,'height':1050});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   page.add_init_script("const actualConfirm=window.confirm.bind(window);window.confirm=m=>/^(등록을|수정을) 확정하시겠습니까/.test(String(m))?true:actualConfirm(m);")
   def login(username):
    page.goto(origin);page.wait_for_selector('#login-form');page.fill('[name=username]',username);page.fill('[name=password]',password);page.click('#login-form button')
   def state():return page.evaluate("async()=>(await (await fetch('/api/state')).json()).state")
   login('materialadmin');page.wait_for_selector('#start-empty');page.click('#start-empty');page.wait_for_selector('.kpi')
   page.click('nav [data-view=locations]');page.fill('#center-add [name=name]','부자재센터');page.click('#center-add button');page.wait_for_selector('[data-center-country]')
   page.click('nav [data-view=entry]');page.click('[data-cost-section=commonEntry]');page.click('[data-material-tab=masters]')
   page.fill('#material-item-form [name=code]','BOX-S');page.fill('#material-item-form [name=name]','택배박스 S');page.fill('#material-item-form [name=specification]','210×160×120 mm');page.fill('#material-item-form [name=flute]','B골');page.click('#material-item-form button[type=submit]');page.wait_for_selector('[data-material-edit]')
   item=state()['materials'][0]['id']
   for date,price in [('2026-01-01','226'),('2026-10-01','125')]:
    page.select_option('#material-price-form [name=materialId]',item);page.fill('#material-price-form [name=supplier]','검증 공급사');page.select_option('#material-price-form [name=center]','부자재센터');page.fill('#material-price-form [name=effectiveFrom]',date);page.fill('#material-price-form [name=moq]','100');page.fill('#material-price-form [name=unitPrice]',price);page.select_option('#material-price-form [name=vatIncluded]','true');page.click('#material-price-form button[type=submit]');page.wait_for_function('(n)=>document.querySelectorAll("[data-material-price-toggle]").length===n',arg=1 if date.endswith('01-01') else 2)
   assert '44.7%' in page.locator('#material-panel').inner_text()
   if os.environ.get('MATERIAL_SCREENSHOT'):page.screenshot(path=os.environ['MATERIAL_SCREENSHOT']+'-masters.png',full_page=True)
   page.click('[data-material-tab=purchases]');page.fill('#material-purchase-form [name=purchaseDate]','2026-11-01');page.select_option('#material-purchase-form [name=materialId]',item)
   assert page.locator('#material-purchase-form [name=unitPrice]').input_value()=='125'
   page.fill('#material-purchase-form [name=quantity]','100');assert '11,364' in page.locator('#material-purchase-summary').inner_text()
   page.fill('#material-purchase-form [name=unitPrice]','110');page.fill('#material-purchase-form [name=memo]','검증 청구서 1');page.click('#material-purchase-form button[type=submit]');page.wait_for_selector('[data-material-purchase-edit]')
   if os.environ.get('MATERIAL_SCREENSHOT'):page.screenshot(path=os.environ['MATERIAL_SCREENSHOT']+'-purchase.png',full_page=True)
   row=state()['costs'][0];original_id=row['id'];assert row['amount']==10000 and row['material']['vatAmount']==1000 and row['material']['totalAmount']==11000;assert row['center']=='부자재센터'
   page.click('nav [data-view=dashboard]');assert page.locator('.kpi .value').first.inner_text()=='₩10,000';assert '부자재 구매비' in page.locator('.donut-legend').inner_text()
   page.click('nav [data-view=entry]');page.click('[data-cost-section=commonEntry]');page.click('[data-material-tab=masters]');page.click('[data-material-edit]');page.fill('#material-item-form [name=name]','택배박스 개정명');page.fill('#material-item-form [name=specification]','새 규격');page.click('#material-item-form button[type=submit]');page.wait_for_function("document.querySelector('#material-item-form [name=name]').value===''")
   page.click('[data-material-tab=purchases]');assert '택배박스 S' in page.locator('#material-purchases').inner_text() and '210×160×120 mm' in page.locator('#material-purchases').inner_text()
   page.click('[data-material-purchase-edit]');page.fill('#material-purchase-form [name=quantity]','200');page.click('#material-purchase-form button[type=submit]');page.wait_for_function("document.querySelector('#material-purchase-form [name=quantity]').value===''")
   row=state()['costs'][0];assert row['amount']==20000 and row['material']['name']=='택배박스 S'
   # Master mapping drives dependent input options.
   page.click('nav [data-view=masters]');master=page.locator('tbody tr').filter(has=page.get_by_text('임가공비(세트포장 등)',exact=True));assert master.count()==1
   assert not master.locator('input[value="국제운송료"]').is_checked()
   page.click('nav [data-view=entry]');page.click('[data-cost-section=tradeReport]');page.click('#trade-tab-entry');page.select_option('[data-u=category]','임가공비(세트포장 등)')
   assert '국제운송료' not in page.locator('[data-u=chargeGroup] option').all_text_contents()
   page.select_option('[data-u=chargeGroup]','출발지 비용');page.select_option('[data-u=category]','보관료') if page.locator('[data-u=category] option[value="보관료"]').count() else page.select_option('[data-u=category]','지급임차료')
   assert page.locator('[data-u=chargeGroup]').input_value()==''
   page.click('nav [data-view=masters]');master=page.locator('tbody tr').filter(has=page.get_by_text('임가공비(세트포장 등)',exact=True))
   master.locator('summary').click()
   with page.expect_response(lambda r:r.url.endswith('/api/state') and r.request.method=='PUT'):master.locator('input[value="국제운송료"]').check()
   page.click('nav [data-view=entry]');page.click('[data-cost-section=tradeReport]');page.click('#trade-tab-entry');page.select_option('[data-u=category]','임가공비(세트포장 등)');assert '국제운송료' in page.locator('[data-u=chargeGroup] option').all_text_contents()
   # Backup includes both masters and immutable purchase snapshots.
   backup=page.evaluate("async()=>await (await fetch('/api/backup')).json()");assert len(backup['state']['materials'])==1 and len(backup['state']['materialPrices'])==2
   result=page.evaluate("""async b=>{const me=await(await fetch('/api/me')).json(),s=await(await fetch('/api/state')).json();const r=await fetch('/api/restore',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:JSON.stringify({backup:b.backup,revision:s.revision,currentPassword:b.password})});return r.status;}""",{'backup':backup,'password':password});assert result==200
   page.reload();page.wait_for_selector('.kpi');assert state()['costs'][0]['material']['name']=='택배박스 S'
   # An editor can purchase but cannot change material masters.
   result=page.evaluate("""async password=>{const me=await(await fetch('/api/me')).json();return (await fetch('/api/users',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:JSON.stringify({username:'materialeditor',password,role:'editor'})})).status;}""",password);assert result==201
   page.click('#logout');page.wait_for_selector('#login-form');login('materialeditor');page.wait_for_selector('.kpi');page.click('nav [data-view=entry]');page.click('[data-cost-section=commonEntry]');assert page.locator('[data-material-tab=masters]').count()==0
   status=page.evaluate("""async()=>{const me=await(await fetch('/api/me')).json(),s=await(await fetch('/api/state')).json();s.state.materials[0].name='forbidden';return(await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:JSON.stringify({revision:s.revision,state:s.state})})).status;}""");assert status==403
   page.fill('#material-purchase-form [name=purchaseDate]','2026-11-02');page.select_option('#material-purchase-form [name=materialId]',item);page.fill('#material-purchase-form [name=quantity]','10');page.fill('#material-purchase-form [name=unitPrice]','110');page.click('#material-purchase-form button[type=submit]');page.wait_for_function('document.querySelectorAll("[data-material-purchase-edit]").length===2')
   assert sum(r['amount'] for r in state()['costs'])==21000
   with page.expect_download() as purchase_export:page.click('#material-export')
   with Path(purchase_export.value.path()).open(encoding='utf-8-sig',newline='') as f:exported=list(csv.DictReader(f))
   assert len(exported)==2 and sum(int(r['공급가액']) for r in exported)==21000
   page.once('dialog',lambda d:d.accept());page.locator('[data-material-purchase-delete="'+original_id+'"]').click()
   page.wait_for_function('document.querySelectorAll("[data-material-purchase-edit]").length===1')
   assert len(state()['costs'])==1 and state()['costs'][0]['amount']==1000

   page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth')<=390
   assert not errors,errors;browser.close();print('PASS: material master + effective prices + VAT + purchase override + historical snapshots + category/group mapping + backup/restore + editor RBAC + mobile; disposable DB only')
  finally:
   process.terminate()
   try:process.wait(timeout=10)
   except subprocess.TimeoutExpired:process.kill();process.wait()
if __name__=='__main__':main()
