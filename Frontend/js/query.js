// query.js
// logic for the Query page (local similarity checks)

(function(){
  const ws = new WebSocket(APP.wsUrl());
  let issues = [];

  const statusDot = APP.el('status-dot');
  const statusText = APP.el('status-text');
  const queryInput = APP.el('queryInput');
  const checkBtn = APP.el('checkBtn');
  const suggestBtn = APP.el('suggestBtn');
  const results = APP.el('results');
  const issuesPanel = APP.el('issuesPanel');
  const countEl = APP.el('count');
  const refreshBtn = APP.el('refreshBtn');

  function setStatus(s){
    if (s === 'connected') { statusDot.style.background = '#34d399'; statusText.textContent = 'Connected'; }
    else if (s === 'connecting') { statusDot.style.background = '#f59e0b'; statusText.textContent = 'Connecting...'; }
    else { statusDot.style.background = '#ef4444'; statusText.textContent = 'Disconnected'; }
  }

  function normalize(s=''){ return (s||'').toLowerCase().replace(/[`~!@#$%^&*()_+\-=\[\]{};:"\\|<>\/?]/g,' ').replace(/\s+/g,' ').trim(); }
  function tokens(s=''){ return new Set(normalize(s).split(' ').filter(Boolean)); }
  function jaccard(a='', b=''){ const A = tokens(a), B = tokens(b); if (A.size===0 && B.size===0) return 1; if (A.size===0||B.size===0) return 0; let inter=0; for (const t of A) if (B.has(t)) inter++; return inter / new Set([...A,...B]).size; }

  ws.addEventListener('open', () => { setStatus('connected'); ws.send('__dump_issues__'); });
  ws.addEventListener('close', () => { setStatus('disconnected'); setTimeout(()=>location.reload(),2000); });
  ws.addEventListener('error', ()=> setStatus('disconnected'));

  ws.addEventListener('message', ev => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'bot') {
        try {
          const body = JSON.parse(msg.text);
          if (body && body.cmd === 'dump_issues' && Array.isArray(body.issues)) { issues = body.issues; renderIssuesPanel(); return; }
        } catch (e) {}
      }
    } catch(e){}
  });

  function renderIssuesPanel(){
    issuesPanel.innerHTML = '';
    countEl.textContent = String(issues.length);
    if (!issues.length) { issuesPanel.innerHTML = '<div class="text-sm text-slate-400">No saved issues.</div>'; return; }
    issues.forEach(i => {
      const div = document.createElement('div');
      div.className = 'p-2 rounded-lg bg-slate-800 border border-slate-700';
      div.innerHTML = `<div class="font-semibold">${APP.escapeHtml(i.title)}</div><div class="text-xs text-slate-400">${APP.escapeHtml(i.raw)}</div><div class="text-xs text-slate-400 mt-1">id: <span class="mono">${APP.escapeHtml(i.id)}</span></div>`;
      issuesPanel.appendChild(div);
    });
  }

  checkBtn.addEventListener('click', () => {
    const q = (queryInput.value || '').trim(); results.innerHTML = ''; if (!q) return;
    if (!issues.length) return results.innerHTML = '<div class="text-sm text-slate-400">No saved issues to check against.</div>';
    const scored = issues.map(i => {
      const score = 0.4 * jaccard(q, i.title || '') + 0.6 * jaccard(q, i.raw || '');
      return { issue: i, score };
    }).sort((a,b) => b.score - a.score);
    const top = scored[0];
    results.innerHTML = `<div class="p-3 rounded-lg bg-slate-800 border border-slate-700"><div class="text-sm text-slate-400">Best match (score ${top.score.toFixed(3)})</div><div class="font-semibold mt-1">${APP.escapeHtml(top.issue.title)}</div><div class="text-xs text-slate-400 mt-1">${APP.escapeHtml(top.issue.raw)}</div></div>`;
  });

  suggestBtn.addEventListener('click', () => {
    const q = (queryInput.value || '').trim(); results.innerHTML = ''; if (!q) return;
    if (!issues.length) return results.innerHTML = '<div class="text-sm text-slate-400">No saved issues.</div>';
    const scored = issues.map(i => ({ issue: i, score: 0.4*jaccard(q,i.title||'') + 0.6*jaccard(q,i.raw||'') })).sort((a,b)=>b.score - a.score);
    const list = scored.slice(0,10).filter(s => s.score > 0);
    if (!list.length) return results.innerHTML = '<div class="text-sm text-slate-400">No similar issues found.</div>';
    const container = document.createElement('div'); container.className='space-y-2';
    list.forEach(s => {
      const d = document.createElement('div'); d.className='p-2 rounded-lg bg-slate-800 border border-slate-700';
      d.innerHTML = `<div class="text-xs text-slate-400">score ${s.score.toFixed(3)}</div><div class="font-semibold">${APP.escapeHtml(s.issue.title)}</div><div class="text-xs text-slate-400 mt-1">${APP.escapeHtml(s.issue.raw)}</div>`;
      container.appendChild(d);
    });
    results.appendChild(container);
  });

  refreshBtn.addEventListener('click', ()=> { if (ws.readyState === WebSocket.OPEN) ws.send('__dump_issues__'); });
})();
