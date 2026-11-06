export function normalizeSearch(value){return String(value??'').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,'');}
export function searchIncludes(value,query){return normalizeSearch(value).includes(normalizeSearch(query));}
export function matchingStores(query,stores,{existingId=''}={}){return stores.filter(s=>(s.active||s.id===existingId)&&(searchIncludes(`${s.code} ${s.name}`,query)||searchIncludes(`${s.code} · ${s.name}`,query)));}
