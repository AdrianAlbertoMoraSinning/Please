(()=>{
 const box=document.querySelector('[data-service-carousel]');if(!box)return;
 const image=box.querySelector('img'),caption=box.querySelector('[data-caption]'),toggle=box.querySelector('[data-pause]');
 const slides=[['moving','Moving help','PLEASE professionals loading a moving truck'],['cleaning','Home cleaning','Professional home cleaning service'],['delivery-and-pickup','Delivery & pickup','Delivery and pickup service'],['handyman-and-furniture-assembly','Handyman & assembly','Handyman and furniture assembly service'],['junk-removal','Junk removal','Professional junk removal service'],['outdoor-services','Outdoor services','Outdoor property services'],['car-detailing','Car detailing','Vehicle detailing service'],['painting','Painting','Professional painting service'],['plumbing','Plumbing','Professional plumbing service'],['electrical','Electrical','Professional electrical service'],['renovations','Renovations','Home renovation service']];
 let index=0,paused=matchMedia('(prefers-reduced-motion: reduce)').matches,timer;
 function show(i){index=(i+slides.length)%slides.length;const s=slides[index];image.src=`images/services/${s[0]}.jpg`;image.alt=s[2];caption.textContent=s[1];box.querySelector('[data-position]').textContent=`${index+1} / ${slides.length}`;}
 function schedule(){clearInterval(timer);toggle.textContent=paused?'Play':'Pause';toggle.setAttribute('aria-pressed',String(paused));if(!paused&&!document.hidden)timer=setInterval(()=>show(index+1),6000);}
 box.querySelector('[data-prev]').onclick=()=>{show(index-1);schedule()};box.querySelector('[data-next]').onclick=()=>{show(index+1);schedule()};toggle.onclick=()=>{paused=!paused;schedule()};
 box.addEventListener('focusin',()=>clearInterval(timer));box.addEventListener('focusout',schedule);box.addEventListener('pointerenter',()=>clearInterval(timer));box.addEventListener('pointerleave',schedule);document.addEventListener('visibilitychange',schedule);schedule();
})();
