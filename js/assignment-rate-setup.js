(function(root){
 'use strict';
 const units=new Set(['hour','service','item','load','room','sq_ft','day','other']);
 const money=n=>Math.round(n*100)/100;
 function prepare(input){
  const name=String(input.name||'').trim().slice(0,160),unit=String(input.unit||'service'),method=String(input.method||'FIXED_CAD');
  const customerText=String(input.customer??'').trim(),providerText=String(input.provider??'').trim(),customer=Number(customerText),provider=Number(providerText);
  if(!name||!units.has(unit)||!['FIXED_CAD','PERCENT'].includes(method))throw Error('Enter a rate name, billing type and Provider compensation method.');
  if(!customerText||!providerText||!Number.isFinite(customer)||!Number.isFinite(provider)||customer<0||provider<0)throw Error('Enter both the PLEASE Customer Rate and Provider Rate. Enter 0 explicitly only when no charge applies.');
  if(method==='PERCENT'&&provider>100)throw Error('Provider percentage cannot exceed 100%.');
  if(input.multiDay&&unit==='hour')throw Error('Use Flat Rate or Quantity for a multi-day service period.');
  const quantity=unit==='hour'?Math.max(.25,Math.round((Number(input.minutes)||15)/15)/4):1;
  return {payload:{service_id:input.serviceId,rate_name:name,billing_unit:unit,provider_compensation_method:method,provider_compensation:money(provider)},customerRate:money(customer),quantity};
 }
 const api={prepare};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PleaseAssignmentRate=api;
})(typeof window!=='undefined'?window:this);
