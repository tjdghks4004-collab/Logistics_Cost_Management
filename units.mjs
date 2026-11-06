export const defaultBillingUnits=['PLT','BOX','EA','건','KG','CBM','월','일','일괄','원'];
export function validBillingUnit(value){return typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=30&&!/[\u0000-\u001f\u007f<>]/.test(value)&&value!=='all';}
export function billingUnitsFor(state){return [...new Set([...defaultBillingUnits,...(state.billingUnits||[]),...(state.masters||[]).map(m=>m.unit).filter(validBillingUnit)])];}
export function validateBillingUnits(state){const list=state.billingUnits??[];if(!Array.isArray(list)||list.length>300||list.some(v=>!validBillingUnit(v))||new Set(list.map(v=>v.toLocaleUpperCase())).size!==list.length)throw Error('청구 단위는 중복 없이 1~30자로 등록하세요.');}
