const menuButton=document.querySelector('.menu-toggle');const navLinks=document.querySelector('.nav-links');menuButton?.addEventListener('click',()=>navLinks.classList.toggle('open'));document.querySelectorAll('.nav-links a').forEach(a=>a.addEventListener('click',()=>navLinks.classList.remove('open')));document.querySelectorAll('a[href^="#"]').forEach(link=>{link.addEventListener('click',e=>{const t=document.querySelector(link.getAttribute('href'));if(t){e.preventDefault();t.scrollIntoView({behavior:'smooth',block:'start'});}})});
const quoteForm=document.getElementById('quote-form');if(quoteForm){quoteForm.addEventListener('submit',e=>{e.preventDefault();const full=quoteForm.querySelector('[name="full_name"]')?.value.trim()||'';const parts=full.split(/\s+/);const data={first_name:parts.shift()||'',phone:quoteForm.querySelector('[name="phone"]')?.value.trim()||'',email:quoteForm.querySelector('[name="email"]')?.value.trim()||'',work_description:quoteForm.querySelector('[name="details"]')?.value.trim()||''};sessionStorage.setItem('please_request_prefill',JSON.stringify(data));window.location.href='service-request.html';});}

// Reliable navigation for the independent Join Our Team module.
document.addEventListener('click',function(e){
  const link=e.target.closest('a.join-team-link');
  if(!link)return;
  e.preventDefault();
  window.location.assign('/work-with-us.html');
},true);
