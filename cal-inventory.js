const lib=require('./_admin-lib');
const enc=v=>encodeURIComponent(String(v??''));
const clean=(v,n=1000)=>String(v??'').trim().slice(0,n);
const money=v=>Math.round((Number(v)||0)*100)/100;
const qty=v=>Math.round((Number(v)||0)*10000)/10000;
const today=()=>new Date().toISOString().slice(0,10);
function bodyOf(event){try{return JSON.parse(event.body||'{}')}catch{const e=new Error('Invalid JSON body.');e.status=400;throw e}}
function bad(message,status=400){const e=new Error(message);e.status=status;throw e}
function rpcScalar(v){if(Array.isArray(v))v=v[0];if(v&&typeof v==='object'){const k=Object.keys(v);if(k.length===1)return v[k[0]];}return v}
async function safe(path,fallback=[]){try{return await lib.sbJson(path)}catch(e){if(/does not exist|schema cache|42P01|42703/i.test(String(e.message||e)))return fallback;throw e}}
async function rpc(name,body){return lib.sbJson(`/rest/v1/rpc/${name}`,{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(body||{})})}
async function audit(auth,event,objectType,objectId,eventType,afterData){try{await lib.sbJson('/rest/v1/accounting_audit_log',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({actor_user_id:null,event_type:eventType,object_type:objectType,object_id:String(objectId||''),after_data:afterData||null,metadata:{step:'18.6',source:'CAL_INVENTORY_API',please_admin_user_id:auth.user.id,actor_email:auth.user.email,ip:lib.requestIp(event)||null,user_agent:lib.requestUserAgent(event)||null}})});}catch(e){console.warn('cal-inventory audit',e?.message||e)}}

async function getData(){
  const [items,locations,balances,movements,counts,countLines,parties,roles,accounts,glRaw,subRaw]=await Promise.all([
    safe('/rest/v1/accounting_inventory_items?select=*&order=sku.asc&limit=2000',[]),
    safe('/rest/v1/accounting_inventory_locations?select=*&order=code.asc&limit=500',[]),
    safe('/rest/v1/accounting_inventory_balances?select=*&order=item_id.asc,location_id.asc&limit=10000',[]),
    safe('/rest/v1/accounting_inventory_movements?select=*&order=movement_date.desc,created_at.desc&limit=1000',[]),
    safe('/rest/v1/accounting_inventory_counts?select=*&order=count_date.desc,created_at.desc&limit=250',[]),
    safe('/rest/v1/accounting_inventory_count_lines?select=*&order=inventory_count_id.asc,item_id.asc&limit=10000',[]),
    safe('/rest/v1/accounting_parties?select=id,party_number,legal_name,display_name,email,active&active=eq.true&order=legal_name.asc',[]),
    safe('/rest/v1/accounting_party_roles?select=party_id,role,active&role=eq.SUPPLIER&active=eq.true',[]),
    safe('/rest/v1/accounting_accounts?select=id,code,name,account_type,account_subtype,active&active=eq.true&order=code.asc',[]),
    rpc('accounting_inventory_gl_balance',{p_as_of:today()}).catch(()=>0),
    rpc('accounting_inventory_subledger_value',{}).catch(()=>0)
  ]);
  const itemMap=new Map((items||[]).map(x=>[x.id,x])),locMap=new Map((locations||[]).map(x=>[x.id,x])),partyMap=new Map((parties||[]).map(x=>[x.id,x]));
  const supplierIds=new Set((roles||[]).map(r=>r.party_id));
  const balanceByItem=new Map();for(const b of balances||[]){if(!balanceByItem.has(b.item_id))balanceByItem.set(b.item_id,[]);balanceByItem.get(b.item_id).push({...b,location:locMap.get(b.location_id)||null});}
  const normalizedItems=(items||[]).map(i=>{const rows=balanceByItem.get(i.id)||[],onHand=qty(rows.reduce((n,b)=>n+Number(b.quantity_on_hand||0),0)),value=money(rows.reduce((n,b)=>n+Number(b.inventory_value||0),0)),avg=onHand>0?Math.round(value/onHand*1e6)/1e6:0;return{...i,preferred_supplier:partyMap.get(i.preferred_supplier_party_id)||null,on_hand:onHand,inventory_value:value,average_unit_cost:avg,low_stock:i.active&&Number(i.reorder_point||0)>0&&onHand<=Number(i.reorder_point||0),balances:rows};});
  const movementRows=(movements||[]).map(m=>({...m,item:itemMap.get(m.item_id)||null,location:locMap.get(m.location_id)||null}));
  const countLineMap=new Map();for(const l of countLines||[]){if(!countLineMap.has(l.inventory_count_id))countLineMap.set(l.inventory_count_id,[]);countLineMap.get(l.inventory_count_id).push({...l,item:itemMap.get(l.item_id)||null});}
  const normalizedCounts=(counts||[]).map(c=>({...c,location:locMap.get(c.location_id)||null,lines:countLineMap.get(c.id)||[]}));
  const gl=money(rpcScalar(glRaw)),sub=money(rpcScalar(subRaw)),difference=money(gl-sub);
  const metrics={activeItems:normalizedItems.filter(x=>x.active).length,locations:(locations||[]).filter(x=>x.active).length,totalQuantity:qty(normalizedItems.reduce((n,x)=>n+x.on_hand,0)),subledgerValue:sub,glValue:gl,difference,lowStock:normalizedItems.filter(x=>x.low_stock).length,openCounts:normalizedCounts.filter(x=>x.status==='DRAFT').length};
  return{items:normalizedItems,locations:locations||[],balances:balances||[],movements:movementRows,counts:normalizedCounts,suppliers:(parties||[]).filter(p=>supplierIds.has(p.id)),accounts:accounts||[],metrics,valuationMethod:'MOVING_AVERAGE',manufacturingEnabled:false};
}

async function saveItem(auth,event,p){const result=await rpc('accounting_save_inventory_item',{p_id:clean(p.id,80)||null,p_sku:clean(p.sku,80),p_name:clean(p.name,180),p_description:clean(p.description,1000)||null,p_category:clean(p.category,120)||null,p_unit_of_measure:(clean(p.unit_of_measure,20)||'EA').toUpperCase(),p_preferred_supplier_party_id:clean(p.preferred_supplier_party_id,80)||null,p_reorder_point:Number(p.reorder_point||0),p_active:p.active!==false,p_actor_id:String(auth.user.id)});const id=String(rpcScalar(result)||'');if(!id)throw Error('Inventory item save did not return an id.');await audit(auth,event,'accounting_inventory_items',id,'INVENTORY_ITEM_SAVED',{sku:p.sku,name:p.name});return id}
async function saveLocation(auth,event,p){const result=await rpc('accounting_save_inventory_location',{p_id:clean(p.id,80)||null,p_code:clean(p.code,40),p_name:clean(p.name,180),p_location_type:(clean(p.location_type,30)||'WAREHOUSE').toUpperCase(),p_address:clean(p.address,500)||null,p_active:p.active!==false,p_actor_id:String(auth.user.id)});const id=String(rpcScalar(result)||'');if(!id)throw Error('Inventory location save did not return an id.');await audit(auth,event,'accounting_inventory_locations',id,'INVENTORY_LOCATION_SAVED',{code:p.code,name:p.name});return id}
async function movement(auth,event,p,type){const quantity=qty(p.quantity);if(quantity<=0)bad('Quantity must be greater than zero.');let unitCost=p.unit_cost===null||p.unit_cost===undefined||p.unit_cost===''?null:Number(p.unit_cost);if(unitCost!==null&&(!Number.isFinite(unitCost)||unitCost<0))bad('Unit cost is invalid.');const reason=clean(p.reason,600)||null;if(['ADJUSTMENT_GAIN','ADJUSTMENT_LOSS'].includes(type)&&!reason)bad('Adjustment reason is required.');const result=await rpc('accounting_inventory_apply_movement',{p_item_id:clean(p.item_id,80),p_location_id:clean(p.location_id,80),p_movement_type:type,p_movement_date:clean(p.movement_date,10)||today(),p_quantity:quantity,p_unit_cost:unitCost,p_reference:clean(p.reference,200)||null,p_reason:reason,p_project_reference:clean(p.project_reference,200)||null,p_source_table:null,p_source_record_id:null,p_source_line_id:null,p_source_key:clean(p.operation_key,120)?`MANUAL:${type}:${clean(p.operation_key,120)}`:null,p_actor_id:String(auth.user.id)});const id=String(rpcScalar(result)||'');if(!id)throw Error('Inventory movement did not return an id.');await audit(auth,event,'accounting_inventory_movements',id,type,{item_id:p.item_id,location_id:p.location_id,quantity,reference:p.reference||null});return id}
async function transfer(auth,event,p){const quantity=qty(p.quantity);if(quantity<=0)bad('Transfer quantity must be greater than zero.');const result=await rpc('accounting_inventory_transfer',{p_item_id:clean(p.item_id,80),p_from_location_id:clean(p.from_location_id,80),p_to_location_id:clean(p.to_location_id,80),p_transfer_date:clean(p.transfer_date,10)||today(),p_quantity:quantity,p_reference:clean(p.reference,200)||null,p_reason:clean(p.reason,600)||null,p_request_key:clean(p.operation_key,120)||null,p_actor_id:String(auth.user.id)});const id=String(rpcScalar(result)||'');if(!id)throw Error('Inventory transfer did not return a group id.');await audit(auth,event,'accounting_inventory_movements',id,'INVENTORY_TRANSFER',{item_id:p.item_id,from:p.from_location_id,to:p.to_location_id,quantity});return id}
async function createCount(auth,event,p){const result=await rpc('accounting_create_inventory_count',{p_location_id:clean(p.location_id,80),p_count_date:clean(p.count_date,10)||today(),p_reference:clean(p.reference,200)||null,p_notes:clean(p.notes,1000)||null,p_actor_id:String(auth.user.id)});const id=String(rpcScalar(result)||'');if(!id)throw Error('Physical count did not return an id.');await audit(auth,event,'accounting_inventory_counts',id,'INVENTORY_COUNT_CREATED',{location_id:p.location_id,count_date:p.count_date||today()});return id}
async function saveCountLine(auth,event,p){const counted=Number(p.counted_quantity);if(!Number.isFinite(counted)||counted<0)bad('Counted quantity must be zero or greater.');const result=await rpc('accounting_save_inventory_count_line',{p_count_id:clean(p.count_id,80),p_item_id:clean(p.item_id,80),p_counted_quantity:qty(counted),p_actor_id:String(auth.user.id)});return String(rpcScalar(result)||'')}
async function postCount(auth,event,p){const id=clean(p.count_id,80);const result=await rpc('accounting_post_inventory_count',{p_count_id:id,p_actor_id:String(auth.user.id)});const status=String(rpcScalar(result)||'');await audit(auth,event,'accounting_inventory_counts',id,'INVENTORY_COUNT_POSTED',{status});return status}

exports.handler=async event=>{
  if(!['GET','POST'].includes(event.httpMethod))return lib.json(405,{error:'Method not allowed'});
  if(event.httpMethod==='POST'&&!lib.sameOrigin(event))return lib.json(403,{error:'Invalid request origin.'});
  try{const auth=await lib.requireAdmin(event);if(event.httpMethod==='GET')return lib.json(200,{ok:true,data:await getData()});const b=bodyOf(event),action=String(b.action||'').toUpperCase(),p=b.payload||{};let result;
    if(action==='SAVE_ITEM')result={id:await saveItem(auth,event,p)};
    else if(action==='SAVE_LOCATION')result={id:await saveLocation(auth,event,p)};
    else if(action==='OPENING')result={id:await movement(auth,event,p,'OPENING')};
    else if(action==='ISSUE')result={id:await movement(auth,event,p,'ISSUE')};
    else if(action==='ADJUSTMENT_GAIN')result={id:await movement(auth,event,p,'ADJUSTMENT_GAIN')};
    else if(action==='ADJUSTMENT_LOSS')result={id:await movement(auth,event,p,'ADJUSTMENT_LOSS')};
    else if(action==='TRANSFER')result={id:await transfer(auth,event,p)};
    else if(action==='CREATE_COUNT')result={id:await createCount(auth,event,p)};
    else if(action==='SAVE_COUNT_LINE')result={id:await saveCountLine(auth,event,p)};
    else if(action==='POST_COUNT')result={status:await postCount(auth,event,p)};
    else return lib.json(400,{error:'Unsupported Inventory action.'});
    return lib.json(200,{ok:true,result,data:await getData()});
  }catch(e){console.error('cal-inventory',e);return lib.json(e.status||500,{error:e.message||'Unable to process Inventory Accounting.'});}
};
