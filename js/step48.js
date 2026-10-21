(function(){
  var H = window.__anHook;
  var scr = document.getElementById('screen-analyze');
  if(!H || !scr){ console.warn('step 48: Analyze page not found, skipped'); return; }

  var TBMAX = 7;                 // Syzygy tablebases cover up to 7 pieces (kings included)
  var TB_URL = 'https://tablebase.lichess.ovh/standard?fen=';
  var REPORT_PATH = 'reports';   // top level on purpose (not under hb), see the Firebase rules note
  var LAB = {book:'Book move', best:'Best move', excellent:'Excellent', good:'Good', inaccuracy:'Inaccuracy', mistake:'Mistake', blunder:'Blunder'};

  function esc(s){ return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function side(c){ return c === 'w' ? 'White' : 'Black'; }
  function pieceCount(fen){ return (String(fen).split(' ')[0].match(/[a-zA-Z]/g) || []).length; }
  function moveNo(fen){ var p = String(fen).split(' '); return (parseInt(p[5], 10) || 1) + (p[1] === 'w' ? '.' : '...'); }

  // ---------- styles ----------
  var st = document.createElement('style');
  st.textContent =
    '.tb-box{margin-top:14px;padding:10px 12px;border-radius:8px;background:#eaf3ef;color:#155646;}' +
    '.tb-box h4{margin:0 0 6px !important;color:inherit !important;}' +
    '.tb-box p{margin:0 0 6px;font-size:13.5px;line-height:1.55;}' +
    '.tb-box .tb-warn{font-weight:600;}' +
    '.tb-box .tb-foot{font-size:11.5px;opacity:.75;margin:4px 0 0;}' +
    '[data-theme=dark] .tb-box{background:#1f3a33;color:#8fd3bc;}' +
    '.rp-row{margin-top:14px;text-align:right;}' +
    '.rp-link{font-size:12px;opacity:.7;cursor:pointer;text-decoration:underline;text-underline-offset:3px;background:none;border:0;padding:0;color:inherit;font-family:inherit;font-weight:500;}' +
    '.rp-link:hover{opacity:1;background:none;box-shadow:none;transform:none;}' +
    '.rp-ov{position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(0,0,0,.45);z-index:1200;display:flex;align-items:center;justify-content:center;padding:16px;}' +
    '.rp-box{background:#fffdf9;border:1px solid #e4ddcf;border-radius:12px;padding:22px;max-width:460px;width:100%;max-height:92vh;overflow:auto;box-shadow:0 12px 40px rgba(0,0,0,.3);color:#22201b;}' +
    '[data-theme=dark] .rp-box{background:#252320;border-color:#3a372f;color:#e8e4d8;}' +
    '.rp-box h3{margin:0 0 6px;font-size:18px;}' +
    '.rp-box .hint{margin:0 0 12px;}' +
    '.rp-box select,.rp-box textarea{width:100%;border:1px solid #d8d1bf;border-radius:7px;padding:9px 10px;font-size:13.5px;font-family:inherit;background:#fff;color:inherit;margin-bottom:10px;}' +
    '.rp-box textarea{min-height:84px;resize:vertical;}' +
    '[data-theme=dark] .rp-box select,[data-theme=dark] .rp-box textarea{background:#1b1a17;border-color:#4a463b;}' +
    '.rp-acts{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}';
  document.head.appendChild(st);

  // =====================================================================
  //  1. Tablebase (Lichess, free, no key). One request at a time, cached.
  // =====================================================================
  var TB = {}, TBP = {}, chain = Promise.resolve(), fails = 0, tbDown = false;

  function tbFen(fen){
    var p = String(fen).split(' ');
    return p[0] + '_' + p[1] + '_-_-_0_1';        // no castling / en passant: tablebases do not use them
  }
  function tbKey(fen){ var p = String(fen).split(' '); return p[0] + ' ' + p[1]; }

  function doFetch(fen){
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = setTimeout(function(){ if(ctl) ctl.abort(); }, 8000);
    return fetch(TB_URL + tbFen(fen), ctl ? {signal:ctl.signal} : undefined).then(function(r){
      clearTimeout(timer);
      if(!r.ok) return {ok:false, perm:true};         // not covered / bad request: remember "no answer"
      return r.json().then(function(j){ return {ok:true, v:j}; });
    }).catch(function(e){
      clearTimeout(timer);
      return {ok:false, perm:false, err:e};           // network problem: do not remember
    });
  }
  function tbQuery(fen){
    var k = tbKey(fen);
    if(tbDown) return Promise.resolve(null);
    if(TB[k] !== undefined) return Promise.resolve(TB[k]);
    if(TBP[k]) return TBP[k];
    var pr = chain = chain
      .then(function(){ return new Promise(function(r){ setTimeout(r, 120); }); })   // be polite to the free API
      .then(function(){ return doFetch(fen); })
      .then(function(res){
        delete TBP[k];
        if(res.ok){ fails = 0; TB[k] = res.v; return res.v; }
        if(res.perm){ TB[k] = null; return null; }
        console.warn('tablebase request failed', res.err);
        if(++fails >= 3){ tbDown = true; }            // stop hammering if it is blocked or offline
        return null;
      });
    TBP[k] = pr;
    return pr;
  }

  function broad(c){
    return c === 'win' ? 'W' : c === 'loss' ? 'L' : (c === 'draw' || c === 'cursed-win' || c === 'blessed-loss') ? 'D' : null;
  }
  function flip(b){ return b === 'W' ? 'L' : (b === 'L' ? 'W' : b); }
  var RANK = {L:0, D:1, W:2};

  function describe(fen, r){
    var t = fen.split(' ')[1], me = side(t), o = side(t === 'w' ? 'b' : 'w'), c = r.category, out;
    if(r.checkmate) return 'Checkmate. ' + o + ' wins.';
    if(r.stalemate) return 'Stalemate: the game is a draw.';
    if(r.insufficient_material) return 'A draw: neither side has enough material to win.';
    if(c === 'win') out = me + ' wins with correct play.';
    else if(c === 'loss') out = o + ' wins with correct play.';
    else if(c === 'draw') out = 'A theoretical draw.';
    else if(c === 'cursed-win') out = 'A draw in practice: ' + me + ' has a win on paper, but the 50-move rule saves ' + o + '.';
    else if(c === 'blessed-loss') out = 'A draw in practice: ' + o + ' has a win on paper, but the 50-move rule saves ' + me + '.';
    else return null;
    if(r.moves && r.moves.length && r.moves[0].san) out += ' Best move for ' + me + ' here: ' + esc(r.moves[0].san) + '.';
    return out;
  }

  function compare(A, k, r1, r2){
    if(!r1 || !r2 || r1.checkmate || r1.stalemate) return null;
    var m = A.moves[k - 1], mine = (m.color === A.me), who = mine ? 'You' : 'Your opponent';
    var b0 = broad(r1.category), a0 = flip(broad(r2.category));     // both from the mover's point of view
    if(!b0 || !a0) return null;
    var label = A.stats[k - 1].label, slip = (label === 'inaccuracy' || label === 'mistake' || label === 'blunder');
    var fine = (label === 'best' || label === 'excellent' || label === 'good' || label === 'book');
    var fifty = (r2.category === 'cursed-win' || r2.category === 'blessed-loss') ? ' The rest comes down to the 50-move rule.' : '';
    if(RANK[a0] < RANK[b0]){
      var what = (b0 === 'W' && a0 === 'D') ? 'threw away a win: it was winning before this move and is only a draw now.'
               : (b0 === 'W' && a0 === 'L') ? 'turned a won ending into a loss.'
               : 'turned a drawn ending into a loss.';
      var pre = (mine && fine) ? 'The engine rated this move "' + (LAB[label] || label).toLowerCase() + '", but the tablebase shows the result changed. ' : '';
      return {warn:true, text:pre + who + ' ' + what + fifty};
    }
    if(RANK[a0] === RANK[b0] && mine && slip){
      if(b0 === 'W') return {text:'You were winning before this move and you still are, so the engine\u2019s "' + (LAB[label] || label).toLowerCase() + '" is only about speed. The win is still intact.'};
      if(b0 === 'D') return {text:'The position is still a draw after your move, so no result was lost.'};
      return {text:'The position was already lost and still is, so this changes nothing in theory.'};
    }
    return null;
  }

  function fillTablebase(box, A, k){
    var afterFen = A.fens[k], beforeFen = A.fens[k - 1];
    var needBefore = pieceCount(beforeFen) <= TBMAX;
    Promise.all([tbQuery(afterFen), needBefore ? tbQuery(beforeFen) : Promise.resolve(null)]).then(function(rs){
      if(H.data() !== A) return;
      var r2 = rs[0], r1 = rs[1], txt = r2 ? describe(afterFen, r2) : null;
      if(!txt){
        A.tbNone = A.tbNone || {}; A.tbNone[k] = 1;
        if(box.parentNode) box.parentNode.removeChild(box);
        return;
      }
      if(!box.isConnected || A.sel !== k) return;
      var cmp = null;
      try{ cmp = compare(A, k, r1, r2); }catch(e){ console.error('tablebase compare failed', e); }
      var h = '<h4>Endgame tablebase</h4>' +
        (cmp ? '<p class="tb-warn">' + esc(cmp.text) + '</p>' : '') +
        '<p>Position after this move: ' + txt + '</p>' +
        '<p class="tb-foot">Exact result from the Lichess Syzygy tablebase (7 pieces or fewer). It is perfect play, so it overrides the engine when they disagree.</p>';
      box.innerHTML = h;
    });
  }

  // =====================================================================
  //  2. Report a bad comment
  // =====================================================================
  var lastSent = 0, sentCount = 0, sentKeys = {};

  function commentText(panel){
    var c = panel.cloneNode(true);
    c.querySelectorAll('.rp-row, .tb-box').forEach(function(x){ x.remove(); });
    return (c.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function closeDlg(){ var o = document.getElementById('rpOv'); if(o && o.parentNode) o.parentNode.removeChild(o); }

  function openReport(A, k){
    if(typeof ME === 'undefined' || !ME){ return; }
    var panel = document.getElementById('anPanel');
    if(!panel || !A.moves[k - 1]) return;
    var text = commentText(panel), m = A.moves[k - 1], S = A.stats[k - 1];
    closeDlg();
    var ov = document.createElement('div');
    ov.id = 'rpOv'; ov.className = 'rp-ov';
    ov.addEventListener('mousedown', function(e){ if(e.target === ov) closeDlg(); });
    ov.innerHTML =
      '<div class="rp-box" role="dialog" aria-label="Report a wrong comment">' +
        '<h3>Report a wrong comment</h3>' +
        '<p class="hint">Move ' + esc(moveNo(A.fens[k - 1]) + ' ' + m.san) + '. This sends the position and the coach text to the developer so the rule can be fixed. Your username is attached.</p>' +
        '<select id="rpWhy">' +
          '<option>The coach named a tactic that is not there (fork, pin, skewer...)</option>' +
          '<option>The label is wrong (Best / Mistake / Blunder...)</option>' +
          '<option>The advice or explanation is wrong</option>' +
          '<option>Something false about the position</option>' +
          '<option>Other</option>' +
        '</select>' +
        '<textarea id="rpNote" maxlength="300" placeholder="What was wrong? (optional, 300 characters)"></textarea>' +
        '<div class="rp-acts"><button id="rpSend">Send report</button><button class="secondary" id="rpCancel">Cancel</button><span class="hint" id="rpMsg" style="margin:0;"></span></div>' +
      '</div>';
    document.body.appendChild(ov);
    var msg = document.getElementById('rpMsg'), send = document.getElementById('rpSend');
    document.getElementById('rpCancel').onclick = closeDlg;
    send.onclick = function(){
      var key = A.fens[k] + '|' + k + '|' + text.slice(0, 80);
      if(sentKeys[key]){ msg.textContent = 'You already reported this one. Thank you!'; return; }
      if(Date.now() - lastSent < 8000){ msg.textContent = 'Please wait a few seconds between reports.'; return; }
      if(sentCount >= 15){ msg.textContent = 'That is plenty of reports for now. Thank you!'; return; }
      send.disabled = true; msg.textContent = 'Sending...';
      var rec = {
        v:1, user:ME.username, ts:firebase.database.ServerValue.TIMESTAMP,
        why:String(document.getElementById('rpWhy').value).slice(0, 120),
        note:String(document.getElementById('rpNote').value || '').slice(0, 300),
        move:m.san, ply:k, side:A.me, label:S.label,
        evBefore:Math.round(S.cpBefore), evAfter:Math.round(S.cpAfter),
        fenBefore:A.fens[k - 1], fenAfter:A.fens[k],
        text:text.slice(0, 1500)
      };
      db.ref(REPORT_PATH).push(rec).then(function(){
        lastSent = Date.now(); sentCount++; sentKeys[key] = 1;
        msg.textContent = 'Sent. Thank you, this helps a lot!';
        setTimeout(closeDlg, 1100);
      }).catch(function(e){
        console.error('report failed', e);
        send.disabled = false;
        msg.textContent = (e && e.code === 'PERMISSION_DENIED') ? "Couldn't send (the Firebase rules for reports are not published yet)." : "Couldn't send. Try again.";
      });
    };
  }
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape') closeDlg(); });

  // =====================================================================
  //  3. Put both into the explanation panel (same trick as step 45)
  // =====================================================================
  var busy = false;
  function patch(){
    var A = H.data(), p = document.getElementById('anPanel');
    if(!A || !p || !A.moves || !A.fens || A.sel < 1 || !A.moves[A.sel - 1]) return;
    var k = A.sel;
    if(!p.querySelector('.rp-row')){
      var row = document.createElement('div');
      row.className = 'rp-row';
      row.innerHTML = '<button class="rp-link" type="button">Report a wrong comment</button>';
      p.appendChild(row);
      row.querySelector('button').onclick = function(){ var A2 = H.data(); if(A2) openReport(A2, A2.sel); };
    }
    if(!tbDown && !p.querySelector('.tb-box') && pieceCount(A.fens[k]) <= TBMAX && !(A.tbNone && A.tbNone[k])){
      var box = document.createElement('div');
      box.className = 'an-sec tb-box';
      box.innerHTML = '<h4>Endgame tablebase</h4><p>Checking the tablebase...</p>';
      p.insertBefore(box, p.querySelector('.rp-row'));
      fillTablebase(box, A, k);
    }
  }
  new MutationObserver(function(){
    if(busy) return;
    busy = true;
    try{ patch(); }catch(e){ console.error('step 48 failed', e); }
    busy = false;
  }).observe(scr, {childList:true, subtree:true});
})();
/* ===== END STEP 48 ===== */
