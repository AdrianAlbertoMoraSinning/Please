const menuButton=document.querySelector('.menu-toggle');const navLinks=document.querySelector('.nav-links');menuButton?.addEventListener('click',()=>navLinks.classList.toggle('open'));document.querySelectorAll('.nav-links a').forEach(a=>a.addEventListener('click',()=>navLinks.classList.remove('open')));document.querySelectorAll('a[href^="#"]').forEach(link=>{link.addEventListener('click',e=>{const t=document.querySelector(link.getAttribute('href'));if(t){e.preventDefault();t.scrollIntoView({behavior:'smooth',block:'start'});}})});
const quoteForm=document.getElementById('quote-form');if(quoteForm){quoteForm.addEventListener('submit',e=>{e.preventDefault();const contact=quoteForm.querySelector('[name="contact"]')?.value.trim()||'';const data={phone:contact.includes('@')?'':contact,email:contact.includes('@')?contact:'',work_description:quoteForm.querySelector('[name="details"]')?.value.trim()||'',service_type:quoteForm.querySelector('[name="service_type"]')?.value.trim()||''};sessionStorage.setItem('please_request_prefill',JSON.stringify(data));window.location.href='service-request.html';});}

// Reliable navigation for the independent Join Our Team module.
document.addEventListener('click',function(e){
  const link=e.target.closest('a.join-team-link');
  if(!link)return;
  e.preventDefault();
  window.location.assign('/work-with-us.html#join-professional-network');
},true);
