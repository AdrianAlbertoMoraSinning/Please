(()=>{
  const KEY='please_provider_tab_session';
  const nativeFetch=window.fetch.bind(window);
  const get=()=>{try{return sessionStorage.getItem(KEY)||''}catch{return''}};
  const set=t=>{try{if(t)sessionStorage.setItem(KEY,t);else sessionStorage.removeItem(KEY)}catch{}};
  window.PLEASE_PROVIDER_SESSION={get,set,clear:()=>set('')};
  window.fetch=(input,init={})=>{
    try{
      const u=new URL(typeof input==='string'?input:input.url,location.href);
      if(u.origin===location.origin && u.pathname.startsWith('/.netlify/functions/provider-')){
        const token=get();
        if(token){const h=new Headers(init.headers||(typeof input!=='string'?input.headers:undefined)||{});h.set('x-please-provider-session',token);init={...init,headers:h};}
      }
    }catch(_){ }
    return nativeFetch(input,init);
  };
  const isLogin=/provider-login\.html$/i.test(location.pathname);
  if(!isLogin && !get()){const requested=location.hash.replace(/^#/,'');const allowed=new Set(['overview','assignments','calendar','services','availability','rates','documents','photos','history','profile','account','manual']);const next=allowed.has(requested)?requested:'overview';location.replace(`provider-login.html?reason=tab-session&next=${encodeURIComponent(next)}`);}
})();
