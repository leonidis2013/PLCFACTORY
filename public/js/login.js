'use strict';
const f = document.getElementById('loginForm'), err = document.getElementById('err'), go = document.getElementById('go');
document.getElementById('u').focus();
f.addEventListener('submit', async e => {
  e.preventDefault();
  err.hidden = true; go.disabled = true;
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: document.getElementById('u').value.trim(), password: document.getElementById('p').value }) });
    const j = await r.json();
    if (j.ok) {
      const next = new URLSearchParams(location.search).get('next');
      location.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
      return;
    }
    err.textContent = j.msg || 'Sign-in failed'; err.hidden = false;
    document.getElementById('p').select();
  } catch (x) { err.textContent = 'Cannot reach the server'; err.hidden = false; }
  go.disabled = false;
});
