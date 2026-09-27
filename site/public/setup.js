/* ==========================================================================
 * mentra.ci.computer — setup page behaviour.
 * Form -> .env (via env-builder.js), copy/download, and a bridge /health probe.
 * ========================================================================== */
(function () {
  'use strict';

  var Env = window.MentraEnv;
  var form = document.getElementById('envform');
  var envOut = document.getElementById('env-out');
  var cmdOut = document.getElementById('cmd-out');
  var problemsEl = document.getElementById('problems');

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function readForm() {
    var data = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name) return;
      if (el.type === 'checkbox') data[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) data[el.name] = el.value; }
      else data[el.name] = el.value;
    });
    return data;
  }

  function syncVisibility(mode) {
    Array.prototype.forEach.call(form.querySelectorAll('[data-when]'), function (fs) {
      var show = fs.getAttribute('data-when').split(' ').indexOf(mode) >= 0;
      fs.hidden = !show;
      fs.disabled = !show;
    });
  }

  function render() {
    var data = readForm();
    syncVisibility(data.mode);
    envOut.textContent = Env.build(data);
    cmdOut.textContent = Env.commands(data);
    var problems = Env.validate(data);
    problemsEl.innerHTML = problems.length
      ? '<ul>' + problems.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>'
      : '<p class="ok">Looks complete.</p>';
  }

  function randomKey(bytes) {
    var buf = new Uint8Array(bytes);
    window.crypto.getRandomValues(buf);
    return Array.prototype.map.call(buf, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  function flash(button, text) {
    var original = button.textContent;
    button.textContent = text;
    window.setTimeout(function () { button.textContent = original; }, 1400);
  }

  function copy(text, button) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { flash(button, 'Copied'); }, function () { flash(button, 'Select + copy'); });
    } else {
      flash(button, 'Select + copy');
    }
  }

  form.addEventListener('input', render);
  form.addEventListener('change', render);
  form.addEventListener('submit', function (e) { e.preventDefault(); });

  Array.prototype.forEach.call(document.querySelectorAll('[data-gen]'), function (btn) {
    btn.addEventListener('click', function () {
      form.elements[btn.getAttribute('data-gen')].value = randomKey(32);
      render();
    });
  });

  document.getElementById('copy-env').addEventListener('click', function (e) { copy(envOut.textContent, e.currentTarget); });
  document.getElementById('copy-cmd').addEventListener('click', function (e) { copy(cmdOut.textContent, e.currentTarget); });
  document.getElementById('download-env').addEventListener('click', function () {
    var blob = new Blob([envOut.textContent], { type: 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mentra.env';
    document.body.appendChild(a);
    a.click();
    window.setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  });

  // Pre-fill secrets so the defaults are never "open".
  form.elements.facadeApiKey.value = randomKey(24);
  form.elements.sessionSecret.value = randomKey(32);
  render();

  /* ---------------- Bridge health probe ---------------- */

  var checkForm = document.getElementById('checkform');
  var checkOut = document.getElementById('check-out');

  function pill(label, value, tone) {
    return '<div class="pill pill--' + tone + '"><span>' + esc(label) + '</span><b>' + esc(value) + '</b></div>';
  }

  function summarize(h) {
    var rows = [];
    rows.push(pill('Service', (h.service || '?') + ' ' + (h.version || ''), h.status === 'ok' ? 'good' : 'bad'));
    rows.push(pill('Runtime', h.runtimeMode || 'unknown', 'info'));
    var auth = h.auth || {};
    rows.push(pill('Auth', auth.mode || 'unknown', 'info'));
    rows.push(pill('Sign-in', auth.oidcLogin && auth.oidcLogin.enabled ? 'CI-Portal' : 'off', auth.oidcLogin && auth.oidcLogin.enabled ? 'good' : 'warn'));
    var inf = h.inference || {};
    rows.push(pill('Provider', inf.defaultProvider || 'unknown', 'info'));
    var hb = inf.hubBootstrap || {};
    rows.push(pill('Hub bootstrap', hb.attempted ? (hb.applied ? 'applied (' + hb.slug + ')' : 'failed (' + hb.slug + ')') : 'off', hb.attempted ? (hb.applied ? 'good' : 'bad') : 'info'));
    var mem = h.memory || {};
    rows.push(pill('Memory', mem.enabled ? 'on' : 'off', mem.enabled ? 'good' : 'warn'));
    var ui = h.companionUi || {};
    if (ui.devAnonymous) rows.push(pill('Anonymous access', 'ON — dev only', 'bad'));
    return rows.join('');
  }

  checkForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var raw = checkForm.elements.url.value.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(raw)) { checkOut.innerHTML = '<p class="bad">Enter a URL starting with http:// or https://</p>'; return; }
    checkOut.innerHTML = '<p>Checking…</p>';
    var ctrl = new AbortController();
    var timer = window.setTimeout(function () { ctrl.abort(); }, 6000);
    fetch(raw + '/health', { mode: 'cors', credentials: 'omit', signal: ctrl.signal })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (h) {
        checkOut.innerHTML = summarize(h) +
          '<p class="note">Open your companion UI at <a href="' + esc(raw) + '/" rel="noopener" target="_blank">' + esc(raw) + '/</a>.</p>';
      })
      .catch(function (err) {
        var msg = err && err.name === 'AbortError' ? 'timed out' : (err && err.message) || 'failed';
        checkOut.innerHTML = '<p class="bad">Could not read ' + esc(raw) + '/health (' + esc(msg) + ').</p>' +
          '<p class="note">Check that the bridge is running and reachable from this browser, and that it is new enough to allow this site in <code>MENTRA_SETUP_ORIGINS</code>. A bridge on plain HTTP can only be checked at <code>localhost</code>.</p>';
      })
      .then(function () { window.clearTimeout(timer); });
  });
})();
