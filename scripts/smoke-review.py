#!/usr/bin/env python3
"""End-to-end review workflow using only disposable browser data and a local server."""
from pathlib import Path
import csv
import os
import re
import select
import subprocess
import tempfile
import time

ROOT=Path(__file__).resolve().parents[1]

def main():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise SystemExit('개발 환경에 Python Playwright가 필요합니다. 운영 앱 실행에는 필요하지 않습니다.') from exc
    server=subprocess.Popen(['node','scripts/review-server.mjs'],cwd=ROOT,env={**os.environ,'REVIEW_PORT':'0'},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    try:
        port=None
        deadline=time.monotonic()+15
        while time.monotonic()<deadline:
            if server.poll() is not None:
                raise RuntimeError('임시 검토 서버 시작 실패')
            readable,_,_=select.select([server.stdout],[],[],1)
            if readable:
                match=re.search(r'포트 (\d+)',server.stdout.readline())
                if match:port=int(match.group(1));break
        if port is None:raise RuntimeError('임시 서버 준비 시간 초과')
        origin=f'http://127.0.0.1:{port}'
        with tempfile.TemporaryDirectory(prefix='scm-flow-') as tmp,sync_playwright() as playwright:
            temp=Path(tmp)
            browser=playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
            page=browser.new_page(viewport={'width':1440,'height':1050})
            errors=[];requests=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.on('request',lambda request:requests.append(request.url))
            page.goto(origin);page.wait_for_selector('.kpi')
            def check_item_chart():
                for item_series,trend_series in [('current','조회 비용'),('previous','비교 비용')]:
                    item_total=sum(float(bar.get_attribute('data-value')) for bar in page.locator(f'#cost-item-chart [data-item-series="{item_series}"]').all())
                    trend_total=sum(float(bar.get_attribute('data-value')) for bar in page.locator(f'#dashboard-chart [data-series="{trend_series}"]').all())
                    assert item_total==trend_total,(item_series,item_total,trend_total)
                assert page.locator('#cost-item-chart').get_attribute('data-mode')==page.locator('#dashboard-chart').get_attribute('data-mode')
                for store_series,item_series in [('current','current'),('previous','previous')]:
                    store_total=sum(float(bar.get_attribute('data-value')) for bar in page.locator(f'#cost-store-chart [data-store-series="{store_series}"]').all())
                    item_total=sum(float(bar.get_attribute('data-value')) for bar in page.locator(f'#cost-item-chart [data-item-series="{item_series}"]').all())
                    assert store_total==item_total,(store_series,store_total,item_total)
                assert page.locator('#cost-store-chart').get_attribute('data-mode')==page.locator('#dashboard-chart').get_attribute('data-mode')
                assert page.locator('#efficiency-chart').get_attribute('data-mode')==page.locator('#dashboard-chart').get_attribute('data-mode')
                assert page.locator('#cost-waterfall').get_attribute('data-mode')==page.locator('#dashboard-chart').get_attribute('data-mode')
                if page.locator('[data-wf-total]').count():
                    start=float(page.locator('[data-wf-total="previous"]').get_attribute('data-value'))
                    end=float(page.locator('[data-wf-total="current"]').get_attribute('data-value'))
                    deltas=sum(float(bar.get_attribute('data-wf-delta')) for bar in page.locator('[data-wf-delta]').all())
                    assert start+deltas==end
                    item_total=sum(float(bar.get_attribute('data-value')) for bar in page.locator('#cost-item-chart [data-item-series="current"]').all())
                    assert end==item_total
                elif page.locator('#dashboard-compare').input_value()=='ytd':
                    assert '비교 없는 누계' in page.locator('#cost-waterfall').inner_text()
                else:assert '자료가 부족' in page.locator('#cost-waterfall').inner_text()
            check_item_chart()
            for point in page.locator('[data-eff-unit]').all():
                month=point.get_attribute('data-eff-month')
                expected=page.evaluate("""month=>{const s=JSON.parse(localStorage.getItem('scm-logistics-review-v1'));return s.costs.filter(r=>r.month===month&&r.domain==='center'&&r.recordType!=='count').reduce((n,r)=>n+r.amount,0)/s.activity.filter(r=>r.month===month).reduce((n,r)=>n+r.volume,0)}""",month)
                assert abs(float(point.get_attribute('data-eff-unit'))-expected)<0.00001
            assert page.locator('#cost-item-chart .item-bar').count()>0
            assert page.locator('#cost-item-chart svg').count()==0
            page.select_option('#item-chart-level','parent');check_item_chart()
            assert page.locator('#cost-item-chart [data-item-name="보관·임차비"]').count()>0
            page.select_option('#item-chart-level','child')
            assert page.locator('#cost-item-chart [data-item-name="보관료"]').count()>0
            left=page.locator('#cost-item-chart').bounding_box();right=page.locator('#cost-store-chart').bounding_box()
            assert right['x']>left['x'] and abs(right['y']-left['y'])<2
            assert '매장 지정 자료가 없어 공통 비용만 표시' in page.locator('#cost-store-chart').inner_text()
            monthly=page.locator('.kpi .value').first.inner_text()
            for mode in ['yoy','ytd','ytd_yoy','qoq']:
                page.select_option('#dashboard-compare',mode)
                check_item_chart()
                assert page.locator('#dashboard-compare').input_value()==mode
                assert page.locator('.period-label').inner_text()
                assert page.locator('#dashboard-chart').get_attribute('data-mode')==mode
                expected={'yoy':1,'ytd':6,'ytd_yoy':6,'qoq':1}[mode]
                assert page.locator('#dashboard-chart [data-series="조회 비용"]').count()==expected
                if mode in ['yoy','ytd_yoy']:
                    assert page.locator('#dashboard-chart [data-series="비교 비용"]').count()==0
                    assert '자료 없음' in page.locator('#dashboard-chart').text_content()
                if mode=='qoq':
                    assert page.locator('#dashboard-chart [data-series="비교 비용"]').count()==3

            assert page.locator('#dashboard-target-toggle,#target-summary,#target-form').count()==0
            assert page.locator('#dashboard-compare option[value="target"]').count()==0
            def choose(id,value):
                box=page.locator(f'[data-multi="{"category" if id=="category-parent" else "store" if id=="group" else id}"]')
                if not box.evaluate('(el)=>el.open'):
                    page.locator('#title').click()
                    box.locator('summary').first.click()
                if id=='category-parent' and value!='all':
                    group=box.locator(f'[data-category-group="{value}"]')
                    if not group.evaluate('(el)=>el.open'):group.locator('summary').click()
                    group.locator('[data-category-parent]').click()
                elif id=='category' and value!='all':
                    child=box.locator(f'[data-category-child][value="{value}"]')
                    group=child.locator('xpath=ancestor::details[1]')
                    if not group.evaluate('(el)=>el.open'):group.locator('summary').click()
                    child.click()
                elif id=='group':
                    group=box.locator(f'[data-store-group="{value}"]')
                    if not group.evaluate('(el)=>el.open'):group.locator('summary').click()
                    group.locator('[data-store-parent]').click()
                elif id=='store' and value!='all':
                    child=box.locator(f'[data-store-child][data-store-id="{value}"]').first
                    group=child.locator('xpath=ancestor::details[1]')
                    if not group.evaluate('(el)=>el.open'):group.locator('summary').click()
                    child.click()
                else:box.locator(f'input[value="{value}"]').click()
            assert page.locator('[data-multi="category"]').count()==1
            assert page.locator('#category-parent,[data-multi="category-parent"]').count()==0
            choose('category','보관료');choose('category','입출고비')
            assert page.locator('[data-category-parent="보관·임차비"]').evaluate('el=>el.indeterminate')
            assert page.locator('[data-multi="category"]').evaluate('el=>el.open')
            for mode in ['mom','yoy','ytd','ytd_yoy','qoq']:
                page.select_option('#dashboard-compare',mode)
                check_item_chart()
                bars=page.locator('#dashboard-chart [data-series="조회 비용"]')
                total=sum(float(bar.get_attribute('data-value')) for bar in bars.all())
                assert page.locator('.kpi .value').first.inner_text()=='₩'+format(int(total),',')
                for bar in bars.all():
                    amount=page.evaluate("""month=>JSON.parse(localStorage.getItem('scm-logistics-review-v1')).costs.filter(r=>r.month===month&&['보관료','입출고비'].includes(r.category)).reduce((n,r)=>n+r.amount,0)""",bar.get_attribute('data-month'))
                    assert float(bar.get_attribute('data-value'))==amount
            choose('category-parent','보관·임차비')
            assert page.locator('[data-category-parent="보관·임차비"]').is_checked()
            assert page.locator('#category').evaluate('el=>[...el.selectedOptions].some(o=>o.value==="지급임차료")')
            choose('category-parent','보관·임차비')
            assert page.locator('#category').evaluate('el=>[...el.selectedOptions].map(o=>o.value)')==['입출고비']
            choose('category','all')
            # Non-contiguous month selection must not silently include September.
            choose('month','2026-08')
            page.select_option('#dashboard-compare','mom');check_item_chart()
            assert page.locator('#dashboard-chart [data-series="조회 비용"]').evaluate_all("els=>els.map(e=>e.dataset.month)")==['2026-08','2026-10']
            assert page.locator('#dashboard-chart [data-series="비교 비용"]').evaluate_all("els=>els.map(e=>e.dataset.month)")==['2026-07','2026-09']
            multi_total=sum(float(e.get_attribute('data-value')) for e in page.locator('#dashboard-chart [data-series="조회 비용"]').all())
            assert page.locator('.kpi .value').first.inner_text()=='₩'+format(int(multi_total),',')
            for mode in ['yoy','ytd','ytd_yoy','qoq']:
                page.select_option('#dashboard-compare',mode);check_item_chart()
                values=page.locator('#dashboard-chart [data-series="조회 비용"]').evaluate_all('els=>els.map(e=>e.dataset.month)')
                assert len(values)==len(set(values))
            page.click('[data-view=costs]')
            assert page.locator('[data-edit]').count()==36
            page.click('[data-cost-tab=center]');assert page.locator('[data-edit]').count()==36
            page.click('[data-cost-layout=rows]')
            center_columns=page.locator('#cost-records-table th').all_text_contents()
            assert '센터' in center_columns and '유형 / 업무' in center_columns and '수출입관리번호' not in center_columns
            assert page.locator('#cost-records-table tbody tr').first.locator('td').count()==len(center_columns)
            page.click('[data-cost-tab=trade]');assert page.locator('[data-edit]').count()==0
            trade_columns=page.locator('#cost-records-table th').all_text_contents()
            assert '센터' not in trade_columns and '수출입관리번호' in trade_columns and '외화·환율 근거' in trade_columns and '출발국 → 도착국' in trade_columns
            assert page.locator('#center').evaluate('el=>el.closest("label").hidden')
            page.click('[data-cost-tab=common]');assert page.locator('[data-edit]').count()==0
            common_columns=page.locator('#cost-records-table th').all_text_contents()
            assert '센터' not in common_columns and '수출입관리번호' not in common_columns and '금액 (KRW)' in common_columns
            assert len(common_columns)<len(trade_columns)
            page.click('#cost-tab-entry');assert page.locator('#unified-entry').get_attribute('data-domain')=='common'
            page.click('[data-view=costs]');page.click('[data-cost-tab=all]')

            with page.expect_download() as multi_download:page.click('#export')
            multi_csv=Path(multi_download.value.path()).read_text(encoding='utf-8-sig')
            assert '2026-08' in multi_csv and '2026-10' in multi_csv and '2026-09' not in multi_csv
            page.click('[data-view=dashboard]')
            choose('month','2026-08');page.select_option('#dashboard-compare','mom')
            assert page.locator('.kpi .value').first.inner_text()==monthly
            choose('month','all');check_item_chart()
            all_total=sum(float(e.get_attribute('data-value')) for e in page.locator('#dashboard-chart [data-series="조회 비용"]').all())
            assert page.locator('.kpi .value').first.inner_text()=='₩'+format(int(all_total),',')
            choose('month','2026-10')
            before_master=page.evaluate("localStorage.getItem('scm-logistics-review-v1')")
            page.click('[data-view=masters]')
            page.fill('#master-add [name=parentCategory]','포워딩')
            page.fill('#master-add [name=name]','해상 운송료')
            page.click('#master-add button[type=submit]')
            page.wait_for_function("JSON.parse(localStorage.getItem('scm-logistics-review-v1')).masters.some(m=>m.name==='해상 운송료'&&m.parentCategory==='포워딩')")
            parent_input=page.locator('tr').filter(has=page.locator('[aria-label="보관료 대분류"]')).locator('[data-master-parent]')
            parent_input.fill('센터 보관비');parent_input.dispatch_event('change')
            page.wait_for_function("JSON.parse(localStorage.getItem('scm-logistics-review-v1')).masters.some(m=>m.name==='보관료'&&m.parentCategory==='센터 보관비')")
            page.reload();page.wait_for_selector('.kpi')
            choose('category-parent','센터 보관비')
            assert page.locator('#category option[value="보관료"]').count()==1
            page.click('[data-view=entry]')
            assert page.locator('[data-u=category] optgroup[label="포워딩"] option[value="해상 운송료"]').count()==1
            page.evaluate("value=>localStorage.setItem('scm-logistics-review-v1',value)",before_master)
            page.reload();page.wait_for_selector('.kpi')
            choose('center','인천 물류센터');choose('center','용인 물류센터')
            choose('category','보관료');choose('category','입출고비')
            expected=page.evaluate("""()=>{const s=JSON.parse(localStorage.getItem('scm-logistics-review-v1'));return s.costs.filter(r=>r.month==='2026-10'&&['인천 물류센터','용인 물류센터'].includes(r.center)&&['보관료','입출고비'].includes(r.category)).reduce((n,r)=>n+r.amount,0)}""")
            for mode in ['mom','yoy','ytd','ytd_yoy','qoq']:
                page.select_option('#dashboard-compare',mode)
                check_item_chart()
                bar=page.locator('#dashboard-chart [data-series="조회 비용"][data-month="2026-10"]')
                assert float(bar.get_attribute('data-value'))==expected
                assert page.locator('#center').evaluate('(el)=>[...el.selectedOptions].length')==2
                assert page.locator('#category').evaluate('(el)=>[...el.selectedOptions].length')==2
                if mode=='mom':
                    assert page.locator('.kpi .value').first.inner_text()=='₩'+format(expected,',')
                    prev=page.evaluate("""()=>JSON.parse(localStorage.getItem('scm-logistics-review-v1')).costs.filter(r=>r.month==='2026-09'&&['인천 물류센터','용인 물류센터'].includes(r.center)&&['보관료','입출고비'].includes(r.category)).reduce((n,r)=>n+r.amount,0)""")
                    assert float(page.locator('#dashboard-chart [data-series="비교 비용"]').get_attribute('data-value'))==prev
            choose('center','all');choose('category','all')
            page.select_option('#dashboard-compare','mom')
            assert page.locator('.kpi .value').first.inner_text()==monthly
            page.reload();page.wait_for_selector('.kpi')
            original=page.evaluate("localStorage.getItem('scm-logistics-review-v1')")
            page.evaluate("""()=>{const key='scm-logistics-review-v1',s=JSON.parse(localStorage.getItem(key));s.countries.push({code:'JP',name:'일본'});s.costs=s.costs.map((r,i)=>({...r,storeId:s.stores[i%3].id,groupId:s.stores[i%3].groupId,countryCode:i%2?'JP':'KR',account:i%2?'B2C':'B2B'}));s.costs.push(...s.costs.map(r=>({...r,id:r.id+'-prior',month:r.month.replace('2026','2025'),amount:Math.round(r.amount/2)})));localStorage.setItem(key,JSON.stringify(s));}""")
            page.reload();page.wait_for_selector('.kpi')
            page.locator('#month').evaluate("el=>{el.value='2026-10';el.dispatchEvent(new Event('change'))}")
            choose('month','2025-08')
            page.select_option('#dashboard-compare','ytd_yoy');check_item_chart()
            current_points=page.locator('#dashboard-chart [data-series="조회 비용"]').evaluate_all('els=>els.map(e=>e.dataset.month)')
            assert len(current_points)==len(set(current_points)) and '2025-08' in current_points and '2026-10' in current_points
            page.set_viewport_size({'width':390,'height':844})
            assert page.evaluate('document.documentElement.scrollWidth')<=390
            page.set_viewport_size({'width':1440,'height':1050})
            choose('month','2025-08');page.select_option('#dashboard-compare','mom')

            for id,values in [('center',['인천 물류센터','용인 물류센터']),('category',['보관료','입출고비']),('country',['KR','JP']),('store',['s-seoul','s-busan']),('account',['B2C','B2B']),('domain',['center','trade'])]:
                for value in values:choose(id,value)
            for mode in ['mom','yoy','ytd','ytd_yoy','qoq']:
                page.select_option('#dashboard-compare',mode)
                check_item_chart()
                for series in ['조회 비용','비교 비용']:
                    for bar in page.locator(f'#dashboard-chart [data-series="{series}"]').all():
                        month=bar.get_attribute('data-month')
                        amount=page.evaluate("""month=>JSON.parse(localStorage.getItem('scm-logistics-review-v1')).costs.filter(r=>r.month===month&&['인천 물류센터','용인 물류센터'].includes(r.center)&&['보관료','입출고비'].includes(r.category)&&['s-seoul','s-busan'].includes(r.storeId)&&['B2C','B2B'].includes(r.account)).reduce((n,r)=>n+r.amount,0)""",month)
                        assert float(bar.get_attribute('data-value'))==amount
                for store_bar in page.locator('#cost-store-chart [data-store-series="current"]').all():
                    scope=store_bar.get_attribute('data-store-name')
                    graph_months=page.locator('#dashboard-chart [data-series="조회 비용"]').evaluate_all('els=>els.map(e=>e.dataset.month)')
                    expected_store=page.evaluate("""({scope,months})=>{const [store,group]=JSON.parse(scope);return JSON.parse(localStorage.getItem('scm-logistics-review-v1')).costs.filter(r=>r.recordType!=='count'&&months.includes(r.month)&&['인천 물류센터','용인 물류센터'].includes(r.center)&&['보관료','입출고비'].includes(r.category)&&r.storeId===store&&r.groupId===group).reduce((n,r)=>n+r.amount,0)}""",{'scope':scope,'months':graph_months})
                    assert float(store_bar.get_attribute('data-value'))==expected_store
                chart_total=sum(float(bar.get_attribute('data-value')) for bar in page.locator('#dashboard-chart [data-series="조회 비용"]').all())
                assert page.locator('.kpi .value').first.inner_text()=='₩'+format(int(chart_total),',')
            assert page.locator('#group,[data-multi="group"]').count()==0
            assert page.locator('[data-multi="store"]').count()==1
            choose('store','s-seoul');choose('store','s-busan')
            assert page.locator('#store').evaluate("el=>[...el.selectedOptions].map(o=>o.value)")==['all']
            choose('group','g-retail')
            assert page.locator('[data-store-parent="g-retail"]').is_checked()
            expected_keys=page.locator('#store').evaluate('el=>[...el.selectedOptions].map(o=>JSON.parse(o.value))')
            assert all(pair[1]=='g-retail' for pair in expected_keys)
            assert ['', 'g-retail'] in expected_keys
            for mode in ['mom','yoy','ytd','ytd_yoy','qoq']:
                page.select_option('#dashboard-compare',mode);check_item_chart()
                for bar in page.locator('#dashboard-chart [data-series="조회 비용"]').all():
                    amount=page.evaluate("""month=>JSON.parse(localStorage.getItem('scm-logistics-review-v1')).costs.filter(r=>r.month===month&&['인천 물류센터','용인 물류센터'].includes(r.center)&&['보관료','입출고비'].includes(r.category)&&r.groupId==='g-retail').reduce((n,r)=>n+r.amount,0)""",bar.get_attribute('data-month'))
                    assert float(bar.get_attribute('data-value'))==amount
            choose('store','s-seoul')
            assert page.locator('[data-store-parent="g-retail"]').evaluate('el=>el.indeterminate')
            choose('store','s-partner')
            keys=page.locator('#store').evaluate('el=>[...el.selectedOptions].map(o=>JSON.parse(o.value))')
            assert ['s-busan','g-retail'] in keys and ['s-partner','g-partner'] in keys
            choose('store','all')
            page.evaluate("value=>localStorage.setItem('scm-logistics-review-v1',value)",original)
            page.reload();page.wait_for_selector('.kpi')
            assert page.locator('nav [data-view=tradeEntry]').count()==0
            page.click('nav [data-view=tradeReport]')
            assert page.locator('#title').inner_text()=='수출입 비용 관리'
            assert page.locator('#trade-tab-report').get_attribute('aria-selected')=='true'
            page.click('#add')
            assert page.locator('nav [data-view=tradeReport]').evaluate("el=>el.classList.contains('active')")
            page.fill('[name=shipment]','DRAFT-PRESERVED')
            page.click('#trade-tab-report');page.click('#trade-tab-entry')
            assert page.locator('[name=shipment]').input_value()=='DRAFT-PRESERVED'
            page.fill('[name=shipment]','EXP-E2E-001');page.fill('[name=ciplNo]','000012-CIPL');page.fill('[name=internalNo]','SCM-001')
            page.select_option('[name=incoterm]','CIF');assert page.locator('[data-unified-row]').count()==3
            page.select_option('[name=cargoType]','FCL');assert page.locator('[data-unified-row]').count()==3
            first=page.locator('[data-unified-row="0"]');first.locator('[data-u=mode]').select_option('fx')
            first.locator('[data-u=currency]').select_option('USD');first.locator('[data-u=foreignAmount]').fill('100');first.locator('[data-u=exchangeRate]').fill('1350');first.locator('[data-u=rateDate]').fill('2026-10-01')
            page.locator('[data-unified-row="1"] [data-u=amount]').fill('5000')
            assert page.locator('#unified-cost').inner_text()=='₩140,000'
            page.select_option('[name=incoterm]','FOB');assert page.locator('[data-unified-row]').count()==2
            page.select_option('[name=incoterm]','CIF');assert page.locator('[data-unified-row]').count()==3
            assert page.locator('[data-unified-row="0"] [data-u=foreignAmount]').input_value()=='100'
            page.click('#unified-entry button[type=submit]');page.wait_for_selector('#trade-report-results')
            assert page.locator('#trade-tab-report').get_attribute('aria-selected')=='true'
            assert 'EXP-E2E-001' in page.locator('#trade-report-results').inner_text()
            page.click('nav [data-view=costs]');page.wait_for_selector('[data-edit]')
            assert page.locator('tbody tr').count()==20
            page.click('[data-cost-tab=trade]');assert page.locator('[data-edit]').count()==2
            assert page.locator('#cost-records-table tbody tr').first.locator('td').count()==len(trade_columns)
            assert 'EXP-E2E-001' in page.locator('#cost-records-table').inner_text()
            page.click('[data-cost-tab=center]');assert page.locator('[data-edit]').count()==18
            page.click('[data-cost-tab=all]')

            assert page.evaluate("JSON.parse(localStorage.getItem('scm-logistics-review-v1')).costs.length")==110
            page.locator('[data-edit]').nth(18).click();page.fill('#record-edit [name=exchangeRate]','1400');page.click('#record-edit button[type=submit]')
            page.wait_for_selector('#record-edit',state='detached');assert '140,000' in page.locator('tbody').inner_text()
            with page.expect_download() as download:page.click('#template')
            template=temp/'template.xlsx';download.value.save_as(str(template));filled=temp/'filled.xlsx'
            generator="""import ExcelJS from 'exceljs';
const workbook=new ExcelJS.Workbook();await workbook.xlsx.readFile(process.argv[1]);const sheet=workbook.getWorksheet('통합 입력');
const headers=sheet.getRow(1).values.slice(1);const rows=[
{'월':'2026-10','비용유형':'수출입','데이터유형':'비용','국가코드':'KR','수출입관리번호':'EXP-E2E-002','수출입구분':'수출','출발국':'KR','도착국':'KR','업무구분':'공통','매장코드':'센터 공통','비용항목':'포워딩','CIPL NO.':'000015','인코텀즈':'CIP','화물타입':'AIR','비용그룹':'국제운송료','통화':'JPY','외화금액':10000,'적용환율':950,'환율적용단위':100,'환율기준일':'2026-10-01'},
{'월':'2026-10','비용유형':'물류센터','데이터유형':'건수','센터':'인천 물류센터','업무구분':'B2C','매장코드':'센터 공통','값':100}];
rows.forEach((row,i)=>sheet.getRow(i+2).values=headers.map(h=>row[h]??''));await workbook.xlsx.writeFile(process.argv[2]);"""
            subprocess.run(['node','--input-type=module','-e',generator,str(template),str(filled)],cwd=ROOT,check=True,capture_output=True,text=True)
            page.set_input_files('#file',str(filled));page.wait_for_selector('#commit-import');assert page.locator('#commit-import').is_enabled()
            assert '95,000' in page.locator('#upload-review').inner_text();assert '100건' in page.locator('#upload-review').inner_text()
            assert page.evaluate("JSON.parse(localStorage.getItem('scm-logistics-review-v1')).costs.length")==110
            page.click('#commit-import');page.wait_for_function("JSON.parse(localStorage.getItem('scm-logistics-review-v1')).costs.length===112")
            page.set_input_files('#file',str(filled));page.wait_for_selector('.import-errors');assert page.locator('#commit-import').is_disabled()
            with page.expect_download() as download:page.click('#export')
            report=temp/'report.csv';download.value.save_as(str(report))
            with report.open(encoding='utf-8-sig',newline='') as file:records=list(csv.DictReader(file))
            trade=[r for r in records if r['CIPL NO.']=='000015'];assert len(trade)==1 and trade[0]['공급가액']=='95000' and trade[0]['통화']=='JPY'
            counts=[r for r in records if r['데이터유형']=='건수'];assert counts and all(r['공급가액']=='0' for r in counts)
            page.reload();page.wait_for_selector('.kpi');assert page.locator('.kpi .value').first.inner_text()=='₩111,178,000'
            check_item_chart()
            assert page.locator('#record-type,[data-multi="record-type"]').count()==0
            page.select_option('#item-chart-level','parent');check_item_chart()
            page.set_viewport_size({'width':390,'height':844})
            assert page.locator('#cost-item-chart').evaluate('el=>el.scrollWidth<=el.clientWidth')
            left=page.locator('#cost-item-chart').bounding_box();right=page.locator('#cost-store-chart').bounding_box()
            assert right['y']>=left['y']+left['height']
            assert page.locator('#cost-store-chart').evaluate('el=>el.scrollWidth<=el.clientWidth')
            assert page.locator('#efficiency-chart').evaluate('el=>el.scrollWidth<=el.clientWidth')
            assert page.locator('#cost-waterfall').evaluate('el=>el.scrollWidth<=el.clientWidth')
            page.select_option('#item-chart-level','child')
            page.set_viewport_size({'width':1440,'height':1050})
            screenshot=os.environ.get('REVIEW_SCREENSHOT')
            if screenshot:page.screenshot(path=screenshot,full_page=True)
            page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth')<=390,page.evaluate("[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>391&&e.getBoundingClientRect().width>0&&!(()=>{for(let p=e.parentElement;p&&p!==document.body;p=p.parentElement)if(['hidden','auto','scroll'].includes(getComputedStyle(p).overflowX))return true;return false})()).map(e=>[e.tagName,e.className,e.getBoundingClientRect().right]).slice(0,20)")
            # High-row-count lists stay bounded; searches and exports still cover the complete scope.
            page.set_viewport_size({'width':1440,'height':1050})
            page.evaluate("""()=>{const key='scm-logistics-review-v1',s=JSON.parse(localStorage.getItem(key)),base=s.costs.find(r=>r.domain==='center'&&r.recordType==='cost');s.costs=Array.from({length:2000},(_,i)=>({...base,id:'bulk-'+i,month:'2026-10',memo:'BULK-'+String(i).padStart(5,'0')}));s.costs[0].id='bulk-0\"><img src=x onerror=window.__costXss=1>';s.sales=[];s.activity=[];localStorage.setItem(key,JSON.stringify(s));}""")
            page.reload();page.wait_for_selector('.kpi');page.click('[data-view=costs]')
            assert page.locator('#cost-records-table tbody tr').count()==100
            assert page.locator('#cost-count').inner_text()=='2000건'
            assert page.locator('#cost-list img').count()==0 and page.evaluate('window.__costXss===undefined')
            page.click('[data-cost-page="1"]');assert 'BULK-00100' in page.locator('#cost-records-table').inner_text()
            page.fill('#cost-query','BULK-01999');assert page.locator('#cost-records-table tbody tr').count()==1
            assert 'BULK-01999' in page.locator('#cost-records-table').inner_text()
            page.click('#cost-search-reset');assert page.locator('#cost-records-table tbody tr').count()==100
            with page.expect_download() as large_export:page.click('#export')
            with Path(large_export.value.path()).open(encoding='utf-8-sig',newline='') as f:assert len(list(csv.DictReader(f)))==2000
            assert not errors,errors
            assert all(url.startswith(origin) or url.startswith('blob:') for url in requests),requests
            browser.close()
        print('PASS: store + category comparison charts + two-level category master + dependent filters + multi-filter period charts + target UI removal + auto rows + FX + mixed KRW, preservation, edit, actual XLSX import, preview-before-save, duplicate rejection, report, count exclusion, reload, mobile; no external requests')
    finally:
        server.terminate()
        try:server.wait(timeout=10)
        except subprocess.TimeoutExpired:server.kill();server.wait()

if __name__=='__main__':main()
