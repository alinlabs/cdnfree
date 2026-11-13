export function buildAntiJackScriptSegment(): string {
  return `
  function siteKey(h){
    var clean=String(h||'').trim().toLowerCase().replace(/^www\\./,'').replace(/\\.+$/,'');
    var parts=clean.split('.').filter(Boolean);
    if(parts.length<=2)return clean;
    var tld=parts[parts.length-1],sld=parts[parts.length-2];
    if(tld.length===2&&/^(co|com|net|org|edu|gov|ac|my|biz|web|or|go|sch|mil)$/i.test(sld)){
      return parts.slice(-3).join('.');
    }
    return parts.slice(-2).join('.');
  }

  function isExternalDest(destUrl){
    try{
      var real=unwrapProxied(destUrl)||destUrl;
      var d=new URL(real,T);
      var r=new URL(ROOT_URL||T);
      if(d.protocol!=='http:'&&d.protocol!=='https:')return false;
      if(d.hostname.toLowerCase()===r.hostname.toLowerCase())return false;
      return siteKey(d.hostname)!==siteKey(r.hostname);
    }catch(e){return false;}
  }

  function notifyExternalBypass(url){
    var real=unwrapProxied(url)||abs(url)||String(url||'');
    notifyParent({type:'cdnfree:external-bypassed',url:real});
    return real;
  }

  try{
    Object.defineProperty(window,'__cdnfreeBypassExt',{configurable:true,value:function(u){
      notifyExternalBypass(u);
      return false;
    }});
  }catch(e){}

  function noop(){}

  function createDecoyWindow(requestedUrl){
    var fakeLoc={
      href:String(requestedUrl||'about:blank'),
      assign:noop,
      replace:noop,
      reload:noop,
      toString:function(){return this.href;}
    };
    var fakeDoc={
      open:noop,
      write:noop,
      writeln:noop,
      close:noop,
      title:'',
      body:{appendChild:noop,removeChild:noop},
      head:{appendChild:noop,removeChild:noop},
      createElement:function(){return {style:{},setAttribute:noop,appendChild:noop,click:noop};}
    };
    return {
      closed:false,
      opener:window.self,
      name:'',
      location:fakeLoc,
      document:fakeDoc,
      focus:noop,
      blur:noop,
      close:function(){this.closed=true;},
      postMessage:noop,
      addEventListener:noop,
      removeEventListener:noop,
      moveTo:noop,
      resizeTo:noop,
      scrollTo:noop
    };
  }

  function blockedWindowOpen(url,target){
    var targetNorm=typeof target==='string'?target.trim().toLowerCase():'';
    var dest=typeof url==='string'?abs(url):null;
    if(BYPASS_EXT&&dest&&isExternalDest(dest)){
      notifyExternalBypass(dest);
      notifyParent({type:'cdnfree:popup-blocked',url:dest});
      return createDecoyWindow(dest);
    }
    if(targetNorm==='_self'&&dest&&isHttp(dest)){
      try{
        if(new URL(dest).origin===TO){
          notifyParent({type:'cdnfree:navigate',url:dest});
          location.href=toFrame(dest);
          return window.self;
        }
      }catch(e){}
    }
    notifyParent({type:'cdnfree:popup-blocked',url:dest||String(url||'')});
    return createDecoyWindow(dest||url);
  }

  try{
    Object.defineProperty(window,'open',{configurable:true,writable:false,value:blockedWindowOpen});
  }catch(e){
    try{window.open=blockedWindowOpen;}catch(e2){}
  }
  try{
    if(window.Window&&Window.prototype){
      Object.defineProperty(Window.prototype,'open',{configurable:true,writable:false,value:blockedWindowOpen});
    }
  }catch(e){}

  try{
    if(window.navigation&&typeof window.navigation.addEventListener==='function'){
      window.navigation.addEventListener('navigate',function(e){
        if(!BYPASS_EXT||!e||!e.destination||!e.destination.url)return;
        var rawDest=e.destination.url;
        var real=unwrapProxied(rawDest)||rawDest;
        if(isHttp(real)&&isExternalDest(real)&&e.cancelable){
          e.preventDefault();
          notifyExternalBypass(real);
        }
      });
    }
  }catch(e){}

  function patchAnchorClick(proto){
    if(!proto||typeof proto.click!=='function')return;
    var origClick=proto.click;
    proto.click=function(){
      try{
        var rawTarget=(this.getAttribute('target')||'').trim().toLowerCase();
        forceSelfTarget(this);
        var h=this.getAttribute('href')||'';
        var dest=abs(h);
        if(BYPASS_EXT&&!this.hasAttribute('download')&&(this.getAttribute('data-cdnfree-external')==='1'||(dest&&isExternalDest(dest)))){
          notifyExternalBypass(dest||h);
          return;
        }
        if(!this.isConnected&&!this.hasAttribute('download')){
          notifyParent({type:'cdnfree:popup-blocked',url:h});
          return;
        }
        if(rawTarget&&rawTarget!=='_self'&&!this.hasAttribute('download')){
          if(dest&&isHttp(dest)){
            notifyParent({type:'cdnfree:navigate',url:dest});
            location.href=toFrame(dest);
          }
          return;
        }
      }catch(e){}
      return origClick.apply(this,arguments);
    };
  }

  try{
    patchAnchorClick(window.HTMLAnchorElement&&HTMLAnchorElement.prototype);
    patchAnchorClick(window.HTMLAreaElement&&HTMLAreaElement.prototype);
    if(window.HTMLFormElement&&HTMLFormElement.prototype&&typeof HTMLFormElement.prototype.submit==='function'){
      var origFormSubmit=HTMLFormElement.prototype.submit;
      HTMLFormElement.prototype.submit=function(){
        try{
          forceSelfTarget(this);
          var act=abs(this.getAttribute('action')||T);
          if(BYPASS_EXT&&act&&(this.getAttribute('data-cdnfree-external')==='1'||isExternalDest(act))){
            notifyExternalBypass(act);
            return;
          }
          if(act&&isHttp(act))origSetAttr.call(this,'action',toFrame(act));
        }catch(e){}
        return origFormSubmit.apply(this,arguments);
      };
    }
  }catch(e){}

  function isClickjackOverlay(el){
    if(!el||el.nodeType!==1)return false;
    var tag=el.tagName?el.tagName.toLowerCase():'';
    if(tag==='html'||tag==='body'||tag==='video'||tag==='audio'||tag==='input'||tag==='textarea'||tag==='select'||tag==='button'||tag==='label'||tag==='canvas'){
      return false;
    }
    try{
      var st=window.getComputedStyle(el);
      if(!st)return false;
      if(st.pointerEvents==='none')return false;
      if(st.position!=='fixed'&&st.position!=='absolute')return false;
      var rect=el.getBoundingClientRect();
      var vw=window.innerWidth||document.documentElement.clientWidth||0;
      var vh=window.innerHeight||document.documentElement.clientHeight||0;
      if(!vw||!vh)return false;
      var opacity=parseFloat(st.opacity||'1');
      if(opacity<=0.05&&rect.width>=vw*0.35&&rect.height>=vh*0.35)return true;
      var z=parseInt(st.zIndex||'0',10);
      var hasVisibleContent=Boolean((el.textContent||'').trim())||Boolean(el.querySelector('img,video,svg,canvas,input,button,select,textarea,iframe'));
      var bg=(st.backgroundColor||'').replace(/\\s+/g,'').toLowerCase();
      var isTransparentBg=!bg||bg==='transparent'||bg==='rgba(0,0,0,0)';
      var isExternalEl=el.getAttribute('data-cdnfree-external')==='1'||(tag==='a'&&isExternalDest(el.getAttribute('href')||''));
      if(BYPASS_EXT&&isExternalEl&&!hasVisibleContent&&isTransparentBg&&rect.width>=60&&rect.height>=60){
        return true;
      }
      var coversLarge=rect.width>=vw*0.45&&rect.height>=vh*0.45;
      if(coversLarge&&!hasVisibleContent&&isTransparentBg&&(z>=50||tag==='a')){
        return true;
      }
    }catch(e){}
    return false;
  }

  function neutralizeOverlay(el,ev){
    try{el.style.setProperty('pointer-events','none','important');}catch(e){}
    if(ev){
      try{ev.preventDefault();}catch(e){}
      try{ev.stopPropagation();}catch(e){}
      try{ev.stopImmediatePropagation();}catch(e){}
    }
  }

  ['pointerdown','mousedown','touchstart'].forEach(function(evtName){
    document.addEventListener(evtName,function(e){
      var t=e.target;
      if(isClickjackOverlay(t)){
        neutralizeOverlay(t,e);
        return;
      }
      var overlayLink=t&&t.closest&&t.closest('a,area');
      if(overlayLink){
        forceSelfTarget(overlayLink);
        if(isClickjackOverlay(overlayLink)){
          neutralizeOverlay(overlayLink,e);
        }
      }
    },true);
  });

  function handleLinkActivation(e){
    var rawTargetEl=e.target;
    if(isClickjackOverlay(rawTargetEl)){
      neutralizeOverlay(rawTargetEl,e);
      return;
    }
    var a=rawTargetEl&&rawTargetEl.closest&&rawTargetEl.closest('a[href],area[href]');
    if(!a)return;
    if(isClickjackOverlay(a)){
      neutralizeOverlay(a,e);
      return;
    }
    forceSelfTarget(a);
    var h=a.getAttribute('href');
    if(!h||/^(#|javascript:|mailto:|tel:|data:)/i.test(h)){
      if(a.getAttribute('target')==='_blank'){
        e.preventDefault();
      }
      return;
    }
    if(a.hasAttribute('download'))return;
    var dest=abs(h);
    if(BYPASS_EXT&&(a.getAttribute('data-cdnfree-external')==='1'||(dest&&isExternalDest(dest)))){
      e.preventDefault();
      notifyExternalBypass(dest||h);
      return;
    }
    if(!dest||!isHttp(dest))return;
    e.preventDefault();
    notifyParent({type:'cdnfree:navigate',url:dest});
    location.href=toFrame(dest);
  }

  document.addEventListener('click',handleLinkActivation,true);
  document.addEventListener('auxclick',handleLinkActivation,true);

  document.addEventListener('submit',function(e){
    var f=e.target;if(!f)return;
    forceSelfTarget(f);
    var act=abs(f.getAttribute('action')||T)||T;
    if(BYPASS_EXT&&(f.getAttribute('data-cdnfree-external')==='1'||isExternalDest(act))){
      e.preventDefault();
      notifyExternalBypass(act);
      return;
    }
    var m=(f.getAttribute('method')||'get').toLowerCase();
    if(m!=='get'){
      var postAction=abs(f.getAttribute('action')||T);
      if(postAction&&isHttp(postAction)){
        origSetAttr.call(f,'action',toFrame(postAction));
      }
      return;
    }
    e.preventDefault();
    try{
      var nextUrl=new URL(act);
      var fd=new URLSearchParams(new FormData(f));
      fd.forEach(function(v,k){nextUrl.searchParams.set(k,v);});
      notifyParent({type:'cdnfree:navigate',url:nextUrl.href});
      location.href=toFrame(nextUrl.href);
    }catch(err){}
  },true);
`;
}
