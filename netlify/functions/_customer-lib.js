const lib=require('./_admin-lib');

function clean(v,n=500){return String(v??'').trim().slice(0,n);}
async function upsertCustomer(input,{incrementRequest=false}={}){
  const payload={
    p_first_name:clean(input.first_name,100),
    p_last_name:clean(input.last_name,100)||null,
    p_email:clean(input.email,200).toLowerCase()||null,
    p_phone:clean(input.phone,80)||null,
    p_address_line1:clean(input.street_address||input.address_line1,300)||null,
    p_city:clean(input.city,120)||null,
    p_province:clean(input.province,80)||null,
    p_postal_code:clean(input.postal_code,30)||null,
    p_increment_request:!!incrementRequest
  };
  try{
    const d=await lib.sbJson('/rest/v1/rpc/please_upsert_customer',{method:'POST',body:JSON.stringify(payload)});
    return typeof d==='string'?d:(Array.isArray(d)?d[0]:d);
  }catch(e){
    // Backward-compatible deployment order: public booking must continue even if
    // the STEP 15.9 SQL has not been run yet. The release instructions require SQL first.
    console.warn('_customer-lib:upsert',e?.message||e);
    return null;
  }
}
module.exports={upsertCustomer};
