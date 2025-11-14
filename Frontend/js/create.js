// create.js
// logic for the Create / Submit Issues page

(function(){
  const ws = new WebSocket(APP.wsUrl());

  const chatLog = APP.el('chat-log');
  const form = APP.el('message-form');
  const input = APP.el('message-input');
  const clearBtn = APP.el('clearBtn');
  const statusDot = APP.el('status-dot');
  const statusText = APP.el('status-text');
  const issuesList = APP.el('issuesList');
  const issuesCount = APP.el('issuesCount');
  const rawDump = APP.el('rawDump');
  const refreshBtn = APP.el('refreshBtn');
  const clearIssuesBtn = APP.el('clearIssuesBtn');

  function setStatus(s){
    if (s === 'connected') { statusDot.style.background = '#34d399'; statusText.textContent = 'Connected'; }
    else if (s === 'connecting') { statusDot.style.background = '#f59e0b'; statusText.textContent = 'Connecting...'; }
    else { statusDot.style.background = '#ef4444'; statusText.textContent = 'Disconnected'; }
  }

  function append(text, who='bot'){
    const wrapper = document.createElement('div');
    wrapper.className = (who === 'user' ? 'flex justify-end' : 'flex justify-start') + ' msg';
    const bubble = document.createElement('div');
    bubble.className = 'p-3 rounded-lg';
    bubble.style.wordBreak = 'break-word';
    bubble.innerHTML = APP.escapeHtml(text);
    if (who === 'user') bubble.style.background = '#10b981';
    else bubble.style.background = 'rgba(255,255,255,0.03)';
    wrapper.appendChild(bubble);
    chatLog.appendChild(wrapper);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function renderIssues(list){
    issuesList.innerHTML = '';
    if (!list || list.length === 0) {
      issuesList.innerHTML = '<div class="text-sm text-slate-400">No saved issues.</div>';
      issuesCount.textContent = '0';
      rawDump.textContent = '';
      return;
    }
    issuesCount.textContent = String(list.length);
    list.forEach(issue => {
      const node = document.createElement('div');
      node.className = 'p-3 rounded-lg bg-slate-800 border border-slate-700';
      node.innerHTML = `<div class="font-semibold">${APP.escapeHtml(issue.title)}</div>
                        <div class="text-xs text-slate-400 mt-1">${APP.escapeHtml(issue.raw)}</div>
                        <div class="text-xs text-slate-400 mt-2">id: <span class="mono">${APP.escapeHtml(issue.id)}</span></div>`;
      issuesList.appendChild(node);
    });
    rawDump.textContent = JSON.stringify(list, null, 2);
  }

  ws.addEventListener('open', () => { setStatus('connected'); append('Connected to server.'); ws.send('__dump_issues__'); });
  ws.addEventListener('close', () => { setStatus('disconnected'); append('Not connected. Waiting to reconnect...', 'error'); setTimeout(() => location.reload(), 2000); });
  ws.addEventListener('error', () => setStatus('disconnected'));

  ws.addEventListener('message', ev => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'bot') {
        // try parse structured responses
        try {
          const body = JSON.parse(msg.text);
          if (body && body.cmd === 'dump_issues' && Array.isArray(body.issues)) { renderIssues(body.issues); return; }
          if (body && (body.summary || body.newIssues || body.existingMatches)) {
            append(`Handled issues — New: ${body.summary.newCount} • Existing: ${body.summary.existingCount}`);
            if (body.newIssues?.length) body.newIssues.forEach(n => append(`New: ${APP.escapeHtml(n.title)} (id: ${n.id})`));
            if (body.existingMatches?.length) body.existingMatches.forEach(m => append(`Existing: ${APP.escapeHtml(m.matchTitle)} (similarity: ${m.similarity})`));
            ws.send('__dump_issues__');
            return;
          }
        } catch(e) { /* not structured JSON */ }
        append(msg.text, 'bot');
      } else if (msg.type === 'error') {
        append(msg.text, 'error');
      } else {
        append(JSON.stringify(msg), 'bot');
      }
    } catch (e) {
      append(ev.data, 'bot');
    }
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const v = input.value.trim(); if (!v) return;
    append(v, 'user');
    if (ws.readyState === WebSocket.OPEN) ws.send(v);
    input.value = '';
  });

  refreshBtn.addEventListener('click', () => { if (ws.readyState === WebSocket.OPEN) ws.send('__dump_issues__'); else append('Not connected.', 'error'); });
  clearIssuesBtn.addEventListener('click', () => { if (!confirm('Clear all saved issues on the server?')) return; if (ws.readyState === WebSocket.OPEN) ws.send('clear issues'); });
  clearBtn.addEventListener('click', () => input.value = '');
})();
