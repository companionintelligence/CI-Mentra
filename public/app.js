/* ==========================================================================
 * Companion — client for the CI-Mentra Companion BFF (/api/companion).
 *
 * Two input models, one surface:
 *   PHONE — touch. Hold the mic, release to send. Every target >= 48px.
 *   R1 RING — a BLE remote that only emits arrows + select. So the app carries
 *     its own roving-focus cursor (see the FOCUS section): arrows move a loud
 *     highlight, select activates it, and holding select/Space talks. Nothing
 *     here may depend on hover, pointer precision, or a physical keyboard.
 *
 * No build step, no framework, no external assets — this ships as three static
 * files served from the site root by the Express app.
 * ========================================================================== */
(function () {
  'use strict';

  var API = '/api/companion';
  var VIEWS = ['talk', 'memory', 'profile'];

  /** Below this, a mic press is a tap (latch listening on) rather than a hold. */
  var TAP_MS = 400;
  var ERROR_MS = 7000;

  var SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;

  var STORE_SESSION = 'ci-mentra.sessionId';
  var STORE_VOICE = 'ci-mentra.voice';

  var state = {
    view: 'talk',
    status: null,
    sessionId: '',
    asking: false,
    listening: false,
    finalText: '',
    talkHeldAt: 0,
    speechSupported: Boolean(SpeechRecognitionCtor),
    voice: true,
    lastFocus: {},
    /** Last control the ring cursor sat on, even if focus has since left to <body>. */
    ringAnchor: null,
    helpOpener: null,
    errorTimer: 0,
    okTimer: 0
  };

  var recognition = null;
  var ui = {};

  /* ======================================================================
   * Utilities
   * ====================================================================== */

  function $(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** localStorage throws in private mode / embedded webviews — never let it break boot. */
  var store = {
    get: function (key) { try { return localStorage.getItem(key); } catch (err) { return null; } },
    set: function (key, value) { try { localStorage.setItem(key, value); } catch (err) { /* no-op */ } }
  };

  function uuid() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    } catch (err) { /* fall through */ }
    return 'ses-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function isTextField(el) {
    return Boolean(el) && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
  }

  /* ======================================================================
   * BFF client
   * ====================================================================== */

  /**
   * Same-origin JSON call against the Companion BFF. Cookies carry the OIDC
   * session, so `credentials` must ride along. Rejects with an Error whose
   * `status` lets callers distinguish "signed out" from "broken".
   */
  async function api(path, options) {
    var opts = { credentials: 'same-origin', headers: { Accept: 'application/json' } };
    var config = options || {};
    if (config.body !== undefined) {
      opts.method = config.method || 'POST';
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(config.body);
    } else if (config.method) {
      opts.method = config.method;
    }

    var res = await fetch(API + path, opts);
    var text = await res.text();
    var data = null;
    if (text) { try { data = JSON.parse(text); } catch (err) { /* non-JSON body */ } }

    if (!res.ok) {
      var message = (data && ((data.error && data.error.message) || data.message)) ||
        (res.status + ' ' + (res.statusText || 'request failed'));
      var err2 = new Error(message);
      err2.status = res.status;
      throw err2;
    }
    return data || {};
  }

  /**
   * Errors are inline and non-blocking — a wearable must never trap you behind a
   * dialog. `#errorline` is the aria-live region and is never hidden or emptied
   * of its box: text written into a hidden live region is announced to nobody, so
   * the message is a child that appears and disappears inside a region the screen
   * reader is already watching. Its box is zero-height while empty.
   */
  function showError(message) {
    ui.errorline.innerHTML = '<p class="errorline__msg">' + esc(message) + '</p>';
    window.clearTimeout(state.errorTimer);
    state.errorTimer = window.setTimeout(function () { ui.errorline.textContent = ''; }, ERROR_MS);
  }

  function clearError() {
    window.clearTimeout(state.errorTimer);
    ui.errorline.textContent = '';
  }

  /** A 401 mid-session means the cookie expired; re-check status and re-gate rather than nag. */
  function handleApiError(err, prefix) {
    if (err && err.status === 401) {
      showError('Your session ended — sign in again.');
      refreshStatus();
      return;
    }
    showError(prefix + ' ' + ((err && err.message) || 'unknown error'));
  }

  /* ======================================================================
   * Markdown-ish rendering
   *
   * Memory blocks come back as loose markdown (headings, bullets, bold). This
   * renders the subset CI-Server actually emits — escaping first, so nothing
   * from the model or the memory store can inject markup.
   * ====================================================================== */

  function inlineMd(text) {
    return esc(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  }

  function renderBlock(source) {
    var lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
    var out = [];
    var items = null;
    var ordered = false;

    function flush() {
      if (!items) return;
      out.push('<ul class="md-list' + (ordered ? ' md-list--num' : '') + '">' + items.join('') + '</ul>');
      items = null;
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/\s+$/, '');
      if (!line.trim()) { flush(); continue; }

      var heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        flush();
        var level = Math.min(heading[1].length + 2, 6);
        out.push('<h' + level + ' class="md-h">' + inlineMd(heading[2]) + '</h' + level + '>');
        continue;
      }

      var bullet = line.match(/^\s*[-*•]\s+(.*)$/);
      var numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (bullet || numbered) {
        var wantOrdered = Boolean(numbered);
        if (items && ordered !== wantOrdered) flush();
        ordered = wantOrdered;
        if (!items) items = [];
        items.push('<li>' + inlineMd((bullet || numbered)[1]) + '</li>');
        continue;
      }

      flush();
      out.push('<p class="md-p">' + inlineMd(line) + '</p>');
    }
    flush();
    return out.join('');
  }

  function paintBlock(el, source, emptyMessage) {
    var html = renderBlock(source);
    el.innerHTML = html || '<p class="block__idle">' + esc(emptyMessage) + '</p>';
  }

  /* ======================================================================
   * FOCUS — the ring cursor
   *
   * The ring has no pointer, so the app owns a single roving highlight over
   * the `[data-ring]` controls of whatever is currently on screen. Scope is
   * derived from what's visible: a modal sheet wins, then the active view
   * (plus the tab bar and app bar, so arrows can always reach navigation).
   * ====================================================================== */

  function activeScopes() {
    if (!ui.help.hidden) return [ui.help];
    if (!ui.app.hidden) return [viewEl(state.view), ui.tabbar, ui.appbar];
    if (!ui.gate.hidden) return [ui.gate];
    if (!ui.fatal.hidden) return [ui.fatal];
    return [];
  }

  function collectFocusables() {
    var out = [];
    activeScopes().forEach(function (scope) {
      if (!scope) return;
      Array.prototype.forEach.call(scope.querySelectorAll('[data-ring]'), function (el) {
        if (el.disabled) return;
        if (!el.getClientRects().length) return;
        out.push(el);
      });
    });
    return out;
  }

  function ringFocus(el) {
    if (!el) return;
    document.body.classList.add('ring-mode');
    el.focus({ preventScroll: true });
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
  }

  function moveFocus(delta) {
    var items = collectFocusables();
    if (!items.length) return;
    var current = items.indexOf(document.activeElement);
    // Focus can legitimately be on <body>: Escape out of a text field, or a view
    // that hid the control we were on. Resume from the last stop we remember
    // rather than snapping back to the top of the screen and losing the user's place.
    if (current < 0) current = items.indexOf(state.ringAnchor);
    var next = current < 0 ? 0 : (current + delta + items.length) % items.length;
    ringFocus(items[next]);
  }

  /** Mirror focus into `.is-ring` so the loud highlight tracks the real cursor. */
  function paintRing(target) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-ring].is-ring'), function (el) {
      el.classList.remove('is-ring');
    });
    if (!target) return;
    target.classList.add('is-ring');
    state.ringAnchor = target;
    if (!ui.app.hidden && ui.help.hidden) state.lastFocus[state.view] = target;
  }

  document.addEventListener('focusin', function (event) {
    paintRing(event.target instanceof Element ? event.target.closest('[data-ring]') : null);
  });

  /**
   * Focus can leave to nowhere — Escape blurs a text field, a view hides the
   * focused control — and no focusin follows to repaint. The highlight IS the
   * cursor here, so leaving it on an unfocused control is a lie about where the
   * next key will land. Drop it; `state.ringAnchor` survives so the next arrow
   * resumes from where the user actually was.
   */
  document.addEventListener('focusout', function () {
    // focusout fires before focusin, so settle first and re-read the real answer.
    window.setTimeout(function () {
      var active = document.activeElement;
      if (active && active.closest && active.closest('[data-ring]')) return;
      paintRing(null);
    }, 0);
  });

  // Touch means the ring cursor isn't driving — drop the loud highlight until keys return.
  document.addEventListener('pointerdown', function () {
    document.body.classList.remove('ring-mode');
  }, true);

  /* ======================================================================
   * Views
   * ====================================================================== */

  function viewEl(name) { return $('view-' + name); }

  function setView(name, opts) {
    if (VIEWS.indexOf(name) < 0 || state.view === name) return;
    state.view = name;

    VIEWS.forEach(function (view) {
      viewEl(view).hidden = view !== name;
    });
    Array.prototype.forEach.call(ui.tabbar.querySelectorAll('[data-tab]'), function (tab) {
      var selected = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      // Roving tabindex — the other half of the tablist contract. Programmatic
      // .focus() ignores tabindex="-1", so the ring cursor still stops on every
      // tab; this only tells the Tab key that a tablist is one stop, not three.
      tab.tabIndex = selected ? 0 : -1;
    });

    if (name === 'memory') loadHistory(true);
    if (name === 'profile') loadProfile();

    // Reset scroll first (the document scrolls, not .views), so the focus
    // restore below can scroll its target into view and win.
    window.scrollTo(0, 0);

    if (opts && opts.focus) {
      var remembered = state.lastFocus[name];
      var items = collectFocusables();
      ringFocus(remembered && items.indexOf(remembered) >= 0 ? remembered : items[0]);
    }
  }

  function stepView(delta) {
    var index = VIEWS.indexOf(state.view);
    setView(VIEWS[(index + delta + VIEWS.length) % VIEWS.length], { focus: true });
  }

  /* ======================================================================
   * TALK — speech in, speech out, ask
   * ====================================================================== */

  function setTranscript(text, interim) {
    ui.transcript.textContent = text;
    ui.transcript.dataset.empty = text ? 'false' : 'true';
    ui.transcript.dataset.interim = interim ? 'true' : 'false';
    if (!text) ui.transcript.textContent = state.speechSupported
      ? 'Hold the button and speak.'
      : 'Type below — this browser has no speech input.';
  }

  function updateMic() {
    var listening = state.listening;
    ui.mic.setAttribute('aria-pressed', listening ? 'true' : 'false');
    ui.mic.setAttribute('aria-label', listening ? 'Listening — release to send' : 'Hold to talk');
    if (!state.speechSupported) {
      ui.micHint.textContent = 'Speech input isn’t available in this browser — type below instead.';
      return;
    }
    ui.micHint.textContent = listening
      ? 'Listening… release to send'
      : (state.asking ? 'Thinking…' : 'Hold to talk · release to send');
  }

  function initSpeech() {
    if (!SpeechRecognitionCtor) {
      state.speechSupported = false;
      ui.mic.disabled = true;
      return;
    }
    recognition = new SpeechRecognitionCtor();
    recognition.lang = navigator.language || 'en-US';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = function (event) {
      var interim = '';
      for (var i = event.resultIndex; i < event.results.length; i++) {
        var result = event.results[i];
        if (result.isFinal) state.finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      setTranscript((state.finalText + ' ' + interim).trim(), Boolean(interim));
    };

    recognition.onerror = function (event) {
      if (event.error === 'aborted') return;
      if (event.error === 'no-speech') { setTranscript('Didn’t catch that — try again.', false); return; }
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        showError('Microphone access is blocked. Allow it in your browser settings, or type instead.');
        return;
      }
      showError('Speech input failed (' + event.error + '). You can type instead.');
    };

    recognition.onend = function () {
      state.listening = false;
      updateMic();
      var heard = state.finalText.trim();
      state.finalText = '';
      if (heard) submitAsk(heard);
    };
  }

  function startListening() {
    if (!recognition || state.listening || state.asking) return;
    stopSpeaking();
    state.finalText = '';
    try {
      recognition.start();
    } catch (err) {
      return; // A prior session hasn't fully released the mic yet; ignore this press.
    }
    state.listening = true;
    clearError();
    setTranscript('Listening…', false);
    updateMic();
  }

  function stopListening() {
    if (!recognition || !state.listening) return;
    try { recognition.stop(); } catch (err) { /* onend still fires */ }
  }

  /**
   * One gesture for every talk affordance — mic pointer, held Space, held ring
   * select. Hold-and-release is push-to-talk; a quick tap latches listening on
   * so a ring user isn't forced to hold a tiny button, and the next tap stops it.
   */
  function beginTalk() {
    if (state.asking) return;
    if (!state.speechSupported) {
      showError('Speech input isn’t available in this browser — use the text box.');
      return;
    }
    if (state.listening && !state.talkHeldAt) { stopListening(); return; }
    if (state.talkHeldAt) return;
    state.talkHeldAt = Date.now();
    startListening();
  }

  function endTalk() {
    if (!state.talkHeldAt) return;
    var held = Date.now() - state.talkHeldAt;
    state.talkHeldAt = 0;
    if (held >= TAP_MS) stopListening();
  }

  /**
   * Where the ring cursor belongs after Space has jumped us to Talk from another
   * view: the mic — the thing the user just started using. Without this the
   * control they were on gets hidden with its view, focus falls to <body>, and a
   * ring user is left with no highlight at all. Falls back to the first stop when
   * the mic is disabled (no speech support), which is the text field.
   */
  function focusTalkEntry() {
    var items = collectFocusables();
    if (!ui.mic.disabled && items.indexOf(ui.mic) >= 0) { ringFocus(ui.mic); return; }
    ringFocus(items[0]);
  }

  function speak(text) {
    if (!state.voice || !text || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      var utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = navigator.language || 'en-US';
      utterance.rate = 1;
      window.speechSynthesis.speak(utterance);
    } catch (err) { /* voice output is a nicety, never a failure */ }
  }

  function stopSpeaking() {
    if (!('speechSynthesis' in window)) return;
    try { window.speechSynthesis.cancel(); } catch (err) { /* no-op */ }
  }

  function setVoice(on) {
    state.voice = on;
    store.set(STORE_VOICE, on ? '1' : '0');
    ui.voiceToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    ui.voiceToggle.setAttribute('aria-label', on ? 'Voice replies on' : 'Voice replies off');
    ui.voiceToggleLabel.textContent = on ? 'Voice on' : 'Voice off';
    if (!on) stopSpeaking();
  }

  function renderChips(result) {
    var chips = [];
    if (result.remembered) chips.push({ text: 'saved to memory' });
    if (result.usedRecallCount > 0) {
      chips.push({ text: 'memory: ' + result.usedRecallCount + ' recalled' });
    }
    if (result.usedContext) chips.push({ text: 'profile context on' });
    if (!chips.length) {
      chips.push({
        text: state.status && state.status.memoryEnabled ? 'no memory needed' : 'memory off',
        mute: true
      });
    }
    ui.chips.innerHTML = chips.map(function (chip) {
      return '<li class="chip' + (chip.mute ? ' chip--mute' : '') + '">' +
        '<span class="chip__dot" aria-hidden="true"></span>' + esc(chip.text) + '</li>';
    }).join('');
  }

  function setBusy(busy) {
    state.asking = busy;
    ui.thinking.hidden = !busy;
    ui.answer.setAttribute('aria-busy', busy ? 'true' : 'false');
    updateMic();
  }

  /**
   * The single ask path — voice and text both land here, so double-submit is
   * blocked in one place rather than per-input.
   */
  async function submitAsk(text) {
    var value = String(text || '').trim();
    if (!value || state.asking) return;

    setView('talk');
    setTranscript(value, false);
    setBusy(true);
    clearError();

    try {
      var result = await api('/ask', { body: { text: value, sessionId: state.sessionId } });
      if (result.sessionId && result.sessionId !== state.sessionId) {
        state.sessionId = result.sessionId;
        store.set(STORE_SESSION, state.sessionId);
      }
      paintBlock(ui.answer, result.answer, 'No answer came back.');
      renderChips(result);
      speak(result.answer);
      if (!viewEl('memory').hidden) loadHistory(true);
    } catch (err) {
      handleApiError(err, 'Couldn’t reach your companion:');
    } finally {
      setBusy(false);
    }
  }

  function resetTopic() {
    state.sessionId = uuid();
    store.set(STORE_SESSION, state.sessionId);
    stopSpeaking();
    setTranscript('', false);
    ui.answer.innerHTML = '<p class="answer__idle">Fresh start. What’s on your mind?</p>';
    ui.chips.innerHTML = '';
    ui.historyList.innerHTML = '<li class="history__empty">Nothing said yet.</li>';
  }

  /* ======================================================================
   * MEMORY
   * ====================================================================== */

  async function runSearch(query) {
    var value = String(query || '').trim();
    if (!value) return;
    ui.searchResults.setAttribute('aria-busy', 'true');
    ui.searchResults.innerHTML = '<p class="block__idle">Searching your memory…</p>';
    try {
      var result = await api('/memory/search', { body: { query: value } });
      if (result.resultCount > 0 && result.block) paintBlock(ui.searchResults, result.block, '');
      else ui.searchResults.innerHTML = '<p class="block__idle">Nothing in memory matched that.</p>';
    } catch (err) {
      ui.searchResults.innerHTML = '<p class="block__idle">Search didn’t come back.</p>';
      handleApiError(err, 'Memory search failed:');
    } finally {
      ui.searchResults.setAttribute('aria-busy', 'false');
    }
  }

  function flashSaved() {
    ui.rememberSend.textContent = 'Saved ✓';
    ui.rememberSend.classList.add('btn--ok');
    window.clearTimeout(state.okTimer);
    state.okTimer = window.setTimeout(function () {
      ui.rememberSend.textContent = 'Save to memory';
      ui.rememberSend.classList.remove('btn--ok');
    }, 2200);
  }

  async function saveMemory() {
    var content = ui.rememberInput.value.trim();
    if (!content) {
      ui.rememberStatus.textContent = 'Write something to remember first.';
      ringFocus(ui.rememberInput);
      return;
    }
    ui.rememberStatus.textContent = 'Saving…';
    var payload = { content: content };
    var title = ui.rememberTitleInput.value.trim();
    if (title) payload.title = title;

    try {
      var result = await api('/memory/remember', { body: payload });
      if (result.saved) {
        ui.rememberInput.value = '';
        ui.rememberTitleInput.value = '';
        ui.rememberStatus.textContent = 'Saved. I’ll remember that.';
        flashSaved();
      } else {
        ui.rememberStatus.textContent = 'Memory is unavailable — nothing was saved.';
      }
    } catch (err) {
      ui.rememberStatus.textContent = 'Couldn’t save that.';
      handleApiError(err, 'Save failed:');
    }
  }

  function renderHistory(messages) {
    if (!messages.length) {
      ui.historyList.innerHTML = '<li class="history__empty">Nothing said yet.</li>';
      return;
    }
    ui.historyList.innerHTML = messages.map(function (message) {
      var assistant = message.role === 'assistant';
      var content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
      return '<li class="history__item history__item--' + (assistant ? 'assistant' : 'user') + '">' +
        '<span class="history__who">' + (assistant ? 'Companion' : 'You') + '</span>' +
        '<span class="history__text">' + esc(content) + '</span></li>';
    }).join('');
  }

  async function loadHistory(quiet) {
    try {
      var result = await api('/history?sessionId=' + encodeURIComponent(state.sessionId));
      renderHistory(Array.isArray(result.messages) ? result.messages : []);
    } catch (err) {
      if (!quiet) handleApiError(err, 'Couldn’t load this session:');
    }
  }

  /* ======================================================================
   * PROFILE
   * ====================================================================== */

  function fact(term, value, tone) {
    return '<div class="facts__row"><dt>' + esc(term) + '</dt>' +
      '<dd' + (tone ? ' class="' + tone + '"' : '') + '>' + esc(value) + '</dd></div>';
  }

  function renderFacts() {
    var status = state.status || {};
    var user = status.user || {};
    var rows = '';
    if (user.name || user.email) rows += fact('Signed in', user.name || user.email);
    rows += fact('Memory', status.memoryEnabled ? 'On' : 'Off',
      status.memoryEnabled ? 'is-on' : 'is-off');
    rows += fact('Provider', status.provider || 'unknown', 'is-mono');
    rows += fact('Model', status.model || 'unknown', 'is-mono');
    rows += fact('Sign-in', status.oidcEnabled ? 'Companion Intelligence' : 'Not configured',
      status.oidcEnabled ? '' : 'is-off');
    rows += fact('Voice replies', state.voice ? 'On' : 'Off', state.voice ? 'is-on' : 'is-off');
    ui.facts.innerHTML = rows;
  }

  async function loadProfile() {
    ui.profileBlock.setAttribute('aria-busy', 'true');
    try {
      var result = await api('/profile');
      paintBlock(ui.profileBlock, result.block, 'Nothing in your profile yet — tell me something worth keeping.');
    } catch (err) {
      ui.profileBlock.innerHTML = '<p class="block__idle">Profile unavailable right now.</p>';
      handleApiError(err, 'Couldn’t load your profile:');
    } finally {
      ui.profileBlock.setAttribute('aria-busy', 'false');
    }
  }

  /* ======================================================================
   * Help sheet
   *
   * It claims `aria-modal`, so it has to actually BE modal. Three things make
   * that true, and all three are needed:
   *   - `inert` on everything behind it (drops it from the tab order, from hit
   *     testing, and from the accessibility tree in one attribute),
   *   - aria-hidden alongside it, for AT that doesn't map inert yet,
   *   - the key trap in onKeyDown, for browsers without inert.
   * The scrim already blocks touch, and activeScopes() already confines the ring
   * cursor — this closes the keyboard/AT half.
   * ====================================================================== */

  /** Everything that is not the sheet: the app behind it, plus the dead screens. */
  function setBackgroundInert(on) {
    Array.prototype.forEach.call(document.body.children, function (el) {
      if (el === ui.help || el.tagName === 'SCRIPT') return;
      el.toggleAttribute('inert', on);
      if (on) el.setAttribute('aria-hidden', 'true');
      else el.removeAttribute('aria-hidden');
    });
  }

  function openHelp(opener) {
    if (!ui.help.hidden) return; // never re-capture the opener with the sheet's own close button
    state.helpOpener = opener || document.activeElement;
    ui.help.hidden = false;
    // Move focus in BEFORE inerting: aria-hiding an ancestor of the focused
    // element is the exact sin this is meant to prevent.
    ringFocus(ui.helpClose);
    setBackgroundInert(true);
  }

  function closeHelp() {
    if (ui.help.hidden) return;
    ui.help.hidden = true;
    setBackgroundInert(false); // un-inert first — .focus() on an inert element no-ops
    var opener = state.helpOpener;
    state.helpOpener = null;
    // Restore only to a control that is still a real ring stop. Focusing
    // anything else (body, a now-hidden node) silently no-ops and strands a
    // ring user with no highlight anywhere — so fall back to the first stop.
    var items = collectFocusables();
    ringFocus(opener && items.indexOf(opener) >= 0 ? opener : items[0]);
  }

  /* ======================================================================
   * Keyboard / ring input
   *
   * KEY MAP (documented in the in-app help sheet):
   *   ArrowUp / ArrowDown  move the roving highlight
   *   ArrowLeft / ArrowRight  switch view (Talk · Memory · Profile)
   *   Enter  activate the highlighted control; held on the mic = push-to-talk
   *   Space  hold anywhere to talk (jumps to Talk); release to send
   *   Escape  leave a text field / close the help sheet
   *   ?  open the ring controls
   * ====================================================================== */

  /** Real browser tab stops in a scope — the Tab order, not the ring cursor. */
  var FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]';

  function tabStops(scope) {
    return Array.prototype.filter.call(scope.querySelectorAll(FOCUSABLE), function (el) {
      return !el.disabled && el.tabIndex >= 0 && el.getClientRects().length > 0;
    });
  }

  /** Tab must wrap inside the sheet — always handled here, never by the browser. */
  function trapSheetTab(event) {
    event.preventDefault();
    var stops = tabStops(ui.help);
    if (!stops.length) return;
    var step = event.shiftKey ? -1 : 1;
    var index = stops.indexOf(document.activeElement);
    if (index < 0) { ringFocus(event.shiftKey ? stops[stops.length - 1] : stops[0]); return; }
    ringFocus(stops[(index + step + stops.length) % stops.length]);
  }

  function onKeyDown(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    var active = document.activeElement;
    var inText = isTextField(active);

    // The sheet is modal, so it owns every key while it is open. Nothing below
    // this block can run — which is what stops Enter reaching the mic behind it.
    if (!ui.help.hidden) {
      switch (event.key) {
        case 'Tab':
          trapSheetTab(event);
          return;
        case 'ArrowDown':
          event.preventDefault();
          moveFocus(1);
          return;
        case 'ArrowUp':
          event.preventDefault();
          moveFocus(-1);
          return;
        case 'Escape':
        case '?':
          event.preventDefault();
          closeHelp();
          return;
        default:
          // Focus inside the sheet keeps its native keys (Space/Enter activate the
          // focused button). Focus anywhere else means it leaked behind the scrim:
          // swallow the key and pull the cursor back rather than let it fire.
          if (!ui.help.contains(active)) { event.preventDefault(); ringFocus(ui.helpClose); }
          return;
      }
    }

    // Held select on the focused mic is the ring's push-to-talk.
    if (event.key === 'Enter' && active === ui.mic) {
      event.preventDefault();
      if (!event.repeat) beginTalk();
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveFocus(1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        moveFocus(-1);
        return;
      case 'ArrowRight':
      case 'ArrowLeft':
        if (ui.app.hidden) return;
        // A field with text owns the arrows (that's a caret). An EMPTY field has
        // no caret worth moving, so the ring keeps navigating — otherwise arrows
        // land a ring user in a text box they can never arrow back out of.
        if (inText && active.value) return;
        event.preventDefault();
        stepView(event.key === 'ArrowRight' ? 1 : -1);
        return;
      case ' ':
      case 'Spacebar':
        if (inText || ui.app.hidden) return;
        event.preventDefault(); // also suppresses the click Space would fire on a focused button
        if (!event.repeat) {
          // Jumping views hides whatever the cursor was on, dropping focus to
          // <body>. Land it on the mic before talking so the ring user keeps a
          // highlight — but only when we actually jumped, so Space on Talk leaves
          // an existing cursor alone.
          var jumped = state.view !== 'talk';
          setView('talk');
          if (jumped) focusTalkEntry();
          beginTalk();
        }
        return;
      case 'Escape':
        if (inText && active.blur) { event.preventDefault(); active.blur(); }
        return;
      case '?':
        if (inText) return;
        event.preventDefault();
        openHelp(active);
        return;
      default:
    }
  }

  function onKeyUp(event) {
    // While the sheet is open Space belongs to whichever button is focused, and
    // cancelling its keyup would cancel that click. No talk press is in flight
    // anyway — the sheet can't be opened mid-hold.
    if (!ui.help.hidden) return;
    if (event.key === ' ' || event.key === 'Spacebar' ||
       (event.key === 'Enter' && document.activeElement === ui.mic)) {
      event.preventDefault();
      endTalk();
    }
  }

  /* ======================================================================
   * Wiring
   * ====================================================================== */

  function wire() {
    ui = {
      boot: $('boot'),
      fatal: $('fatal'),
      fatalNote: $('fatal-note'),
      fatalRetry: $('fatal-retry'),
      gate: $('gate'),
      gateNote: $('gate-note'),
      gateFine: $('gate-fine'),
      gateSignin: $('gate-signin'),
      app: $('app'),
      appbar: $('appbar'),
      appbarUser: $('appbar-user'),
      errorline: $('errorline'),
      tabbar: $('tabbar'),
      help: $('help'),
      helpClose: $('help-close'),
      transcript: $('transcript'),
      answer: $('answer'),
      thinking: $('thinking'),
      chips: $('chips'),
      mic: $('mic'),
      micHint: $('mic-hint'),
      askForm: $('ask-form'),
      askInput: $('ask-input'),
      voiceToggle: $('voice-toggle'),
      voiceToggleLabel: $('voice-toggle-label'),
      searchForm: $('search-form'),
      searchInput: $('search-input'),
      searchResults: $('search-results'),
      rememberInput: $('remember-input'),
      rememberTitleInput: $('remember-title-input'),
      rememberSend: $('remember-send'),
      rememberStatus: $('remember-status'),
      historyList: $('history-list'),
      profileBlock: $('profile-block'),
      facts: $('facts')
    };

    // Mic: pointer press is the phone's push-to-talk. preventDefault keeps the
    // browser from firing a synthetic click on top of the gesture.
    ui.mic.addEventListener('pointerdown', function (event) {
      event.preventDefault();
      ui.mic.focus({ preventScroll: true });
      beginTalk();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (type) {
      ui.mic.addEventListener(type, function () { endTalk(); });
    });

    ui.askForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var text = ui.askInput.value;
      if (!text.trim() || state.asking) return;
      ui.askInput.value = '';
      submitAsk(text);
    });

    ui.voiceToggle.addEventListener('click', function () { setVoice(!state.voice); });
    $('talk-reset').addEventListener('click', resetTopic);

    ui.searchForm.addEventListener('submit', function (event) {
      event.preventDefault();
      runSearch(ui.searchInput.value);
    });
    ui.rememberSend.addEventListener('click', saveMemory);
    $('history-refresh').addEventListener('click', function () { loadHistory(false); });

    $('profile-refresh').addEventListener('click', function () {
      loadProfile();
      refreshStatus();
    });

    Array.prototype.forEach.call(ui.tabbar.querySelectorAll('[data-tab]'), function (tab) {
      tab.addEventListener('click', function () { setView(tab.dataset.tab); });
    });

    $('help-open').addEventListener('click', function (event) { openHelp(event.currentTarget); });
    $('help-open-2').addEventListener('click', function (event) { openHelp(event.currentTarget); });
    ui.helpClose.addEventListener('click', closeHelp);
    $('help-done').addEventListener('click', closeHelp);
    ui.help.addEventListener('click', function (event) {
      if (event.target === ui.help) closeHelp();
    });

    ui.fatalRetry.addEventListener('click', boot);

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('pagehide', stopSpeaking);
  }

  /* ======================================================================
   * Boot + auth gate
   * ====================================================================== */

  function showOnly(screen) {
    ui.boot.hidden = screen !== 'boot';
    ui.fatal.hidden = screen !== 'fatal';
    ui.gate.hidden = screen !== 'gate';
    ui.app.hidden = screen !== 'app';
  }

  /** The provider's display name lives on the public auth-config route, not on BFF status. */
  async function fetchProviderName() {
    try {
      var res = await fetch('/api/auth/config', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      if (!res.ok) return '';
      var data = await res.json();
      return typeof data.providerName === 'string' ? data.providerName.trim() : '';
    } catch (err) {
      return '';
    }
  }

  async function showGate(status) {
    showOnly('gate');
    if (!status.oidcEnabled) {
      ui.gateSignin.hidden = true;
      ui.gateNote.textContent = 'Sign-in isn’t configured on this device.';
      ui.gateFine.textContent = 'Set MENTRA_OIDC_ENABLED=true, or enable anonymous dev access, then reload.';
      return;
    }
    ui.gateSignin.hidden = false;
    ui.gateSignin.href = (status.loginUrl || '/api/auth/login') + '?return_to=%2F';
    ui.gateNote.textContent = 'Sign in to reach your memory.';
    ringFocus(ui.gateSignin);

    var provider = await fetchProviderName();
    ui.gateSignin.textContent = 'Sign in with ' + (provider || 'Companion Intelligence');
  }

  function showApp(status) {
    showOnly('app');
    var user = status.user || {};
    ui.appbarUser.textContent = user.name || user.email || '';
    if (user.name && user.email) ui.appbarUser.title = user.email;
    renderFacts();
    updateMic();
    setTranscript('', false);
    loadHistory(true);
  }

  function applyStatus(status) {
    state.status = status;
    if (status.authenticated) showApp(status);
    else showGate(status);
  }

  /** Re-check the gate without disturbing the current view (used after a 401). */
  async function refreshStatus() {
    try {
      var status = await api('/status');
      state.status = status;
      if (!status.authenticated) { showGate(status); return; }
      renderFacts();
    } catch (err) { /* the inline error already told the story */ }
  }

  async function boot() {
    showOnly('boot');
    state.sessionId = store.get(STORE_SESSION) || uuid();
    store.set(STORE_SESSION, state.sessionId);
    setVoice(store.get(STORE_VOICE) !== '0');
    initSpeech();

    try {
      applyStatus(await api('/status'));
    } catch (err) {
      showOnly('fatal');
      ui.fatalNote.textContent = 'The companion service didn’t answer (' + err.message + ').';
      ringFocus(ui.fatalRetry);
    }
  }

  wire();
  boot();
})();
