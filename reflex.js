'use strict';
/*
 * HappyTown — reflex questions for the Final Revenge duels.
 * One glance, one tap: quick sums, "tap the 🐸", odd one out, counting, colours…
 * Every question has 4 options and exactly one right answer (checked by `npm test`).
 * To add your own odd-one-out question, add a line to ODD_ONE_OUT: `ok` = things that fit,
 * `odd` = things that do not (never put the same emoji in both lists).
 */
const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const pick1 = (list) => list[Math.floor(Math.random() * list.length)];
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Four emojis that look alike: "Tap the 🐢"
const LOOKALIKES = [
  ['🐸', '🐢', '🦎', '🐊'], ['🍎', '🍅', '🍒', '🍓'], ['🐶', '🐺', '🦊', '🐱'], ['🚗', '🚕', '🚙', '🚓'],
  ['⚽', '🏀', '🏐', '⚾'], ['🍩', '🍪', '🥯', '🥨'], ['😀', '😃', '😄', '😁'], ['🐵', '🙈', '🙉', '🙊'],
  ['🌕', '🌝', '🌞', '🌚'], ['🐧', '🐦', '🐤', '🦉'], ['😺', '😸', '😹', '😻']
];
// "Which one is NOT …?": three from `ok`, one from `odd`
const ODD_ONE_OUT = [
  { q: 'Which one is NOT food?', ok: ['🍕', '🍔', '🍟', '🌭', '🍩', '🍣', '🌮', '🍜'], odd: ['🧦', '🪑', '📎', '🧱', '🧲', '👟'] },
  { q: 'Which one is NOT an animal?', ok: ['🐶', '🐱', '🐭', '🐰', '🦊', '🐼', '🐸', '🐷'], odd: ['🌵', '🚗', '🎈', '🧀', '☂️', '🎸'] },
  { q: 'Which one can NOT fly?', ok: ['🦅', '🦋', '🐝', '🦉', '🕊️', '🦇', '✈️', '🚁'], odd: ['🐢', '🐷', '🐘', '🐄', '🐌', '🦛'] },
  { q: 'Which one is NOT a fruit?', ok: ['🍎', '🍌', '🍇', '🍓', '🍍', '🍉', '🍒', '🥝'], odd: ['🥕', '🧅', '🥔', '🌽', '🥦', '🍄'] },
  { q: 'Which one is NOT a vehicle?', ok: ['🚗', '🚌', '🚲', '✈️', '🚀', '🚂', '🛵', '🚢'], odd: ['🏠', '🌳', '🦒', '🧸', '🍔', '⛄'] },
  { q: 'Which one is NOT hot?', ok: ['🔥', '🌶️', '☀️', '🌋', '☕'], odd: ['🧊', '⛄', '🍦', '❄️'] },
  { q: 'Which one is NOT money?', ok: ['💵', '💰', '🪙', '💴', '💶', '💳'], odd: ['🧻', '🍪', '🥨', '🧇'] }
];
const COLOR_SQUARES = [['🟥', 'RED'], ['🟦', 'BLUE'], ['🟩', 'GREEN'], ['🟨', 'YELLOW'], ['🟪', 'PURPLE'], ['🟧', 'ORANGE']];
const COUNT_EMOJIS = ['🍩', '⭐', '🐥', '💣', '🎈', '🍕', '🐟'];

// The right number and three different numbers close to it
function numberChoices(ans) {
  const set = new Set([ans]);
  while (set.size < 4) { const d = randInt(-4, 4); if (d && ans + d >= 0) set.add(ans + d); }
  return shuffle([...set]).map(String);
}

const MAKERS = [
  () => { const a = randInt(2, 9); const b = randInt(2, 9); return { text: `${a} + ${b} = ?`, options: numberChoices(a + b), right: String(a + b), kind: 'math' }; },
  () => { const a = randInt(2, 9); const b = randInt(2, 5); return { text: `${a} × ${b} = ?`, options: numberChoices(a * b), right: String(a * b), kind: 'math' }; },
  () => { const a = randInt(12, 20); const b = randInt(3, 9); return { text: `${a} − ${b} = ?`, options: numberChoices(a - b), right: String(a - b), kind: 'math' }; },
  () => { const set = pick1(LOOKALIKES); const t = pick1(set); return { text: `Tap the ${t}`, options: shuffle([...set]), right: t, kind: 'emoji' }; },
  () => {
    const g = pick1(ODD_ONE_OUT);
    const odd = pick1(g.odd);
    return { text: g.q, options: shuffle([...shuffle([...g.ok]).slice(0, 3), odd]), right: odd, kind: 'emoji' };
  },
  () => { const e = pick1(COUNT_EMOJIS); const n = randInt(3, 8); return { text: `How many? ${e.repeat(n)}`, options: numberChoices(n), right: String(n), kind: 'count' }; },
  () => {
    const nums = new Set();
    while (nums.size < 4) nums.add(randInt(10, 99));
    const list = [...nums];
    const big = Math.random() < 0.5;
    return { text: `Tap the ${big ? 'BIGGEST' : 'SMALLEST'} number`, options: shuffle(list).map(String), right: String(big ? Math.max(...list) : Math.min(...list)), kind: 'math' };
  },
  () => {
    const s = randInt(1, 9);
    const st = randInt(2, 6);
    return { text: `${[0, 1, 2, 3].map((i) => s + st * i).join(', ')}, … ?`, options: numberChoices(s + st * 4), right: String(s + st * 4), kind: 'math' };
  },
  () => { const four = shuffle([...COLOR_SQUARES]).slice(0, 4); const t = pick1(four); return { text: `Tap ${t[1]}`, options: four.map((c) => c[0]), right: t[0], kind: 'emoji' }; }
];

// A new reflex question, not the same text as the previous one (for the sudden-death round)
function makeReflex(prevText) {
  let q = null;
  for (let i = 0; i < 6; i++) { q = pick1(MAKERS)(); if (q.text !== prevText) break; }
  return { text: q.text, options: q.options, answer: q.options.indexOf(q.right), kind: q.kind };
}

module.exports = { makeReflex, LOOKALIKES, ODD_ONE_OUT, COLOR_SQUARES, COUNT_EMOJIS };
