import { buildAntiJackScriptSegment } from './shim-anti-jack.ts';

export interface ProxyShimOptions {
  bypassExternalLinks?: boolean;
  rootUrl?: string;
}

export function buildProxyShim(
  origin: string,
  targetUrl: string,
  sessionId?: string,
  options?: ProxyShimOptions,
): string {
  const sidParam = sessionId ? '&sid=' + encodeURIComponent(sessionId) : '';
  const bypassExt = options?.bypassExternalLinks ?? true;
  const rootUrl = options?.rootUrl || targetUrl;
  return `<script>(function(){
  var realParent=null;
  try{realParent=window.parent;}catch(e){}
  try{Object.defineProperty(window,'top',{configurable:true,get:function(){return window.self;}});}catch(e){}
  try{Object.defineProperty(window,'parent',{configurable:true,get:function(){return window.self;}});}catch(e){}
  try{Object.defineProperty(window,'frameElement',{configurable:true,get:function(){return null;}});}catch(e){}

  var O=(window.location&&window.location.origin&&window.location.origin!=='null')?window.location.origin:${JSON.stringify(origin.replace(/\/+$/, ''))};
  var T=${JSON.stringify(targetUrl)};
  var SID=${JSON.stringify(sidParam)};
  var BYPASS_EXT=${JSON.stringify(bypassExt)};
  var ROOT_URL=${JSON.stringify(rootUrl)};
  var TO='';
  try{TO=new URL(T).origin;}catch(e){}

  try{
    if(navigator.serviceWorker){
      var blockedSw=function(){return Promise.reject(new Error('sw off'));};
      try{navigator.serviceWorker.register=blockedSw;}
      catch(e){
        try{Object.defineProperty(navigator.serviceWorker,'register',{configurable:true,value:blockedSw});}catch(e2){}
      }
    }
  }catch(e){}

  function b64(s){
    var u=unescape(encodeURIComponent(s));
    return btoa(u).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
  }

  function decodeB64(s){
    try{
      var pad=String(s).replace(/-/g,'+').replace(/_/g,'/');
      while(pad.length%4)pad+='=';
      return decodeURIComponent(escape(atob(pad)));
    }catch(e){return null;}
  }

  function isAlreadyProxied(u){
    return typeof u==='string'&&(u.indexOf(O+'/api/asset?')===0||u.indexOf(O+'/api/proxy?')===0||u.indexOf('/api/asset?')===0||u.indexOf('/api/proxy?')===0);
  }

  function unwrapProxied(u){
    if(typeof u!=='string'||!isAlreadyProxied(u))return null;
    try{
      var base=O||(window.location&&window.location.origin)||'http://localhost';
      var parsed=new URL(u,base);
      var raw=parsed.searchParams.get('u');
      return raw?decodeB64(raw):null;
    }catch(e){return null;}
  }

  function abs(u){
    if(typeof u!=='string')return null;
    var unwrapped=unwrapProxied(u);
    if(unwrapped)return unwrapped;
    var trimmed=u.trim();
    if(!trimmed||/^(#|javascript:|mailto:|tel:|data:|blob:|about:)/i.test(trimmed))return null;
    try{
      if(O&&trimmed.indexOf(O+'/')===0&&!isAlreadyProxied(trimmed)){
        return new URL(trimmed.slice(O.length),T).href;
      }
      return new URL(trimmed,T).href;
    }catch(e){return null;}
  }

  function isHttp(a){
    return typeof a==='string'&&(a.indexOf('http://')===0||a.indexOf('https://')===0);
  }

  function toAsset(u){
    if(isAlreadyProxied(u))return u;
    var a=abs(u);
    if(!a||!isHttp(a))return u;
    return '/api/asset?u='+b64(a)+SID;
  }

  function toFrame(u){
    if(isAlreadyProxied(u))return u;
    var a=abs(u);
    if(!a||!isHttp(a))return u;
    var extra='&extbypass='+(BYPASS_EXT?'1':'0')+(ROOT_URL?'&root='+b64(ROOT_URL):'');
    return '/api/proxy?u='+b64(a)+SID+extra;
  }

  function notifyParent(payload){
    try{
      if(realParent&&realParent!==window&&typeof realParent.postMessage==='function'){
        realParent.postMessage(payload,O||'*');
      }
    }catch(e){}
  }

  ${buildAntiJackScriptSegment()}

  var origSetAttr=Element.prototype.setAttribute;

  function forceSelfTarget(el){
    if(!el||typeof el.getAttribute!=='function')return;
    try{
      var t=el.getAttribute('target');
      if(t&&t.trim().toLowerCase()!=='_self'){
        origSetAttr.call(el,'target','_self');
      }
      var ft=el.getAttribute('formtarget');
      if(ft&&ft.trim().toLowerCase()!=='_self'){
        origSetAttr.call(el,'formtarget','_self');
      }
      if(el.hasAttribute('ping')){
        el.removeAttribute('ping');
      }
    }catch(e){}
  }

  var ps=history.pushState, rs=history.replaceState;
  try{
    var targetParsed=new URL(T);
    var targetPath=targetParsed.pathname+targetParsed.search+targetParsed.hash;
    if(rs){rs.call(history,null,'',targetPath||'/');}
  }catch(e){}

  history.pushState=function(s,t,u){
    var mapped=u;
    if(typeof u==='string'){
      var a=abs(u);
      if(a){
        if(BYPASS_EXT&&isExternalDest(a)){
          notifyExternalBypass(a);
          return;
        }
        try{
          var p=new URL(a);
          if(p.origin===TO){
            mapped=p.pathname+p.search+p.hash;
            T=a;
            notifyParent({type:'cdnfree:navigate',url:a});
          }else{
            mapped=toFrame(a);
          }
        }catch(e){}
      }
    }
    try{return ps.call(this,s,t,mapped);}catch(e){}
  };

  history.replaceState=function(s,t,u){
    var mapped=u;
    if(typeof u==='string'){
      var a=abs(u);
      if(a){
        if(BYPASS_EXT&&isExternalDest(a)){
          notifyExternalBypass(a);
          return;
        }
        try{
          var p=new URL(a);
          if(p.origin===TO){
            mapped=p.pathname+p.search+p.hash;
            T=a;
            notifyParent({type:'cdnfree:navigate',url:a});
          }else{
            mapped=toFrame(a);
          }
        }catch(e){}
      }
    }
    try{return rs.call(this,s,t,mapped);}catch(e){}
  };

  try{
    if(window.Location&&Location.prototype){
      var origLocReplace=Location.prototype.replace;
      var origLocAssign=Location.prototype.assign;
      if(typeof origLocReplace==='function'){
        Object.defineProperty(Location.prototype,'replace',{configurable:true,value:function(u){
          try{
            if(typeof u==='string'){
              var raw=(unwrapProxied(u)||u);
              var a=abs(raw);
              if(BYPASS_EXT&&a&&isHttp(a)&&isExternalDest(a)){
                notifyExternalBypass(a);
                return;
              }
              if(!isAlreadyProxied(u)&&a&&isHttp(a)){
                notifyParent({type:'cdnfree:redirect',url:a});
                return origLocReplace.call(this,toFrame(a));
              }
            }
          }catch(e){}
          return origLocReplace.call(this,u);
        }});
      }
      if(typeof origLocAssign==='function'){
        Object.defineProperty(Location.prototype,'assign',{configurable:true,value:function(u){
          try{
            if(typeof u==='string'){
              var raw=(unwrapProxied(u)||u);
              var a=abs(raw);
              if(BYPASS_EXT&&a&&isHttp(a)&&isExternalDest(a)){
                notifyExternalBypass(a);
                return;
              }
              if(!isAlreadyProxied(u)&&a&&isHttp(a)){
                notifyParent({type:'cdnfree:redirect',url:a});
                return origLocAssign.call(this,toFrame(a));
              }
            }
          }catch(e){}
          return origLocAssign.call(this,u);
        }});
      }
    }
  }catch(e){}

  var of=window.fetch;
  if(typeof of==='function'){
    window.fetch=function(i,init){
      try{
        var method=((init&&init.method)||(typeof i==='object'&&i&&i.method)||'GET').toUpperCase();
        var u=typeof i==='string'?i:(i&&i.url);
        if((method==='GET'||method==='HEAD')&&u&&!isAlreadyProxied(u)){
          var a=abs(u);
          if(a&&isHttp(a)){
            var p=toAsset(a);
            notifyParent({type:'cdnfree:asset',url:a});
            i=(typeof i==='string')?p:new Request(p,i);
          }
        }
      }catch(e){}
      return of.call(this,i,init);
    };
  }

  var oo=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,u){
    var args=[].slice.call(arguments);
    try{
      var method=String(m||'GET').toUpperCase();
      if((method==='GET'||method==='HEAD')&&typeof u==='string'&&!isAlreadyProxied(u)){
        var a=abs(u);
        if(a&&isHttp(a)){
          args[1]=toAsset(a);
          notifyParent({type:'cdnfree:asset',url:a});
        }
      }
    }catch(e){}
    return oo.apply(this,args);
  };

  function rewriteSrcsetVal(val){
    return String(val).split(',').map(function(part){
      var pieces=part.trim().split(/\\s+/);
      var first=pieces[0];
      if(!first)return part.trim();
      var proxied=toAsset(first);
      pieces[0]=proxied;
      return pieces.join(' ');
    }).join(', ');
  }

  Element.prototype.setAttribute=function(name,value){
    try{
      var lower=String(name).toLowerCase();
      var tag=this.tagName?this.tagName.toLowerCase():'';
      if(lower==='target'||lower==='formtarget'){
        var normTarget=typeof value==='string'?value.trim().toLowerCase():'';
        if(normTarget&&normTarget!=='_self'){
          value='_self';
        }
      }else if(lower==='ping'&&(tag==='a'||tag==='area')){
        return;
      }else if(typeof value==='string'&&!isAlreadyProxied(value)){
        if((lower==='src'||lower==='poster'||lower==='data-src')&&tag!=='a'){
          var a=abs(value);
          if(a&&isHttp(a)){
            value=tag==='iframe'||tag==='frame'?toFrame(a):toAsset(a);
            notifyParent({type:'cdnfree:asset',url:a});
          }
        }else if(lower==='href'&&tag==='link'){
          var ah=abs(value);
          if(ah&&isHttp(ah)){
            value=toAsset(ah);
            notifyParent({type:'cdnfree:asset',url:ah});
          }
        }else if(lower==='href'&&(tag==='a'||tag==='area')){
          var al=abs(value);
          if(al&&isHttp(al)){
            value=toFrame(al);
          }
        }else if(lower==='srcset'||lower==='data-srcset'){
          value=rewriteSrcsetVal(value);
        }
      }
    }catch(e){}
    return origSetAttr.call(this,name,value);
  };

  function patchProp(proto,prop,asFrame){
    if(!proto)return;
    var desc=Object.getOwnPropertyDescriptor(proto,prop);
    if(!desc||typeof desc.set!=='function')return;
    Object.defineProperty(proto,prop,{
      configurable:true,
      enumerable:desc.enumerable,
      get:desc.get,
      set:function(v){
        try{
          if(typeof v==='string'&&!isAlreadyProxied(v)){
            var a=abs(v);
            if(a&&isHttp(a)){
              v=asFrame?toFrame(a):toAsset(a);
              notifyParent({type:'cdnfree:asset',url:a});
            }
          }
        }catch(e){}
        return desc.set.call(this,v);
      }
    });
  }

  function patchTargetProp(proto,prop){
    if(!proto)return;
    var desc=Object.getOwnPropertyDescriptor(proto,prop);
    if(!desc||typeof desc.set!=='function')return;
    Object.defineProperty(proto,prop,{
      configurable:true,
      enumerable:desc.enumerable,
      get:desc.get,
      set:function(v){
        var norm=typeof v==='string'?v.trim().toLowerCase():'';
        return desc.set.call(this,norm&&norm!=='_self'?'_self':v);
      }
    });
  }

  try{
    patchProp(window.HTMLImageElement&&HTMLImageElement.prototype,'src',false);
    patchProp(window.HTMLScriptElement&&HTMLScriptElement.prototype,'src',false);
    patchProp(window.HTMLMediaElement&&HTMLMediaElement.prototype,'src',false);
    patchProp(window.HTMLVideoElement&&HTMLVideoElement.prototype,'poster',false);
    patchProp(window.HTMLSourceElement&&HTMLSourceElement.prototype,'src',false);
    patchProp(window.HTMLLinkElement&&HTMLLinkElement.prototype,'href',false);
    patchProp(window.HTMLIFrameElement&&HTMLIFrameElement.prototype,'src',true);
    patchTargetProp(window.HTMLAnchorElement&&HTMLAnchorElement.prototype,'target');
    patchTargetProp(window.HTMLAreaElement&&HTMLAreaElement.prototype,'target');
    patchTargetProp(window.HTMLFormElement&&HTMLFormElement.prototype,'target');
    patchTargetProp(window.HTMLButtonElement&&HTMLButtonElement.prototype,'formTarget');
    patchTargetProp(window.HTMLInputElement&&HTMLInputElement.prototype,'formTarget');
  }catch(e){}

  function scrubDynamicTargets(root){
    if(!root||typeof root.querySelectorAll!=='function')return;
    try{
      var nodes=root.querySelectorAll('a[target],area[target],form[target],base[target],[formtarget]');
      for(var i=0;i<nodes.length;i+=1){
        forceSelfTarget(nodes[i]);
      }
    }catch(e){}
  }

  try{
    if(typeof MutationObserver==='function'){
      var mo=new MutationObserver(function(mutations){
        for(var i=0;i<mutations.length;i+=1){
          var added=mutations[i].addedNodes;
          for(var j=0;j<added.length;j+=1){
            var node=added[j];
            if(node&&node.nodeType===1){
              forceSelfTarget(node);
              scrubDynamicTargets(node);
              if(isClickjackOverlay(node)){
                neutralizeOverlay(node);
              }
            }
          }
        }
      });
      mo.observe(document.documentElement||document,{childList:true,subtree:true});
    }
  }catch(e){}

  notifyParent({type:'cdnfree:ready',url:T});
})();</script>`;
}
