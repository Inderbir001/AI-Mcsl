// create.js
// logic for the Create / Submit Issues page (Combined Chat and Modal logic)

(function(){
  const ws = new WebSocket(APP.wsUrl());

  // --- UI Elements ---
  const chatLog = APP.el('chat-log');
  const statusDot = APP.el('status-dot');
  const statusText = APP.el('status-text');
  const issuesList = APP.el('issuesList');
  const issuesCount = APP.el('issuesCount');
  const rawDump = APP.el('rawDump');
  const refreshBtn = APP.el('refreshBtn');
  const clearIssuesBtn = APP.el('clearIssuesBtn');

  // --- CHAT FORM Elements ---
  const form = APP.el('message-form');
  const input = APP.el('message-input');
  const clearBtn = APP.el('clearBtn');

  // --- MODAL Elements (The new thing) ---
  const newIssueBtn = APP.el('newIssueBtn');
  const issueModal = APP.el('issueModal');
  const issueSubmissionForm = APP.el('issue-submission-form');
  const issueTitle = APP.el('issueTitle');
  const issueDescription = APP.el('issueDescription');
  const cancelBtn = APP.el('cancelBtn');

  function setStatus(s){
    if (s === 'connected') { statusDot.style.background = '#34d399'; statusText.textContent = 'Connected'; }
    else if (s === 'connecting') { statusDot.style.background = '#f59e0b'; statusText.textContent = 'Connecting...'; }
    else { statusDot.style.background = '#ef4444'; statusText.textContent = 'Disconnected'; }
  }

  function append(text, who='bot'){
    // Using the structured message format for the ChatGPT look
    const wrapper = document.createElement('div');
    wrapper.className = 'msg ' + who;

    const msgContent = document.createElement('div');
    msgContent.className = 'msg-content';

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = who === 'user' ? 'U' : 'AI';

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = APP.escapeHtml(text);
    
    msgContent.appendChild(avatar);
    msgContent.appendChild(bubble);
    wrapper.appendChild(msgContent);
    
    chatLog.appendChild(wrapper);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function renderIssues(list){
    issuesList.innerHTML = '';
    if (!list || list.length === 0) {
      issuesList.innerHTML = '<div class="text-sm text-slate-400">No saved issues yet.</div>';
      issuesCount.textContent = '0';
      rawDump.textContent = '';
      return;
    }
    issuesCount.textContent = String(list.length);
    list.forEach(issue => {
      const node = document.createElement('div');
      node.className = 'issue-item'; 
      node.innerHTML = `<div class="title">${APP.escapeHtml(issue.title)}</div>
                        <div class="raw">${APP.escapeHtml(issue.raw)}</div>
                        <div class="text-xs text-slate-400 mt-2">id: <span class="mono">${APP.escapeHtml(issue.id)}</span></div>`;
      issuesList.appendChild(node);
    });
    rawDump.textContent = JSON.stringify(list, null, 2);
  }

  // --- WebSocket Handlers ---
  ws.addEventListener('open', () => { setStatus('connected'); append('Connected to server.'); ws.send('__dump_issues__'); });
  ws.addEventListener('close', () => { setStatus('disconnected'); append('Not connected. Waiting to reconnect...', 'error'); setTimeout(() => location.reload(), 2000); });
  ws.addEventListener('error', () => setStatus('disconnected'));

  ws.addEventListener('message', ev => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'bot') {
        try {
          const body = JSON.parse(msg.text);
          if (body && body.cmd === 'dump_issues' && Array.isArray(body.issues)) { renderIssues(body.issues); return; }
          if (body && (body.summary || body.newIssues || body.existingMatches)) {
            append(`Handled issues — New: ${body.summary.newCount} • Existing: ${body.summary.existingCount}`);
            if (body.newIssues?.length) body.newIssues.forEach(n => append(`New Issue: **${APP.escapeHtml(n.title)}** (id: ${n.id})`));
            if (body.existingMatches?.length) body.existingMatches.forEach(m => append(`Existing Match: **${APP.escapeHtml(m.matchTitle)}** (similarity: ${m.similarity})`));
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

  // --- 1. CHAT FORM HANDLERS (Restored) ---
  form.addEventListener('submit', e => {
    e.preventDefault();
    const v = input.value.trim(); if (!v) return;
    append(v, 'user');
    if (ws.readyState === WebSocket.OPEN) ws.send(v);
    input.value = '';
  });

  // --- 2. MODAL FORM HANDLERS (New Thing Logic) ---

  // Open Modal
  newIssueBtn.addEventListener('click', () => {
    issueModal.classList.remove('hidden');
    issueTitle.focus();
  });

  // Close Modal
  cancelBtn.addEventListener('click', () => {
    issueModal.classList.add('hidden');
    issueSubmissionForm.reset();
  });
  
  // Submit Modal Form
  issueSubmissionForm.addEventListener('submit', e => {
    e.preventDefault();
    const title = issueTitle.value.trim();
    const description = issueDescription.value.trim();

    if (!title || !description) {
      alert('Error: Both title and description are required.');
      return;
    }

    // Combine title and description into the message format expected by the server
    // (Assuming the server can parse this specific structured format)
    const issuePayload = `ISSUE_TITLE: ${title}\nISSUE_DESCRIPTION: ${description}`;

    // Append to chat log as user message
    append(`**Submitted Issue**\nTitle: ${APP.escapeHtml(title)}\nDescription: ${APP.escapeHtml(description.substring(0, 80))}...`, 'user');

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(issuePayload);
    } else {
      append('Not connected. Cannot submit issue.', 'error');
    }

    // Close and reset form after submission
    issueModal.classList.add('hidden');
    issueSubmissionForm.reset();
  });


  // --- SIDEBAR BUTTON HANDLERS ---
  refreshBtn.addEventListener('click', () => { if (ws.readyState === WebSocket.OPEN) ws.send('__dump_issues__'); else append('Not connected.', 'error'); });
  clearIssuesBtn.addEventListener('click', () => { if (!confirm('Clear all saved issues on the server?')) return; if (ws.readyState === WebSocket.OPEN) ws.send('clear issues'); });
  clearBtn.addEventListener('click', () => input.value = '');
})();