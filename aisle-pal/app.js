import * as L from './logic.js';
import { Voice } from './voice.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => Math.random().toString(36).slice(2, 10);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const listOut = (names) => (names.length <= 1 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names.at(-1));

// ---------- state (kept on this device only) ----------
const KEY = 'aislepal.v1';
const fresh = () => ({
  phase: 'build', // build | shop | done
  list: [], // { id, name, section, status: pending|got|gone, deferred }
  order: [], // pickups this trip, in order: { name, section }
  currentId: null,
  lastSection: null,
  history: {}, // itemKey -> { name, count, last }
  habits: L.emptyHabits(),
  summary: null,
});
function load() {
  try {
    return { ...fresh(), ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return fresh();
  }
}
let S = load();
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
  } catch {
    /* private mode: keep working in memory */
  }
};

// ---------- voice ----------
let lastSaid = '';
let confirming = false;
let buildListening = false;
const voice = new Voice({
  onFinal: (text) => route(text),
  onInterim: (text) => {
    if (!text) return;
    if (confirming) $('confirmHeard').textContent = '“' + text + '”';
    else if (S.phase === 'shop') $('heard').textContent = text + '…';
    else $('buildHeard').textContent = '“' + text + '…”';
  },
  onState: () => renderMic(),
  onError: (msg) => {
    buildListening = false;
    showBanner(msg);
    if (S.phase === 'build') $('buildHeard').textContent = msg;
    renderMic();
  },
});

function say(text) {
  lastSaid = text;
  $('said').textContent = text;
  return voice.speak(text);
}

function route(text) {
  if (confirming) return onConfirmSpeech(text);
  if (S.phase === 'shop') return onShopSpeech(text);
  if (S.phase === 'build') return onBuildSpeech(text);
}

// ---------- build phase ----------
function addItems(text) {
  const added = [];
  for (const name of L.splitItems(text)) {
    const key = L.itemKey(name);
    if (!key || S.list.some((i) => L.itemKey(i.name) === key && i.status !== 'gone')) continue;
    S.list.push({ id: uid(), name, section: L.classify(name, S.habits), status: 'pending', deferred: false });
    added.push(name);
  }
  save();
  render();
  return added;
}

function onBuildSpeech(text) {
  $('buildHeard').textContent = '“' + text + '”';
  if (/^(thats it|that's it|thats all|that's all|done|lock it in|lock in|finished|im done|i'm done)\b/i.test(text.trim())) {
    if (S.list.length) openConfirm();
    return;
  }
  const rm = text.match(/^(?:remove|delete|take off|scratch)\s+(.+)/i);
  if (rm) {
    const m = L.matchItem(rm[1], S.list);
    if (m) {
      S.list = S.list.filter((i) => i.id !== m.item.id);
      save();
      render();
      voice.speak('Removed ' + m.item.name + '.');
    }
    return;
  }
  const added = addItems(text.replace(/^(?:add|i need|we need|put)\s+/i, ''));
  if (added.length) voice.speak('Added ' + listOut(added) + '.');
}

function usuals() {
  const onList = new Set(S.list.map((i) => L.itemKey(i.name)));
  return Object.entries(S.history)
    .filter(([k]) => !onList.has(k))
    .sort((a, b) => b[1].count - a[1].count || b[1].last - a[1].last)
    .slice(0, 12)
    .map(([, v]) => v.name);
}

// ---------- "is this list firm?" ----------
function openConfirm() {
  if (!S.list.length) return;
  stopBuildMic();
  confirming = true;
  const names = S.list.map((i) => i.name);
  $('confirmCount').textContent = names.length + (names.length === 1 ? ' item' : ' items') + '. Say “yes” to start, or “no” to keep editing.';
  $('confirmList').innerHTML = S.list.map((i) => `<li><span>${esc(i.name)}</span><span>${esc(L.sectionName(i.section))}</span></li>`).join('');
  $('confirmHeard').textContent = '';
  $('confirmDlg').showModal();
  voice.start();
  voice.speak(`You have ${names.length} ${names.length === 1 ? 'item' : 'items'}: ${listOut(names)}. Is this list firm?`);
}
function closeConfirm() {
  confirming = false;
  if ($('confirmDlg').open) $('confirmDlg').close();
}
function onConfirmSpeech(text) {
  $('confirmHeard').textContent = '“' + text + '”';
  const a = L.yesNo(text);
  if (a === 'yes') startShopping();
  else if (a === 'no') {
    closeConfirm();
    voice.hush();
    voice.stop();
    voice.speak('Okay, keep editing.');
  }
}

// ---------- shopping phase ----------
const pending = () => S.list.filter((i) => i.status === 'pending');
const got = () => S.list.filter((i) => i.status === 'got');

function startShopping() {
  closeConfirm();
  S.phase = 'shop';
  S.order = [];
  S.lastSection = null;
  S.list.forEach((i) => {
    i.status = 'pending';
    i.deferred = false;
  });
  save();
  render();
  voice.start();
  keepAwake();
  suggest("List locked. Let's shop.", true);
}

// Work out the next item and say it. `lead` is spoken first.
function suggest(lead, opening = false) {
  const n = L.nextItem(pending(), S.lastSection, S.habits);
  if (!n) {
    S.currentId = null;
    save();
    render();
    return say(`${lead} That's everything on your list. Say “I'm done” to end the trip.`);
  }
  S.currentId = n.item.id;
  save();
  render();
  const sec = L.sectionName(n.item.section);
  const known = n.item.section !== 'other';
  let line;
  if (opening) line = known ? `Start in ${sec}: ${n.item.name}.` : `Start with ${n.item.name}.`;
  else if (n.reason === 'same') line = `While you're in ${sec}, grab ${n.item.name}.`;
  else if (n.reason === 'habit') line = `You usually head to ${sec} next: ${n.item.name}.`;
  else line = known ? `Next, ${sec}: ${n.item.name}.` : `Next: ${n.item.name}.`;
  return say(`${lead} ${line}`.trim());
}

function markGot(item, lead) {
  item.status = 'got';
  item.deferred = false;
  S.order.push({ name: item.name, section: item.section, id: item.id });
  if (item.section !== 'other') S.lastSection = item.section;
  suggest(lead || pick(['Got it.', 'Nice.', 'Check.', 'Perfect.', 'Great.']));
}

function onShopSpeech(text) {
  $('heard').textContent = text;
  const intent = L.parseIntent(text);
  const cur = S.list.find((i) => i.id === S.currentId && i.status === 'pending');
  switch (intent.type) {
    case 'pickup': {
      const m = L.matchItem(text, pending());
      if (m) return markGot(m.item);
      const had = L.matchItem(text, got());
      if (had && intent.verb) return say(`You already have ${had.item.name}.`);
      // "got it" with nothing named means the item just suggested
      if (intent.verb && cur && /\b(it|that|them|those|this)\b/.test(intent.text) && L.tokens(intent.text).length === 0) return markGot(cur);
      if (intent.verb) return say(`I don't see that on your list. Say “add” and the item if you want it.`);
      return; // background chatter: stay quiet
    }
    case 'add': {
      const added = addItems(intent.text);
      if (!added.length) return say("That's already on your list.");
      return suggest(`Added ${listOut(added)}.`);
    }
    case 'skip': {
      const target = L.matchItem(intent.text, pending())?.item || cur;
      if (!target) return;
      if (pending().length === 1) return say(`${target.name} is the only thing left. Say “remove it” to drop it, or “I'm done” to finish.`);
      target.deferred = true;
      return suggest(`Okay, ${target.name} later.`);
    }
    case 'remove': {
      const target = L.matchItem(intent.text, pending())?.item || (L.tokens(intent.text).length ? null : cur);
      if (!target) return say("I couldn't tell which item to take off.");
      target.status = 'gone';
      return suggest(`Took ${target.name} off the list.`);
    }
    case 'undo': {
      const last = S.order.pop();
      const item = last && S.list.find((i) => i.id === last.id);
      if (!item) return say('Nothing to undo.');
      item.status = 'pending';
      S.lastSection = S.order.at(-1)?.section ?? null;
      S.currentId = item.id;
      save();
      render();
      return say(`Okay, ${item.name} is back on the list.`);
    }
    case 'left': {
      const names = pending().map((i) => i.name);
      return say(names.length ? `${names.length} left: ${listOut(names)}.` : 'Nothing left. You have everything.');
    }
    case 'next':
      return suggest('');
    case 'repeat':
      return say(lastSaid || 'I have nothing to repeat.');
    case 'finish':
      return finishTrip();
  }
}

function finishTrip() {
  const gotItems = got();
  const missed = pending();
  const now = Date.now();
  for (const i of gotItems) {
    const k = L.itemKey(i.name);
    const h = (S.history[k] ||= { name: i.name, count: 0, last: 0 });
    h.count++;
    h.last = now;
    h.name = i.name;
  }
  S.habits = L.learnTrip(S.habits, S.order);
  S.summary = { got: gotItems.length, total: gotItems.length + missed.length, missed: missed.map((i) => i.name) };
  S.phase = 'done';
  S.currentId = null;
  save();
  render();
  releaseAwake();
  const line = missed.length ? `Trip done. You got ${gotItems.length} of ${S.summary.total}. I'll keep ${listOut(S.summary.missed)} for next time.` : `Trip done. You got all ${gotItems.length} items. I'll remember this for next time.`;
  say(line).then(() => voice.stop());
}

function newList() {
  const carry = S.summary?.missed || [];
  S.phase = 'build';
  S.list = [];
  S.order = [];
  S.summary = null;
  S.lastSection = null;
  save();
  voice.hush();
  voice.stop();
  if (carry.length) addItems(carry.join(', '));
  render();
}

// ---------- keep the screen on while shopping ----------
let wake = null;
async function keepAwake() {
  try {
    wake = await navigator.wakeLock?.request('screen');
  } catch {
    /* not supported or denied */
  }
}
function releaseAwake() {
  wake?.release?.().catch(() => {});
  wake = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.phase === 'shop') {
    keepAwake();
    if (voice.want) voice.startRec();
  }
});

// ---------- rendering ----------
function showBanner(msg) {
  const b = $('voiceBanner');
  b.textContent = msg;
  b.hidden = !msg;
}

function renderMic() {
  const st = voice.state;
  const orb = $('orb');
  orb.className = 'orb ' + st;
  orb.setAttribute('aria-label', st === 'off' ? 'Microphone off. Tap to turn on.' : 'Microphone on. Tap to mute.');
  $('micState').textContent = !voice.supported ? 'Voice not available' : st === 'speaking' ? 'Speaking…' : st === 'listening' ? 'Listening…' : 'Mic off — tap to resume';
  $('buildMic').setAttribute('aria-pressed', String(buildListening && st !== 'off'));
}

const sectionSelect = (item) =>
  `<select data-sec="${item.id}" aria-label="Section for ${esc(item.name)}">${L.SECTIONS.map((s) => `<option value="${s.id}"${s.id === item.section ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`;

function render() {
  $('viewBuild').hidden = S.phase !== 'build';
  $('viewShop').hidden = S.phase !== 'shop';
  $('viewDone').hidden = S.phase !== 'done';
  $('phaseTag').textContent = { build: 'Planning', shop: 'Shopping', done: 'Done' }[S.phase];

  if (S.phase === 'build') {
    $('buildList').innerHTML = S.list
      .map((i) => `<li class="item"><span class="name">${esc(i.name)}</span>${sectionSelect(i)}<button class="x" data-del="${i.id}" aria-label="Remove ${esc(i.name)}">×</button></li>`)
      .join('');
    $('buildEmpty').hidden = S.list.length > 0;
    $('listTitle').textContent = S.list.length ? `Your list · ${S.list.length}` : 'Your list';
    $('lockBtn').disabled = !S.list.length;
    const u = usuals();
    $('usualsWrap').hidden = !u.length;
    $('usuals').innerHTML = u.map((n) => `<button class="chip" data-usual="${esc(n)}">${esc(n)}</button>`).join('');
  }

  if (S.phase === 'shop') {
    const p = pending();
    const g = got();
    const cur = p.find((i) => i.id === S.currentId);
    $('progress').textContent = `${g.length} of ${g.length + p.length} in the cart`;
    $('nextLabel').textContent = cur ? 'Next up' : 'All done';
    $('nextName').textContent = cur ? cur.name : 'You have everything';
    $('nextWhy').textContent = cur ? L.sectionName(cur.section) : 'Say “I’m done” or tap End trip.';
    const order = [...p].sort((a, b) => (b.id === S.currentId) - (a.id === S.currentId) || a.deferred - b.deferred || L.sectionRank(a.section, S.habits) - L.sectionRank(b.section, S.habits));
    $('shopPending').innerHTML = order
      .map((i) => `<li class="item tap${i.id === S.currentId ? ' current' : ''}${i.deferred ? ' later' : ''}" data-got="${i.id}" role="button" tabindex="0"><span class="box"></span><span class="name">${esc(i.name)}</span><span class="sec">${esc(L.sectionName(i.section))}</span></li>`)
      .join('');
    $('gotTitle').hidden = !g.length;
    $('shopGot').innerHTML = [...g]
      .reverse()
      .map((i) => `<li class="item tap got" data-ungot="${i.id}" role="button" tabindex="0"><span class="box"></span><span class="name">${esc(i.name)}</span><span class="sec">${esc(L.sectionName(i.section))}</span></li>`)
      .join('');
    if (!voice.supported) showBanner('This browser can’t do speech recognition. Use Chrome on Android or Safari on iPhone for hands-free mode — for now, tap items or type below.');
  }

  if (S.phase === 'done' && S.summary) {
    const s = S.summary;
    $('doneTitle').textContent = s.missed.length ? 'Trip complete' : 'Got everything!';
    $('doneText').textContent = `${s.got} of ${s.total} items in the cart.`;
    $('leftWrap').hidden = !s.missed.length;
    $('leftList').innerHTML = s.missed.map((n) => `<li class="item"><span class="name">${esc(n)}</span></li>`).join('');
    const route = Object.keys(S.habits.pos)
      .filter((id) => id !== 'other')
      .sort((a, b) => L.sectionRank(a, S.habits) - L.sectionRank(b, S.habits))
      .map(L.sectionName);
    $('learnWrap').hidden = route.length < 2;
    $('learnText').textContent = `Learned from ${S.habits.trips} ${S.habits.trips === 1 ? 'trip' : 'trips'}: ${route.join(' → ')}`;
  }
  renderMic();
}

// ---------- events ----------
function stopBuildMic() {
  buildListening = false;
  if (!confirming && S.phase === 'build') voice.stop();
}

$('addForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('addInput').value.trim();
  if (v) addItems(v);
  $('addInput').value = '';
});
$('buildMic').addEventListener('click', () => {
  if (!voice.supported) {
    $('buildHeard').textContent = 'Speech recognition isn’t available in this browser. Type your items instead.';
    return;
  }
  if (buildListening) stopBuildMic();
  else {
    buildListening = true;
    $('buildHeard').textContent = 'Listening… say your items, then “that’s it”.';
    voice.start();
  }
  renderMic();
});
$('buildList').addEventListener('click', (e) => {
  const id = e.target.dataset.del;
  if (!id) return;
  S.list = S.list.filter((i) => i.id !== id);
  save();
  render();
});
$('buildList').addEventListener('change', (e) => {
  const id = e.target.dataset.sec;
  const item = S.list.find((i) => i.id === id);
  if (!item) return;
  item.section = e.target.value;
  // remember the correction for next time
  const v = (S.habits.itemVotes[L.itemKey(item.name)] = {});
  v[item.section] = 100;
  save();
});
$('usuals').addEventListener('click', (e) => {
  if (e.target.dataset.usual) addItems(e.target.dataset.usual);
});
$('lockBtn').addEventListener('click', openConfirm);
$('confirmYes').addEventListener('click', startShopping);
$('confirmNo').addEventListener('click', () => {
  closeConfirm();
  voice.hush();
  voice.stop();
});
$('confirmDlg').addEventListener('close', () => {
  if (confirming) {
    confirming = false;
    voice.hush();
    voice.stop();
  }
});

$('orb').addEventListener('click', () => {
  if (voice.want) {
    voice.hush();
    voice.stop();
  } else {
    showBanner('');
    voice.start();
  }
});
$('sayForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('sayInput').value.trim();
  $('sayInput').value = '';
  if (v) onShopSpeech(v);
});
function tapList(e) {
  const li = e.target.closest('[data-got],[data-ungot]');
  if (!li) return;
  if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
  if (li.dataset.got) {
    const item = S.list.find((i) => i.id === li.dataset.got);
    if (item) markGot(item);
  } else {
    const item = S.list.find((i) => i.id === li.dataset.ungot);
    if (!item) return;
    item.status = 'pending';
    S.order = S.order.filter((o) => o.id !== item.id);
    S.lastSection = S.order.at(-1)?.section ?? null;
    suggest(`${item.name} is back on the list.`);
  }
}
for (const id of ['shopPending', 'shopGot']) {
  $(id).addEventListener('click', tapList);
  $(id).addEventListener('keydown', tapList);
}
$('endBtn').addEventListener('click', () => {
  const left = pending().length;
  if (!left || confirm(`End the trip with ${left} ${left === 1 ? 'item' : 'items'} still to get?`)) finishTrip();
});
$('newBtn').addEventListener('click', newList);

render();
// A reload mid-trip keeps the list; the mic needs a tap to reopen (browser rule).
if (S.phase === 'shop') $('said').textContent = 'Tap the mic to pick up where you left off.';

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
