const UNITS=new Set(['hour','service','item','load','room','sq_ft','day','other']);
function billingTerms(input={},fallback={}){
  let unit=String(input.unit??fallback.unit??'service').trim().toLowerCase();if(['hours','hr','hrs'].includes(unit))unit='hour';
  let quantity=Number(input.quantity??fallback.quantity??1);
  if(!UNITS.has(unit))throw Object.assign(new Error('Choose Hourly, Flat Rate or a valid quantity unit.'),{status:400});
  // Preserve legacy service quantities unless Flat Rate is explicitly selected.
  if(unit==='service'&&input.unit!=null)quantity=1;
  if(!Number.isFinite(quantity)||quantity<=0||quantity>1000000)throw Object.assign(new Error('Billing quantity must be a positive number.'),{status:400});
  if(unit==='hour'&&Math.abs(quantity*4-Math.round(quantity*4))>0.00001)throw Object.assign(new Error('Hourly quantities must use 15-minute increments.'),{status:400});
  quantity=Math.round(quantity*100)/100;if(quantity<=0)throw Object.assign(new Error('Billing quantity must be at least 0.01.'),{status:400});return{unit,quantity};
}
module.exports={billingTerms};
