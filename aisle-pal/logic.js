// Pure logic: text normalising, store sections, item matching, intent parsing,
// and learning the shopper's route. No DOM access, so it runs under node tests.

export const SECTIONS = [
  { id: 'produce', name: 'Produce', words: 'apple banana orange lemon lime grape berry strawberry blueberry raspberry melon watermelon peach pear plum mango pineapple avocado tomato potato onion garlic ginger carrot celery lettuce spinach kale arugula cabbage broccoli cauliflower cucumber zucchini squash pepper mushroom corn herb cilantro parsley basil mint scallion salad fruit vegetable veggie produce asparagus eggplant radish beet kiwi cherry' },
  { id: 'bakery', name: 'Bakery', words: 'bread bagel bun roll baguette croissant muffin tortilla pita donut doughnut cake pie pastry sourdough loaf naan' },
  { id: 'deli', name: 'Deli', words: 'deli salami prosciutto pepperoni hummus rotisserie olive|bar cold|cut lunch|meat sliced|turkey sliced|ham' },
  { id: 'dairy', name: 'Dairy', words: 'milk cheese yogurt yoghurt butter cream egg cheddar mozzarella parmesan feta creamer kefir margarine dairy half|and|half sour|cream cream|cheese cottage|cheese' },
  { id: 'meat', name: 'Meat', words: 'meat beef steak chicken pork bacon sausage turkey ham lamb veal brisket rib ribeye sirloin burger patty mince wing thigh drumstick hot|dog ground|beef ground|turkey chicken|breast' },
  { id: 'seafood', name: 'Seafood', words: 'fish salmon tuna shrimp prawn cod tilapia crab lobster scallop seafood oyster clam mussel halibut trout' },
  { id: 'frozen', name: 'Frozen', words: 'frozen ice|cream pizza popsicle waffle sorbet gelato ice fries nugget' },
  { id: 'pantry', name: 'Pantry', words: 'rice pasta spaghetti noodle flour sugar salt oil vinegar sauce ketchup mustard mayo mayonnaise broth stock soup bean lentil cereal oat oatmeal granola honey jam jelly syrup spice seasoning cinnamon cumin paprika can canned tuna|can peanut|butter almond|butter olive|oil baking yeast vanilla quinoa couscous salsa dressing pickle olive tomato|sauce tomato|paste pepper|flake black|pepper' },
  { id: 'snacks', name: 'Snacks', words: 'chip crisp cracker cookie candy chocolate popcorn pretzel nut almond cashew peanut snack bar gum trail|mix' },
  { id: 'beverages', name: 'Beverages', words: 'water juice soda pop cola coffee tea beer wine seltzer kombucha lemonade drink beverage sparkling|water energy|drink' },
  { id: 'household', name: 'Household', words: 'paper towel tissue napkin detergent soap bleach sponge foil wrap bag trash cleaner battery bulb candle dish|soap laundry toilet|paper paper|towel trash|bag light|bulb' },
  { id: 'personal', name: 'Personal care', words: 'shampoo conditioner toothpaste toothbrush deodorant lotion razor floss sunscreen vitamin medicine bandage diaper wipe makeup body|wash' },
  { id: 'other', name: 'Other', words: '' },
];
export const SECTION_IDS = SECTIONS.map((s) => s.id);
export const sectionName = (id) => (SECTIONS.find((s) => s.id === id) || SECTIONS.at(-1)).name;

const STOP = new Set('a an the some of my our i ive we just got get grabbed grab picked pick up have has found took take okay ok and also now then here is it that this these those to in for with on at please um uh so well already one two couple few pack package bottle box bag carton gallon jar bunch pound pounds lb lbs dozen'.split(' '));
// Words that describe rather than identify an item ("organic grass-fed milk").
const FILLER = new Set('organic fresh free range grass fed whole low fat nonfat skim large small big medium natural unsalted salted raw local brand new'.split(' '));

export function singular(w) {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && w.endsWith('oes')) return w.slice(0, -2);
  if (w.length > 4 && /(ch|sh|x|ss)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export function rawTokens(text) {
  return String(text).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).map(singular);
}
export function tokens(text) {
  const t = rawTokens(text).filter((w) => !STOP.has(w));
  return t;
}
export const itemKey = (name) => tokens(name).join(' ') || rawTokens(name).join(' ');

// keyword -> section lookup (single words and phrases)
const WORD_SECTION = new Map();
const PHRASE_SECTION = [];
for (const s of SECTIONS) {
  for (const w of s.words.split(' ').filter(Boolean)) {
    if (w.includes('|')) PHRASE_SECTION.push({ phrase: w.split('|').map(singular).join(' '), id: s.id });
    else if (!WORD_SECTION.has(singular(w))) WORD_SECTION.set(singular(w), s.id);
  }
}
PHRASE_SECTION.sort((a, b) => b.phrase.length - a.phrase.length);

// Which section an item lives in. Learned placements win, then phrases,
// then the last recognised word ("chicken broth" -> broth -> pantry).
export function classify(name, habits) {
  const key = itemKey(name);
  const votes = habits?.itemVotes?.[key];
  if (votes) {
    const top = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    if (top) return top[0];
  }
  const toks = rawTokens(name);
  const joined = ' ' + toks.join(' ') + ' ';
  for (const p of PHRASE_SECTION) if (joined.includes(' ' + p.phrase + ' ')) return p.id;
  for (let i = toks.length - 1; i >= 0; i--) if (WORD_SECTION.has(toks[i])) return WORD_SECTION.get(toks[i]);
  return 'other';
}

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const sameWord = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && editDistance(a, b) <= 1);

// Find the list item an utterance refers to. Returns { item, score } or null.
export function matchItem(utterance, items) {
  const said = tokens(utterance);
  if (!said.length) return null;
  let best = null;
  for (const item of items) {
    const all = tokens(item.name);
    const core = all.filter((w) => !FILLER.has(w));
    const want = core.length ? core : all;
    if (!want.length) continue;
    const hit = want.filter((w) => said.some((s) => sameWord(s, w))).length;
    if (!hit) continue;
    const score = hit / want.length;
    // extra descriptive words that also match break ties ("whole milk" vs "oat milk")
    const bonus = all.filter((w) => said.some((s) => sameWord(s, w))).length;
    if (score >= 0.5 && (!best || score > best.score || (score === best.score && bonus > best.bonus))) best = { item, score, bonus };
  }
  return best;
}

const PICKUP_START = /^(?:(?:okay|ok|alright|all right|and|so|now|yes|yeah|yep|i|ive|i have|we|weve|just)\s+)*(?:got|grabbed|picked|have|found|took|getting|grabbing)\b/;

// Decide what the shopper meant while shopping.
export function parseIntent(text) {
  const t = String(text).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return { type: 'none' };
  if (PICKUP_START.test(t)) return { type: 'pickup', verb: true, text: t };
  let m;
  if ((m = t.match(/^(?:please |can you |could you |also |and |oh |hey )*(?:add|i also need|we also need|also need|i need|we need|put)\s+(.+?)(?:\s+(?:to|on) (?:the |my )?list)?$/))) return { type: 'add', text: m[1] };
  if (/\b(undo|oops|put (it|that|them) back|didnt get|did not get|never mind|nevermind)\b/.test(t)) return { type: 'undo', text: t };
  if (/\b(done shopping|finished shopping|finish shopping|end (the |my )?trip|im (all )?done|thats everything|thats all|check ?out)\b/.test(t)) return { type: 'finish' };
  if (/\b(theyre out|they are out|out of stock|sold out|dont need|do not need|remove|forget|take off|cross off|scratch)\b/.test(t)) return { type: 'remove', text: t.replace(/.*\b(theyre out of|they are out of|out of stock|sold out of|sold out|dont need|do not need|remove|forget|take off|cross off|scratch)\b/, '') };
  if (/\b(skip|cant find|can not find|cannot find|come back|later|not yet)\b/.test(t)) return { type: 'skip', text: t.replace(/.*\b(skip|cant find|can not find|cannot find|come back to|come back for|come back)\b/, '') };
  if (/\b(whats left|what is left|whats remaining|how many|what do i (still )?need|read (the |my )?list|remaining)\b/.test(t)) return { type: 'left' };
  if (/\b(whats next|what is next|what next|next( one| item)?$|where (to|next)|what now)\b/.test(t)) return { type: 'next' };
  if (/\b(repeat|say (that|it) again|what did you say|pardon|come again)\b/.test(t)) return { type: 'repeat' };
  return { type: 'pickup', verb: false, text: t };
}

// Split "milk, eggs and bread" into separate item names.
export function splitItems(text) {
  return String(text)
    .replace(/\b(?:to|on) (?:the |my )?list\b/gi, '')
    .split(/\s*(?:,|;|\band\b|\bplus\b|\bthen\b|\balso\b)\s*/i)
    .map((s) => s.replace(/^(?:some|a|an|the|please|add|i need|we need)\s+/i, '').trim())
    .filter((s) => s.length > 1);
}

export function yesNo(text) {
  const t = ' ' + String(text).toLowerCase().replace(/['’]/g, '').replace(/[^a-z ]+/g, ' ') + ' ';
  if (/ (no|nope|not yet|wait|hold on|change|edit|go back|not firm|isnt|cancel) /.test(t)) return 'no';
  if (/ (yes|yeah|yep|yup|firm|correct|confirm|confirmed|thats it|thats right|lock it|lets go|start|sure|ready|good to go|go ahead) /.test(t)) return 'yes';
  return null;
}

// ---------- habits: learning how this shopper walks the store ----------

export const emptyHabits = () => ({ trips: 0, pos: {}, trans: {}, itemPos: {}, itemVotes: {} });

// 0..1 position of a section along the shopper's usual route.
// Starts from a generic store layout and shifts toward what we observe.
export function sectionRank(id, habits) {
  const prior = SECTION_IDS.indexOf(id) / (SECTION_IDS.length - 1);
  const p = habits?.pos?.[id];
  return p ? (prior + p.sum) / (1 + p.n) : prior;
}

// Pick the next item to suggest: stay in the current section, otherwise go to
// the section this shopper usually visits next, otherwise the nearest one ahead.
export function nextItem(pending, lastSection, habits) {
  if (!pending.length) return null;
  const active = pending.some((i) => !i.deferred) ? pending.filter((i) => !i.deferred) : pending;
  const within = (list) =>
    [...list].sort((a, b) => {
      const pa = habits?.itemPos?.[itemKey(a.name)], pb = habits?.itemPos?.[itemKey(b.name)];
      if (pa && pb) return pa.sum / pa.n - pb.sum / pb.n;
      return 0;
    })[0];
  const sections = [...new Set(active.map((i) => i.section))];
  let target;
  let reason = 'route';
  if (lastSection && sections.includes(lastSection)) {
    target = lastSection;
    reason = 'same';
  } else if (lastSection) {
    const tr = habits?.trans?.[lastSection] || {};
    const learned = sections.filter((s) => tr[s] > 0).sort((a, b) => tr[b] - tr[a])[0];
    if (learned) {
      target = learned;
      reason = 'habit';
    } else {
      const here = sectionRank(lastSection, habits);
      const ahead = sections.filter((s) => sectionRank(s, habits) >= here);
      const pool = ahead.length ? ahead : sections;
      target = pool.sort((a, b) => Math.abs(sectionRank(a, habits) - here) - Math.abs(sectionRank(b, habits) - here))[0];
      reason = 'near';
    }
  } else {
    target = sections.sort((a, b) => sectionRank(a, habits) - sectionRank(b, habits))[0];
    reason = 'start';
  }
  return { item: within(active.filter((i) => i.section === target)), reason };
}

// Fold one finished trip (ordered pickups: [{ name, section }]) into the habits.
export function learnTrip(habits, order) {
  const h = structuredClone(habits || emptyHabits());
  if (order.length < 2) return h;
  h.trips++;
  const n = order.length - 1;
  const secPos = {};
  order.forEach((p, i) => {
    const at = i / n;
    (secPos[p.section] ||= []).push(at);
    const k = itemKey(p.name);
    const ip = (h.itemPos[k] ||= { sum: 0, n: 0 });
    ip.sum += at;
    ip.n++;
    // an unrecognised item is probably shelved near whatever was picked just before/after it
    if (classify(p.name, null) === 'other') {
      const neighbour = [order[i - 1], order[i + 1]].find((o) => o && o.section !== 'other');
      if (neighbour) {
        const v = (h.itemVotes[k] ||= {});
        v[neighbour.section] = (v[neighbour.section] || 0) + 1;
      }
    }
    const prev = order[i - 1];
    if (prev && prev.section !== p.section) {
      const t = (h.trans[prev.section] ||= {});
      t[p.section] = (t[p.section] || 0) + 1;
    }
  });
  for (const [sec, arr] of Object.entries(secPos)) {
    const sp = (h.pos[sec] ||= { sum: 0, n: 0 });
    sp.sum += arr.reduce((a, b) => a + b, 0) / arr.length;
    sp.n++;
  }
  return h;
}
