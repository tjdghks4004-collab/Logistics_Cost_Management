#!/usr/bin/env python3
"""Real authenticated browser workflow against an isolated on-disk SQLite database."""
from pathlib import Path
import json,os,re,secrets,select,subprocess,tempfile,time
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]

def main():
    with tempfile.TemporaryDirectory(prefix='scm-real-app-') as tmp,sync_playwright() as p:
        db=str(Path(tmp)/'app.sqlite');password=secrets.token_urlsafe(24)
        def start():
            server=subprocess.Popen(['node','server.mjs'],cwd=ROOT,env={**os.environ,'PORT':'0','HOST':'127.0.0.1','LOGISTICS_DB_PATH':db,'NODE_ENV':'development'},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            deadline=time.monotonic()+15
            while time.monotonic()<deadline:
                if server.poll() is not None:raise RuntimeError('Test server exited')
                ready,_,_=select.select([server.stdout],[],[],1)
                if ready:
                    match=re.search(r'포트 (\d+)',server.stdout.readline())
                    if match:return server,'http://127.0.0.1:'+match.group(1)
            server.terminate();raise RuntimeError('Test server not ready')
        def stop(server):
            server.terminate()
            try:server.wait(timeout=10)
            except subprocess.TimeoutExpired:server.kill();server.wait()
        server,origin=start();browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        try:
            page=browser.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(origin);page.wait_for_selector('#login-form')
            page.wait_for_function("document.querySelector('#login-title').textContent==='최초 관리자 등록'")
            page.fill('[name=username]','scm_admin');page.fill('[name=name]','SCM 관리자');page.fill('[name=password]',password);page.click('#login-form button')
            page.wait_for_selector('#start-empty');page.click('#start-empty');page.wait_for_selector('.kpi')
            def workspace():return page.evaluate("async()=>{const r=await fetch('/api/state');if(!r.ok)throw Error('state');return (await r.json()).state}")
            state=workspace();assert state['costs']==[] and state['stores']==[] and state['centerMasters']==[]
            page.click('[data-view=entry]');assert '물류센터를 먼저 등록' in page.locator('#content').inner_text()
            page.click('[data-view=locations]');page.fill('#center-add [name=name]','검증센터');page.click('#center-add button')
            page.wait_for_function("document.querySelector('[data-center-country]')!==null")
            page.click('[data-view=stores]');page.fill('#group-add [name=name]','SCM 관리그룹');page.click('#group-add button')
            page.wait_for_function("[...document.querySelector('#store-add [name=groupId]').options].some(o=>o.textContent==='SCM 관리그룹')")
            page.fill('#store-add [name=code]','SCM001');page.fill('#store-add [name=name]','검증매장');page.click('#store-add button')
            page.wait_for_selector('[data-store-record]');store=workspace()['stores'][0]['id']
            page.click('[data-view=entry]')
            page.fill('#unified-entry [name=month]','2026-10')
            page.select_option('[data-u=storeId]',store);page.select_option('[data-u=category]','B2C 출고비')
            page.fill('[data-u=quantity]','100');page.fill('[data-u=price]','500');page.click('#unified-add')
            page.select_option('[data-unified-row="1"] [data-u=recordType]','count');page.select_option('[data-unified-row="1"] [data-u=storeId]',store);page.fill('[data-unified-row="1"] [data-u=quantity]','100')
            page.click('#unified-entry button[type=submit]');page.wait_for_selector('[data-edit]');assert len(workspace()['costs'])==2
            page.reload();page.wait_for_selector('.kpi');assert page.locator('.kpi .value').first.inner_text()=='₩50,000'
            assert page.locator('.kpi .value').nth(1).inner_text()=='₩500/건'
            # Download and import a real XLSX through the server-backed app.
            page.click('[data-view=costs]')
            with page.expect_download() as download:page.click('#template')
            template=Path(tmp)/'template.xlsx';filled=Path(tmp)/'filled.xlsx';download.value.save_as(str(template))
            generator="""import ExcelJS from 'exceljs';const book=new ExcelJS.Workbook();await book.xlsx.readFile(process.argv[1]);const sheet=book.getWorksheet('통합 입력'),headers=sheet.getRow(1).values.slice(1);const row={'월':'2026-10','비용유형':'물류센터','데이터유형':'비용','국가코드':'KR','센터':'검증센터','업무구분':'B2C','매장코드':'SCM001','비용항목':'임가공비(라벨링)','청구단위':'EA','수량':10,'단가':200};sheet.getRow(2).values=headers.map(h=>row[h]??'');await book.xlsx.writeFile(process.argv[2]);"""
            subprocess.run(['node','--input-type=module','-e',generator,str(template),str(filled)],cwd=ROOT,check=True,capture_output=True,text=True)
            page.set_input_files('#file',str(filled));page.wait_for_selector('#commit-import');page.click('#commit-import')
            page.wait_for_function("async()=>((await (await fetch('/api/state')).json()).state.costs.length===3)")
            page.click('[data-view=dashboard]');assert page.locator('.kpi .value').first.inner_text()=='₩52,000'
            # Store master XLSX: preview errors, explicit new-group opt-in, then one atomic save.
            before_bulk=workspace();old_store_id=before_bulk['stores'][0]['id'];old_costs=before_bulk['costs']
            page.click('[data-view=stores]');assert page.locator('#add').is_hidden()
            with page.expect_download() as download:page.click('#store-template')
            store_template=Path(tmp)/'stores.xlsx';store_filled=Path(tmp)/'stores-filled.xlsx';download.value.save_as(str(store_template))
            store_generator="""import ExcelJS from 'exceljs';const book=new ExcelJS.Workbook();await book.xlsx.readFile(process.argv[1]);const sheet=book.getWorksheet('매장 마스터 입력');sheet.getRow(2).values=['SCM001','검증매장 개정','해외 관리그룹','사용'];sheet.getRow(3).values=['0002','추가매장','해외 관리그룹','사용 제외'];await book.xlsx.writeFile(process.argv[2]);"""
            subprocess.run(['node','--input-type=module','-e',store_generator,str(store_template),str(store_filled)],cwd=ROOT,check=True,capture_output=True,text=True)
            page.set_input_files('#store-file',str(store_filled));page.wait_for_selector('#store-import-save')
            assert page.locator('#store-import-save').is_disabled();assert '미등록 관리그룹' in page.locator('#store-import-preview').inner_text()
            assert workspace()['stores']==before_bulk['stores']
            page.check('#store-new-groups');assert page.locator('#store-import-save').is_enabled()
            assert '함께 생성할 관리그룹' in page.locator('#store-import-preview').inner_text()
            page.click('#store-import-save')
            page.wait_for_function("async()=>((await (await fetch('/api/state')).json()).state.stores.length===2)")
            after_bulk=workspace();assert after_bulk['stores'][0]['id']==old_store_id;assert after_bulk['stores'][0]['name']=='검증매장 개정';assert after_bulk['stores'][1]['code']=='0002';assert after_bulk['stores'][1]['active'] is False
            assert after_bulk['costs']==old_costs;assert len(after_bulk['groups'])==2
            page.reload();page.wait_for_selector('.kpi');assert workspace()['stores']==after_bulk['stores']
            # Preserve legacy metrics/notes while replacing only the visible workflow.
            page.evaluate("""async()=>{const me=await (await fetch('/api/me')).json(),doc=await (await fetch('/api/state')).json();doc.state.activity=[{month:'2026-10',center:'검증센터',countryCode:'KR',volume:999,sales:999999}];doc.state.notes=[{month:'2026-10',reason:'기존 기록',plan:'보존',owner:'SCM'}];const res=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:JSON.stringify({revision:doc.revision,state:doc.state})});if(!res.ok)throw Error('legacy fixture failed');}""")
            page.reload();page.wait_for_selector('.kpi');assert page.locator('[data-view=notes]').count()==0
            assert page.locator('.kpi .value').nth(3).inner_text()=='100건'
            assert workspace()['activity'][0]['volume']==999
            page.click('[data-view=activity]')
            assert page.locator('#title').inner_text()=='매출 관리'
            assert page.locator('#activity-add,[name=volume]').count()==0
            assert page.locator('#center').evaluate('el=>el.closest("label").hidden')
            with page.expect_download() as download:page.click('#sales-template')
            sales_template=Path(tmp)/'sales-template.xlsx';sales_filled=Path(tmp)/'erp-sales.xlsx';download.value.save_as(str(sales_template))
            sales_generator="""import ExcelJS from 'exceljs';const book=new ExcelJS.Workbook();await book.xlsx.readFile(process.argv[1]);const s=book.getWorksheet('매출 입력');s.getCell('E1').value='판매수량';s.getRow(2).values=['20261001','SCM001','ERP의 다른 매장명',1000000,5000];s.getRow(3).values=['20261002','SCM001','검증매장 개정',-100000,-500];s.getRow(4).values=['20261003','0002','추가매장',100000,800];s.getRow(5).values=['20261101','SCM001','검증매장 개정',200000,200];await book.xlsx.writeFile(process.argv[2]);"""
            subprocess.run(['node','--input-type=module','-e',sales_generator,str(sales_template),str(sales_filled)],cwd=ROOT,check=True,capture_output=True,text=True)
            page.set_input_files('#sales-file',str(sales_filled));page.wait_for_selector('#sales-save');assert page.locator('#sales-save').is_disabled();assert not workspace().get('sales');assert '매장명 차이 (등록 가능)' in page.locator('#sales-preview').inner_text()
            page.check('#sales-confirm');page.click('#sales-save')
            page.wait_for_function("async()=>((await (await fetch('/api/state')).json()).state.sales?.length===3)")
            sales_before=workspace()['sales'];assert workspace()['stores'][0]['name']=='검증매장 개정';assert page.locator('[data-sales-id]').filter(has_text='검증매장 개정').count()>0;assert page.locator('#sales-total').inner_text()=='₩1,000,000'
            assert workspace()['activity'][0]['volume']==999 and len(workspace()['notes'])==1
            page.set_input_files('#sales-file',str(sales_filled));page.wait_for_selector('#sales-save');page.check('#sales-confirm');assert page.locator('#sales-save').is_disabled();assert workspace()['sales']==sales_before
            page.click('#sales-cancel');page.click('[data-view=dashboard]')
            assert page.locator('.kpi .value').nth(3).inner_text()=='100건'
            assert page.locator('.kpi .value').nth(2).inner_text()=='5.20%'
            page.locator('#center').evaluate("el=>{el.value='검증센터';el.dispatchEvent(new Event('change'))}")
            assert page.locator('.kpi .value').nth(2).inner_text()=='—'
            page.locator('#center').evaluate("el=>{el.value='all';el.dispatchEvent(new Event('change'))}")
            # Deletion is opt-in, scoped to checked rows, and does not touch costs or masters.
            page.click('[data-view=activity]')
            before_delete=workspace()
            page.locator('[data-sales-delete]').first.click()
            assert page.locator('#sales-delete-commit').is_disabled()
            page.click('#sales-delete-cancel');assert workspace()['sales']==before_delete['sales']
            page.check('#sales-select-all');page.click('#sales-delete-selected')
            assert '2건' in page.locator('#sales-delete-preview').inner_text()
            page.check('#sales-delete-confirm');page.click('#sales-delete-commit')
            page.wait_for_function("async()=>((await (await fetch('/api/state')).json()).state.sales.length===1)")
            deleted=workspace();assert deleted['sales'][0]['month']=='2026-11'
            for key in ['costs','stores','groups','activity','notes']:assert deleted[key]==before_delete[key]
            page.reload();page.wait_for_selector('.kpi');assert len(workspace()['sales'])==1
            page.locator('#month').evaluate("el=>{el.value='2026-10';el.dispatchEvent(new Event('change'))}")
            page.click('[data-view=activity]')
            page.set_input_files('#sales-file',str(sales_filled));page.wait_for_selector('#sales-save');page.check('#sales-confirm');page.click('#sales-save')
            page.wait_for_function("async()=>((await (await fetch('/api/state')).json()).state.sales.length===3)")
            # Create the remaining two SCM users through the authenticated admin UI.
            page.click('[data-view=settings]')
            for username,role in [('scm_editor','editor'),('scm_viewer','viewer')]:
                page.fill('#user-form [name=username]',username);page.fill('#user-form [name=name]',username);page.fill('#user-form [name=password]',password);page.select_option('#user-form [name=role]',role);page.click('#user-form button')
                page.wait_for_function('(name)=>document.querySelector("#user-list").textContent.includes(name)',arg=username)
            with page.expect_download() as download:page.click('#backup-download')
            backup=json.loads(Path(download.value.path()).read_text());assert len(backup['state']['costs'])==3 and len(backup['state']['sales'])==3 and len(backup['state']['notes'])==1
            # Real process restart; no browser storage contains the workspace.
            assert page.evaluate('localStorage.length')==0
            stop(server);server,origin=start();page.context.clear_cookies();page.goto(origin);page.wait_for_selector('#login-form')
            page.fill('[name=username]','scm_admin');page.fill('[name=password]',password);page.click('#login-form button');page.wait_for_selector('.kpi');page.locator('#month').evaluate("el=>{el.value='2026-10';el.dispatchEvent(new Event('change'))}");assert page.locator('.kpi .value').first.inner_text()=='₩52,000';assert len(workspace()['sales'])==3
            page.click('#logout');page.wait_for_selector('#login-form')
            page.fill('[name=username]','scm_viewer');page.fill('[name=password]',password);page.click('#login-form button');page.wait_for_selector('.kpi')
            assert page.locator('[data-view=entry]').is_hidden() and page.locator('#add').is_hidden()
            assert page.evaluate("async()=>(await fetch('/api/backup')).status")==403
            page.click('[data-view=activity]')
            assert page.locator('[data-sales-delete],#sales-delete-selected,#sales-select-all').count()==0
            assert not errors,errors
            print('PASS: actual login + empty setup + masters + costs/counts + real XLSX upload + bulk store master + ERP revenue/KPI/no-op import + legacy preservation + SQLite persistence/restart + 3 users + viewer permissions + backup; no production data touched')
        finally:
            browser.close();stop(server)

if __name__=='__main__':main()
