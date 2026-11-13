'use strict';
const $ = id => document.getElementById(id);
const err = m => { $('err').textContent = m; $('err').hidden = !m; };
fetch('/api/setup').then(r => r.json()).then(s => {
  if (!s.setup) { location.replace('/'); return; }
  $('codeBox').hidden = !s.codeRequired;
  if (s.codeRequired) $('code').required = true;
  $('p').focus();
}).catch(() => err('Cannot reach the server'));
$('p').addEventListener('input', () => {
  const v = $('p').value;
  let score = Math.min(v.length, 20) / 20;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(r => r.test(v)).length;
  score = Math.min(1, score * 0.7 + kinds * 0.075);
  $('meter').style.width = (score * 100) + '%';
  $('meter').style.background = v.length < 10 ? '#e5484d' : score < 0.7 ? '#f2b705' : '#3fb950';
});
$('setupForm').addEventListener('submit', async e => {
  e.preventDefault();
  err('');
  if ($('p').value !== $('p2').value) return err('The passwords do not match');
  $('go').disabled = true;
  try {
    const r = await fetch('/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('u').value.trim(), password: $('p').value, code: $('code').value }) });
    const j = await r.json();
    if (j.ok) { location.replace('/'); return; }
    if (r.status === 409 && !j.setup) { location.replace('/login.html'); return; }
    err(j.msg || 'Setup failed');
  } catch (x) { err('Cannot reach the server'); }
  $('go').disabled = false;
});
