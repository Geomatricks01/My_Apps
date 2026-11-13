import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../logic.js';

const mk = (names, habits) => names.map((name, i) => ({ id: String(i), name, section: L.classify(name, habits) }));

test('classify uses head noun and phrases', () => {
  assert.equal(L.classify('organic grass-fed milk'), 'dairy');
  assert.equal(L.classify('chicken broth'), 'pantry');
  assert.equal(L.classify('peanut butter'), 'pantry');
  assert.equal(L.classify('butter'), 'dairy');
  assert.equal(L.classify('ground beef'), 'meat');
  assert.equal(L.classify('ice cream'), 'frozen');
  assert.equal(L.classify('tomatoes'), 'produce');
  assert.equal(L.classify('orange juice'), 'beverages');
  assert.equal(L.classify('zzyzx'), 'other');
});

test('matchItem finds the spoken item', () => {
  const items = mk(['milk', 'ground beef', 'eggs', 'oat milk', 'paper towels']);
  assert.equal(L.matchItem('I just got the organic grass-fed milk', items).item.name, 'milk');
  assert.equal(L.matchItem('got the oat milk', items).item.name, 'oat milk');
  assert.equal(L.matchItem('okay grabbed some beef', items).item.name, 'ground beef');
  assert.equal(L.matchItem('picked up a dozen eggs', items).item.name, 'eggs');
  assert.equal(L.matchItem('I have the paper towel', items).item.name, 'paper towels');
  assert.equal(L.matchItem('nice weather today', items), null);
});

test('descriptive list names still match plain speech', () => {
  const items = mk(['organic grass-fed milk', 'free range eggs']);
  assert.equal(L.matchItem('got the milk', items).item.name, 'organic grass-fed milk');
  assert.equal(L.matchItem('got eggs', items).item.name, 'free range eggs');
});

test('parseIntent', () => {
  assert.equal(L.parseIntent('I just got the milk').type, 'pickup');
  assert.equal(L.parseIntent('I just got the milk').verb, true);
  assert.equal(L.parseIntent('milk').verb, false);
  assert.deepEqual(L.parseIntent('add bananas to the list'), { type: 'add', text: 'bananas' });
  assert.equal(L.parseIntent("what's next").type, 'next');
  assert.equal(L.parseIntent("what's left").type, 'left');
  assert.equal(L.parseIntent('skip that').type, 'skip');
  assert.equal(L.parseIntent("they're out of salmon").type, 'remove');
  assert.equal(L.parseIntent("I'm done").type, 'finish');
  assert.equal(L.parseIntent('undo').type, 'undo');
  assert.equal(L.parseIntent('got the finish dishwasher tabs').type, 'pickup');
});

test('splitItems and yesNo', () => {
  assert.deepEqual(L.splitItems('milk, eggs and some bread'), ['milk', 'eggs', 'bread']);
  assert.equal(L.yesNo('yes that is firm'), 'yes');
  assert.equal(L.yesNo('no wait'), 'no');
  assert.equal(L.yesNo('hmm'), null);
});

test('nextItem stays in section, then moves to the neighbouring one', () => {
  const items = mk(['bananas', 'milk', 'eggs', 'ground beef', 'cereal']);
  const h = L.emptyHabits();
  assert.equal(L.nextItem(items, null, h).item.name, 'bananas');
  const afterMilk = items.filter((i) => i.name !== 'milk');
  assert.equal(L.nextItem(afterMilk, 'dairy', h).item.name, 'eggs');
});

test('learned habit: dairy then meat', () => {
  let h = L.emptyHabits();
  const trip = [
    { name: 'milk', section: 'dairy' },
    { name: 'eggs', section: 'dairy' },
    { name: 'ground beef', section: 'meat' },
    { name: 'bananas', section: 'produce' },
  ];
  h = L.learnTrip(h, trip);
  h = L.learnTrip(h, trip);
  const items = mk(['bananas', 'ground beef', 'cereal', 'frozen pizza']);
  const n = L.nextItem(items, 'dairy', h);
  assert.equal(n.item.name, 'ground beef');
  assert.equal(n.reason, 'habit');
  // and this shopper now starts in dairy rather than produce
  const start = L.nextItem(mk(['bananas', 'milk']), null, h);
  assert.equal(start.item.name, 'milk');
});

test('unknown items learn a section from their neighbours', () => {
  let h = L.emptyHabits();
  h = L.learnTrip(h, [
    { name: 'milk', section: 'dairy' },
    { name: 'skyr', section: 'other' },
    { name: 'bread', section: 'bakery' },
  ]);
  assert.equal(L.classify('skyr', h), 'dairy');
});

test('deferred items come last', () => {
  const items = mk(['milk', 'eggs']);
  items[0].deferred = true;
  assert.equal(L.nextItem(items, 'dairy', L.emptyHabits()).item.name, 'eggs');
});
