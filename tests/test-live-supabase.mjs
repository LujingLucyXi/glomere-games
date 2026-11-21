// Live Supabase end-to-end test for Glomere Games V0 (Who Is the Undercover).
// Simulates 4 separate devices: host + 3 joiners, full round through the real
// PostgREST backend (not the mock). Cleans up its test room afterwards.
// Run from the repo root: node tests/test-live-supabase.mjs
// Reads the Supabase URL/key from config.js. Deletes its test room afterwards.
import { readFileSync } from 'node:fs';
import { GamesAPI } from '../js/api.js';

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const DEPLOY = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfgSrc = readFileSync(`${DEPLOY}/config.js`, 'utf8');
const supabaseUrl = cfgSrc.match(/supabaseUrl:\s*'([^']+)'/)[1];
const anonKey = cfgSrc.match(/anonKey:\s*'([^']+)'/)[1];
globalThis.GAMES_CONFIG = { supabaseUrl, anonKey };

const bank = JSON.parse(readFileSync(`${DEPLOY}/data/party-mix.json`, 'utf8'));
const pairsDoc = JSON.parse(readFileSync(`${DEPLOY}/data/undercover-pairs.json`, 'utf8'));
GamesAPI._setBanks(bank, pairsDoc.pairs);

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

let roomId = null;
async function stateFor(playerId) {
  const { view } = await GamesAPI.getRoomState({ roomId, playerId });
  return view;
}
try {
  const mode = await GamesAPI.init();
  check('backend mode is supabase', mode === 'supabase', `(got ${mode})`);

  // 1. Host creates room (device 1)
  const { view: hostView, player: host } = await GamesAPI.createRoom({ hostName: 'Lucy', game: 'undercover', judgeMode: false });
  roomId = hostView.room.id;
  const code = hostView.room.code;
  check('room created with 4-letter PIN', /^[A-Z]{4}$/.test(code), `(got ${code})`);
  console.log(`  room ${roomId} PIN ${code}`);

  // 2. Three more devices join by PIN
  const joiners = [];
  for (const name of ['Momo', 'Kiki', 'Dudu']) {
    const { player } = await GamesAPI.joinRoom({ code, nickname: name });
    joiners.push(player);
  }
  check('3 joiners in', joiners.length === 3);

  // 3. Host starts the game — words dealt
  await GamesAPI.startGame({ roomId, playerId: host.id });
  const states = [];
  for (const p of [host, ...joiners]) {
    const v = await stateFor(p.id);
    states.push({ id: p.id, nick: p.nickname, word: v.state.myWord, wordEn: v.state.myWordEn, under: v.state.iAmUndercover, phase: v.state.phase });
  }
  check('phase is describe', states.every((s) => s.phase === 'describe'));
  const unders = states.filter((s) => s.under);
  check('exactly 1 undercover', unders.length === 1, JSON.stringify(states.map((s) => [s.nick, s.word, s.under])));
  const civWord = states.find((s) => !s.under).word;
  const undWord = unders[0].word;
  check('undercover word differs from civilian word', civWord !== undWord, `(${civWord} vs ${undWord})`);
  check('all civilians share one word', states.filter((s) => !s.under).every((s) => s.word === civWord));
  check('english word derived (no word_en column)', states.every((s) => typeof s.wordEn === 'string' && s.wordEn.length > 0), JSON.stringify(states.map((s) => s.wordEn)));
  // Secrecy: Lucy's view must not contain anyone else's word
  const lucyView = await stateFor(host.id);
  check('per-player view hides other words', lucyView.players.filter((p) => p.id !== host.id).every((p) => p.word === undefined));
  console.log(`  pair: civilians=${civWord} undercover=${undWord} (${unders[0].nick})`);

  // 4. Everyone describes (one-line clues)
  const clues = { Lucy: '热乎乎的', Momo: '冬天吃', Kiki: '大家围着吃', Dudu: '有点辣' };
  for (const p of [host, ...joiners]) {
    await GamesAPI.submitDescription({ roomId, playerId: p.id, text: clues[p.nickname] });
  }
  const afterClues = await stateFor(host.id);
  check('4 clues in', afterClues.state.cluesCount === 4, `(got ${afterClues.state.cluesCount})`);

  // 5. Host advances to vote; everyone votes the undercover
  await GamesAPI.advanceGame({ roomId, playerId: host.id });
  const voteView = await stateFor(host.id);
  check('phase is vote', voteView.state.phase === 'vote');
  for (const p of [host, ...joiners]) {
    // Civilians vote the undercover; the undercover bluffs a vote for Lucy.
    const target = p.id === unders[0].id ? host.id : unders[0].id;
    await GamesAPI.submitAnswer({ roomId, playerId: p.id, choice: target });
  }
  const afterVotes = await stateFor(host.id);
  check('4 votes in', afterVotes.state.votesCount === 4);

  // 6. Host advances: reveal — civilians win, +100 voters, +200 survivors
  await GamesAPI.advanceGame({ roomId, playerId: host.id });
  const reveal = await stateFor(host.id);
  check('winner side is civilians', reveal.state.winnerSide === 'civilians', `(got ${reveal.state.winnerSide})`);
  check('eliminated is the undercover', reveal.state.lastEliminated?.id === unders[0].id);
  const scores = Object.fromEntries(reveal.players.map((p) => [p.nickname, p.score]));
  check('each civilian scored 300 (+100 vote, +200 win)', states.filter((s) => !s.under).every((s) => scores[s.nick] === 300), JSON.stringify(scores));
  check('undercover scored 0', scores[unders[0].nick] === 0, JSON.stringify(scores));

  // 7. Host advances: finished
  await GamesAPI.advanceGame({ roomId, playerId: host.id });
  const fin = await stateFor(host.id);
  check('room finished', fin.room.status === 'finished');
  check('finished view reveals the pair', !!fin.state.pair);
  console.log(`  scores: ${JSON.stringify(scores)}`);
} catch (e) {
  fail++;
  console.log(`  ERROR ${e.message}\n${e.stack}`);
} finally {
  if (roomId) {
    const res = await fetch(`${supabaseUrl}/rest/v1/rooms?id=eq.${roomId}`, {
      method: 'DELETE',
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
    console.log(`  cleanup: DELETE room -> ${res.status}`);
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
