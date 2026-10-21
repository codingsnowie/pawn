(function(){
  var P = null;
  function dir(){ return new URL('engine/', document.baseURI).href; }
  function handshake(w){
    return new Promise(function(res, rej){
      var t = setTimeout(function(){ try{ w.terminate(); }catch(e){} rej(new Error('engine timeout')); }, 60000);
      w.onmessage = function(e){ if(String(e.data).indexOf('uciok') >= 0){ clearTimeout(t); w.onmessage = null; res(w); } };
      w.onerror = function(){ clearTimeout(t); try{ w.terminate(); }catch(e){} rej(new Error('worker error')); };
      w.postMessage('uci');
    });
  }
  function ready(w){
    return new Promise(function(res){
      var t = setTimeout(function(){ w.removeEventListener('message', h); res(); }, 15000);
      function h(e){ if(String(e.data).indexOf('readyok') >= 0){ clearTimeout(t); w.removeEventListener('message', h); res(); } }
      w.addEventListener('message', h);
      w.postMessage('isready');
    });
  }
  window.PawniacSF = {
    kind: null,
    get: function(){
      if(P) return P;
      P = (async function(){
        var r = await fetch(dir() + 'engine.json', {cache:'no-cache'});
        if(!r.ok) throw new Error('no local engine');
        var m = await r.json();
        var w = new Worker(dir() + m.js);
        await handshake(w);
        w.postMessage('setoption name Threads value 1');
        w.postMessage('setoption name Hash value 64');
        await ready(w);
        window.PawniacSF.kind = m.js;
        return w;
      })();
      P.catch(function(){ P = null; });
      return P;
    }
  };
  setTimeout(function(){ try{ window.PawniacSF.get().catch(function(){}); }catch(e){} }, 1500);
})();
