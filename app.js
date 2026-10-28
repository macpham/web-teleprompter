'use strict';

// ---------- constants & persisted settings ----------

const KEY = { text: 'tp.text', fs: 'tp.fs', pos: 'tp.pos', wpm: 'tp.wpm', tune: 'tp.tune' };
const FONT_MIN = 24, FONT_MAX = 96, FONT_STEP = 4;
const WPM_MIN = 60, WPM_MAX = 300, WPM_STEP = 10;
const LOOKBEHIND_TOKENS = 8;
const NEAR_JUMP = 3, MID_JUMP = 12; // word distances that separate small / medium / big jumps
const LINE_HOLD_MS = 350; // keep a just-finished line in focus so its last word shows as heard

// User-tunable tracking settings, shown in the Settings dialog.
const TUNING = [
  { key: 'lookahead', label: 'Look-ahead', def: 3, min: 1, max: 10, step: 1,
    fmt: (v) => v + (v === 1 ? ' line' : ' lines'),
    help: 'How many lines past the current one to search for what you said. More lets it catch up after skipping; fewer avoids false jumps.' },
  { key: 'nearNeed', label: 'Words to advance', def: 1, min: 1, max: 4, step: 1,
    fmt: (v) => v + (v === 1 ? ' word' : ' words'),
    help: `Matching words needed to move up to ${NEAR_JUMP} words ahead.` },
  { key: 'midNeed', label: 'Words for a short jump', def: 2, min: 1, max: 6, step: 1,
    fmt: (v) => v + (v === 1 ? ' word' : ' words'),
    help: `Matching words needed to move ${NEAR_JUMP + 1}–${MID_JUMP} words ahead (e.g. after skipping a phrase).` },
  { key: 'farNeed', label: 'Words for a long jump', def: 3, min: 1, max: 8, step: 1,
    fmt: (v) => v + (v === 1 ? ' word' : ' words'),
    help: `Matching words needed to move more than ${MID_JUMP} words ahead (e.g. after skipping a sentence).` },
  { key: 'similar', label: 'Word match strictness', def: 0.75, min: 0.5, max: 1, step: 0.05,
    fmt: (v) => Math.round(v * 100) + '%',
    help: 'How similar a heard word must be to a script word to count. Lower is more forgiving of mishearing; 100% needs exact matches.' },
  { key: 'tail', label: 'Recent words compared', def: 8, min: 3, max: 16, step: 1,
    fmt: (v) => v + ' words',
    help: 'How many of your most recent spoken words are compared with the script. More is steadier; fewer reacts faster to jumps.' },
];

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* storage unavailable */ }
}
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// ---------- DOM ----------

const $ = (id) => document.getElementById(id);
const editView = $('edit-view'), promptView = $('prompt-view');
const input = $('script-input'), scriptEl = $('script'), scroller = $('scroller');
const startBtn = $('start-btn'), statusEl = $('status'), toastEl = $('toast');
const speedBar = $('speed-bar'), wpmLabel = $('wpm-label');

// ---------- state ----------

let text = load(KEY.text, '');
let fontSize = clamp(+load(KEY.fs, 40) || 40, FONT_MIN, FONT_MAX);
let wpm = clamp(+load(KEY.wpm, 140) || 140, WPM_MIN, WPM_MAX);
let pos = +load(KEY.pos, 0) || 0; // index of the next expected token
let tune = loadTuning();

let words = [];        // { el, line, heard, cls }
let tokens = [];       // { norm, wi } — normalised matchable units (a word can yield 0..n tokens)
let wordFirstTok = []; // word index -> first token index at/after it
let lines = [];        // { first, last, c } — visual lines, c = vertical centre in px
let shownLine = -1;

let running = false;   // listening or auto-scrolling
let autoMode = !SR;    // auto-scroll fallback when speech recognition isn't usable
let rec = null, lastKey = '';
let autoTimer = 0;
let wakeLock = null;
let textDirty = false;

// ---------- text processing ----------

function normalize(s) {
  return s.toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function tokenize(s) {
  return s.replace(/&/g, ' and ').split(/[\s\-–—\/]+/).map(normalize).filter(Boolean);
}

function levenshtein(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// 1 = exact, 0.75..1 = close enough, 0 = different
function similarity(a, b) {
  if (a === b) return 1;
  if (a.length <= 3 || b.length <= 3) return 0;
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  if (l.startsWith(s)) return 0.8; // walk / walking
  return 1 - levenshtein(a, b) / l.length;
}

// ---------- rendering ----------

function buildScript() {
  words = []; tokens = []; wordFirstTok = []; lines = []; shownLine = -1;
  const frag = document.createDocumentFragment();
  for (const para of text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
    const p = document.createElement('p');
    for (const part of para.split(/\s+/)) {
      const wi = words.length;
      const el = document.createElement('span');
      el.className = 'w';
      el.textContent = part;
      el.dataset.i = wi;
      p.append(el, ' ');
      words.push({ el, line: 0, heard: false, cls: 'w' });
      wordFirstTok.push(tokens.length);
      for (const norm of tokenize(part)) tokens.push({ norm, wi });
    }
    frag.append(p);
  }
  scriptEl.replaceChildren(frag);
  if (!words.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No script yet — tap Edit to add one.';
    scriptEl.append(p);
  }
  pos = clamp(pos, 0, tokens.length);
  layout();
}

// Group word spans into visual lines and centre the stage padding.
function layout() {
  const half = scroller.clientHeight / 2;
  scriptEl.style.paddingTop = scriptEl.style.paddingBottom = half + 'px';
  lines = [];
  let cur = null;
  for (let wi = 0; wi < words.length; wi++) {
    const el = words[wi].el;
    const c = el.offsetTop + el.offsetHeight / 2;
    if (!cur || Math.abs(c - cur.c) > fontSize * 0.5) {
      cur = { first: wi, last: wi, c };
      lines.push(cur);
    } else {
      cur.last = wi;
    }
    words[wi].line = lines.length - 1;
  }
  shownLine = -1;
  paint(true);
}

function currentLine() {
  if (!tokens.length) return 0;
  if (pos >= tokens.length) return lines.length - 1;
  return words[tokens[pos].wi].line;
}

let holdTimer = 0;

function cancelHold() { clearTimeout(holdTimer); holdTimer = 0; }

// hold: the position advanced from speech/auto-scroll, so briefly keep the previous
// line current (and un-grayed) before moving on.
function paint(instant = false, hold = false) {
  let finished = tokens.length > 0 && pos >= tokens.length;
  let li = currentLine();
  if (instant) cancelHold();
  if ((hold || holdTimer) && !instant && shownLine >= 0 && (li > shownLine || finished)) {
    if (!holdTimer) holdTimer = setTimeout(() => { holdTimer = 0; paint(); }, LINE_HOLD_MS);
    li = shownLine;
    finished = false;
  }
  const next = running && pos < tokens.length ? words[tokens[pos].wi] : null;
  for (const w of words) {
    let cls = finished || w.line < li ? 'w past' : w.heard ? 'w heard' : 'w';
    if (w === next) cls += ' next';
    if (w.cls !== cls) { w.el.className = cls; w.cls = cls; }
  }
  if (li !== shownLine || instant) {
    shownLine = li;
    scrollToLine(li, instant);
  }
}

// ---------- scrolling ----------

let animPos = 0, animTarget = 0, raf = 0;

function scrollToLine(li, instant) {
  const line = lines[li];
  if (!line) { scroller.scrollTop = 0; return; }
  animTarget = Math.max(0, line.c - scroller.clientHeight / 2);
  if (instant) {
    cancelAnimationFrame(raf); raf = 0;
    scroller.scrollTop = animTarget;
    return;
  }
  if (!raf) {
    animPos = scroller.scrollTop;
    raf = requestAnimationFrame(step);
  }
}

function step() {
  const d = animTarget - animPos;
  if (Math.abs(d) < 0.5) {
    scroller.scrollTop = animTarget;
    raf = 0;
    return;
  }
  animPos += d * 0.12;
  scroller.scrollTop = animPos;
  raf = requestAnimationFrame(step);
}

function stopAnimation() { cancelAnimationFrame(raf); raf = 0; }

// ---------- position ----------

// hold = position came from following the reader (not a tap or reset).
function setPos(p, hold = false) {
  if (!hold) cancelHold();
  pos = clamp(p, 0, tokens.length);
  save(KEY.pos, pos);
  paint(false, hold);
}

function jumpToWord(wi) {
  const lineStart = lines[words[wi].line].first;
  for (let i = lineStart; i < words.length; i++) words[i].heard = false;
  setPos(wordFirstTok[wi]);
}

function reset() {
  for (const w of words) w.heard = false;
  lastKey = '';
  setPos(0);
}

// ---------- speech matching ----------

// Local alignment (Smith–Waterman) of the last few spoken words against a window
// of the script around the current position. Tolerates misheard, skipped and
// ad-libbed words; only ever moves the position forward.
function handleSpeech(transcript) {
  const spoken = tokenize(transcript).slice(-tune.tail);
  const key = spoken.join(' ');
  if (!spoken.length || key === lastKey || pos >= tokens.length) return;
  lastKey = key;

  const endLine = Math.min(lines.length - 1, currentLine() + tune.lookahead);
  const endWord = lines[endLine].last;
  const a = Math.max(0, pos - LOOKBEHIND_TOKENS);
  const afterEnd = endWord + 1 < words.length ? wordFirstTok[endWord + 1] : tokens.length;
  const b = Math.min(tokens.length, Math.max(afterEnd, pos + 12));
  const m = spoken.length, L = b - a, W = L + 1;

  const H = new Float32Array((m + 1) * W);
  const dir = new Uint8Array((m + 1) * W); // 0 stop, 1 diag match, 2 diag mismatch, 3 up, 4 left
  const cands = [];
  for (let i = 1; i <= m; i++) {
    for (let k = 1; k <= L; k++) {
      const s = similarity(spoken[i - 1], tokens[a + k - 1].norm);
      const matched = s >= tune.similar;
      const d = H[(i - 1) * W + k - 1] + (s >= 1 ? 2 : matched ? 1.5 : -1);
      const u = H[(i - 1) * W + k] - 1;
      const l = H[i * W + k - 1] - 1;
      let best = 0, dr = 0;
      if (d > best) { best = d; dr = matched ? 1 : 2; }
      if (u > best) { best = u; dr = 3; }
      if (l > best) { best = l; dr = 4; }
      H[i * W + k] = best;
      dir[i * W + k] = dr;
      // Candidate end points: a matched word among the most recent spoken words.
      if (dr === 1 && i >= m - 2) cands.push({ i, k, score: best - 0.75 * (m - i) });
    }
  }

  cands.sort((x, y) => y.score - x.score || Math.abs(a + x.k - 1 - pos) - Math.abs(a + y.k - 1 - pos));
  for (const c of cands.slice(0, 6)) {
    const target = a + c.k - 1;
    if (target < pos) continue;
    const matched = [];
    for (let i = c.i, k = c.k; i > 0 && k > 0;) {
      const dr = dir[i * W + k];
      if (dr === 0) break;
      if (dr === 1) matched.push(a + k - 1);
      if (dr <= 2) { i--; k--; } else if (dr === 3) i--; else k--;
    }
    const fresh = matched.filter((t) => t >= pos).length;
    const jump = target - pos;
    const need = jump <= NEAR_JUMP ? tune.nearNeed : jump <= MID_JUMP ? tune.midNeed : tune.farNeed;
    if (fresh < need) continue;
    for (const t of matched) words[tokens[t].wi].heard = true;
    setPos(target + 1, true);
    if (pos >= tokens.length) stop();
    return;
  }
}

// ---------- listening ----------

function startRecognition() {
  rec = new SR();
  rec.lang = 'en-US';
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.onresult = (e) => {
    // Only the tail matters; walk back from the latest result until we have enough words.
    let t = '';
    for (let i = e.results.length - 1; i >= 0 && t.split(/\s+/).length <= tune.tail + 4; i--) {
      t = e.results[i][0].transcript + ' ' + t;
    }
    handleSpeech(t);
  };

  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      stop();
      enableAutoMode();
      toast(e.error === 'not-allowed'
        ? 'Microphone access was denied. Allow it in your browser settings, or use auto-scroll.'
        : 'Speech recognition is unavailable. On iPhone, turn on Siri & Dictation in Settings, or try Safari. Auto-scroll is enabled.');
    } else if (e.error === 'audio-capture') {
      stop();
      toast('No microphone found.');
    } else if (e.error === 'network') {
      toast('Speech recognition needs a network connection.');
    }
    // 'no-speech' and 'aborted' are routine; onend restarts.
  };

  rec.onend = () => {
    lastKey = '';
    if (running && !autoMode) {
      setTimeout(() => {
        if (!running || autoMode) return;
        try { startRecognition(); } catch { /* retried on next end */ }
      }, 150);
    }
  };

  rec.start();
}

function start() {
  if (!tokens.length || running) return;
  if (pos >= tokens.length) reset();
  running = true;
  if (autoMode) {
    autoTimer = setInterval(autoStep, 60000 / wpm);
  } else {
    try {
      startRecognition();
    } catch (err) {
      running = false;
      enableAutoMode();
      toast('Could not start speech recognition. Auto-scroll is enabled.');
    }
  }
  requestWakeLock();
  updateControls();
}

function stop() {
  running = false;
  clearInterval(autoTimer);
  if (rec) {
    rec.onend = null;
    try { rec.abort(); } catch { /* already stopped */ }
    rec = null;
  }
  lastKey = '';
  updateControls();
}

function autoStep() {
  if (pos >= tokens.length) { stop(); return; }
  words[tokens[pos].wi].heard = true;
  setPos(pos + 1, true);
}

function enableAutoMode() {
  autoMode = true;
  updateControls();
}

function setWpm(v) {
  wpm = clamp(v, WPM_MIN, WPM_MAX);
  save(KEY.wpm, wpm);
  if (running && autoMode) {
    clearInterval(autoTimer);
    autoTimer = setInterval(autoStep, 60000 / wpm);
  }
  updateControls();
}

function updateControls() {
  paint(); // show / hide the next-word emphasis
  startBtn.textContent = running ? 'Stop' : 'Start';
  startBtn.classList.toggle('stop', running);
  speedBar.hidden = !autoMode;
  wpmLabel.textContent = wpm + ' wpm';
  statusEl.classList.toggle('live', running);
  statusEl.textContent = running
    ? (autoMode ? 'Auto-scrolling' : 'Listening')
    : autoMode ? 'Auto-scroll mode' : pos > 0 ? 'Paused · tap a word to move' : '';
}

// ---------- font size ----------

function setFontSize(v) {
  fontSize = clamp(v, FONT_MIN, FONT_MAX);
  save(KEY.fs, fontSize);
  document.documentElement.style.setProperty('--fs', fontSize + 'px');
  if (!promptView.hidden) layout();
}

// ---------- tuning settings ----------

function loadTuning() {
  let saved = {};
  try { saved = JSON.parse(load(KEY.tune, '{}')) || {}; } catch { /* corrupt; use defaults */ }
  const t = {};
  for (const s of TUNING) t[s.key] = typeof saved[s.key] === 'number' ? clamp(saved[s.key], s.min, s.max) : s.def;
  return t;
}

function setTuning(key, value) {
  const s = TUNING.find((x) => x.key === key);
  // Round to the step to avoid float drift (0.75 + 0.05 + …).
  tune[key] = clamp(Math.round(value / s.step) * s.step, s.min, s.max);
  save(KEY.tune, JSON.stringify(tune));
  lastKey = '';
  renderSettings();
}

function renderSettings() {
  const rows = $('settings-rows');
  if (!rows.children.length) {
    for (const s of TUNING) {
      const row = document.createElement('div');
      row.className = 'setting';
      row.innerHTML = `
        <div class="setting-head">
          <span class="setting-label"></span>
          <div class="stepper">
            <button type="button" data-d="-1" aria-label="Decrease">−</button>
            <output></output>
            <button type="button" data-d="1" aria-label="Increase">+</button>
          </div>
        </div>
        <p class="setting-help"></p>`;
      row.querySelector('.setting-label').textContent = s.label;
      row.querySelector('.setting-help').textContent = s.help;
      row.querySelectorAll('button').forEach((b) => {
        b.addEventListener('click', () => setTuning(s.key, tune[s.key] + +b.dataset.d * s.step));
      });
      rows.append(row);
    }
  }
  TUNING.forEach((s, i) => {
    const row = rows.children[i];
    row.querySelector('output').textContent = s.fmt(tune[s.key]);
    const [down, up] = row.querySelectorAll('button');
    down.disabled = tune[s.key] <= s.min;
    up.disabled = tune[s.key] >= s.max;
  });
}

// ---------- wake lock ----------

async function requestWakeLock() {
  if (!('wakeLock' in navigator) || promptView.hidden || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* not permitted right now */ }
}

function releaseWakeLock() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}

// ---------- views ----------

function showEdit() {
  stop();
  releaseWakeLock();
  input.value = text;
  textDirty = false;
  promptView.hidden = true;
  editView.hidden = false;
}

function showPrompt() {
  if (textDirty) { pos = 0; save(KEY.pos, 0); }
  editView.hidden = true;
  promptView.hidden = false;
  input.blur();
  buildScript();
  updateControls();
  requestWakeLock();
}

let toastTimer = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 6000);
}

// ---------- events ----------

startBtn.addEventListener('click', () => (running ? stop() : start()));
$('reset-btn').addEventListener('click', reset);
$('font-up-btn').addEventListener('click', () => setFontSize(fontSize + FONT_STEP));
$('font-down-btn').addEventListener('click', () => setFontSize(fontSize - FONT_STEP));
$('slower-btn').addEventListener('click', () => setWpm(wpm - WPM_STEP));
$('faster-btn').addEventListener('click', () => setWpm(wpm + WPM_STEP));
$('edit-btn').addEventListener('click', showEdit);
$('done-btn').addEventListener('click', showPrompt);
toastEl.addEventListener('click', () => { toastEl.hidden = true; });

const settingsDialog = $('settings');
document.querySelectorAll('.settings-btn').forEach((b) => b.addEventListener('click', () => {
  renderSettings();
  settingsDialog.showModal();
}));
$('settings-done').addEventListener('click', () => settingsDialog.close());
$('settings-defaults').addEventListener('click', () => {
  for (const s of TUNING) tune[s.key] = s.def;
  setTuning(TUNING[0].key, TUNING[0].def);
});
// Tap outside the panel to close.
settingsDialog.addEventListener('click', (e) => { if (e.target === settingsDialog) settingsDialog.close(); });

input.addEventListener('input', () => {
  text = input.value;
  textDirty = true;
  save(KEY.text, text);
});

$('clear-btn').addEventListener('click', () => {
  if (!input.value || !confirm('Delete all text?')) return;
  input.value = '';
  input.dispatchEvent(new Event('input'));
});

$('paste-btn').addEventListener('click', async () => {
  try {
    const clip = await navigator.clipboard.readText();
    if (!clip) return;
    if (input.value && !confirm('Replace the current text with the clipboard?')) return;
    input.value = clip;
    input.dispatchEvent(new Event('input'));
  } catch {
    toast('Paste was blocked. Long-press the text box and choose Paste.');
  }
});

scriptEl.addEventListener('click', (e) => {
  const el = e.target.closest('.w');
  if (el) jumpToWord(+el.dataset.i);
});

// Let the user scroll by hand without the animation fighting them.
scroller.addEventListener('touchstart', stopAnimation, { passive: true });
scroller.addEventListener('wheel', stopAnimation, { passive: true });

let resizeRaf = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => { if (!promptView.hidden) layout(); });
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    requestWakeLock();
  } else if (running) {
    stop(); // iOS cuts the mic when backgrounded anyway
  }
});

// ---------- boot ----------

document.documentElement.style.setProperty('--fs', fontSize + 'px');
$('app-version').textContent = 'Version ' + self.APP_VERSION;
if (text.trim()) {
  showPrompt();
} else {
  showEdit();
}
if (!SR) toast('Speech recognition isn’t available in this browser, so auto-scroll is on. Try Safari for voice tracking.');

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js?v=' + self.APP_VERSION).catch(() => {});
}
