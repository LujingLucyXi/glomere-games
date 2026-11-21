// tests/test-games.mjs — end-to-end tests for Glomere Games (mock backend).
// Run:  node tests/test-games.mjs        (from ~/workspace/glomere-games-deploy)
// No server, no Supabase: the mock backend runs on a localStorage shim.
// The raw mock store is read directly ONLY to learn hidden facts the UI
// would never show (e.g. who the undercover is) so guesses can be scripted.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- localStorage shim (in-memory) ---------------------------------------
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
globalThis.window = {};

const bank = JSON.parse(readFileSync(join(ROOT, 'data/party-mix.json'), 'utf8'));
const pairsDoc = JSON.parse(readFileSync(join(ROOT, 'data/undercover-pairs.json'), 'utf8'));

const { GamesAPI } = await import('../js/api.js');
const { tickBots } = await import('../js/bots.js');

GamesAPI._setBanks(bank, pairsDoc.pairs);
await GamesAPI.init({ forceMock: true });
if (GamesAPI.mode !== 'mock') throw new Error('expected mock mode, got ' + GamesAPI.mode);

// ---- helpers ---------------------------------------------------------------
let passed = 0, failed = 0;
function ok(cond, label, extra = '') {
  if (cond) { passed++; console.log(`  PASS ${label}`); }
  else { failed++; console.log(`  FAIL ${label} ${extra}`); }
}
async function throws(fn, label) {
  try { await fn(); ok(false, label, '(no error thrown)'); }
  catch (e) { ok(true, `${label} (got: ${e.message})`); }
}
function rawRoom(roomId) {
  const store = JSON.parse(mem.get('glomere-games-mock-v1'));
  return store.rooms[roomId];
}
function scoreOf(view, nickname) { return view.players.find((p) => p.nickname === nickname)?.score; }
async function stateAs(roomId, playerId) {
  return (await GamesAPI.getRoomState({ roomId, playerId })).view;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// answer a party round for a player: correct for trivia, 0 for wyr, first other for mlt
async function answerParty(view, playerId, correctTrivia = true) {
  const st = view.state;
  const round = st.round;
  let choice;
  if (round.type === 'mlt') choice = view.players.find((p) => p.id !== playerId).id;
  else if (round.type === 'trivia') choice = correctTrivia ? round.correct : (round.correct + 1) % 4;
  else choice = 0;
  await GamesAPI.submitAnswer({ roomId: view.room.id, playerId, roundNo: view.room.current_round, choice });
}

// ---- 1. Party Mix: full 8-round game --------------------------------------
console.log('\n1. Party Mix — full game (host + guest + 3 bots)');
{
  const { view, player: host } = await GamesAPI.createRoom({ hostName: 'Lucy', game: 'party', judgeMode: false });
  const roomId = view.room.id;
  const { player: sam } = await GamesAPI.joinRoom({ code: view.room.code, nickname: 'Sam' });
  await GamesAPI.addBots({ roomId, playerId: host.id, count: 3 });
  let v = (await GamesAPI.startGame({ roomId, playerId: host.id })).view;
  ok(v.room.status === 'playing' && v.state.phase === 'question', 'starts into question phase');
  ok(v.state.round && v.state.totalRounds === 8, '8 rounds built');
  const counts = { wyr: 0, mlt: 0, trivia: 0 };
  for (const r of rawRoom(roomId).state.rounds) counts[r.type]++;
  ok(counts.wyr === 3 && counts.mlt === 3 && counts.trivia === 2, `round mix is 3+3+2 (got ${JSON.stringify(counts)})`);
  let triviaChecked = false;
  for (let round = 0; round < 8; round++) {
    v = await stateAs(roomId, host.id);
    const isTrivia = v.state.round.type === 'trivia';
    const before = scoreOf(v, 'Lucy');
    for (const p of v.players) await answerParty(v, p.id, true);
    v = await stateAs(roomId, host.id);
    ok(v.state.answersCount === v.state.answersTotal, `round ${round + 1}: all ${v.state.answersTotal} answered`);
    v = (await GamesAPI.advanceGame({ roomId, playerId: host.id, action: 'next' })).view;
    ok(v.state.phase === 'reveal', `round ${round + 1}: reveal after advance`);
    if (isTrivia && !triviaChecked) {
      triviaChecked = true;
      ok(scoreOf(v, 'Lucy') - before === 150, `trivia correct + fast = +150 (got +${scoreOf(v, 'Lucy') - before})`);
    }
    v = (await GamesAPI.advanceGame({ roomId, playerId: host.id, action: 'next' })).view;
    if (round < 7) ok(v.state.phase === 'question' && v.room.current_round === round + 1, `round ${round + 2}: next question`);
    else ok(v.room.status === 'finished', 'after round 8: finished');
  }
  ok(scoreOf(v, 'Lucy') > 0, 'host scored points over the game');
  v = (await GamesAPI.advanceGame({ roomId, playerId: host.id, action: 'playAgain' })).view;
  ok(v.room.status === 'lobby' && v.players.every((p) => p.score === 0), 'play again: clean lobby, scores 0');
}

// ---- 2. Party Mix judge mode: rotation + judge question --------------------
console.log('\n2. Party Mix — judge mode rotates, judge writes question');
{
  const { view, player: host } = await GamesAPI.createRoom({ hostName: 'Lucy', game: 'party', judgeMode: true });
  const roomId = view.room.id;
  const { player: sam } = await GamesAPI.joinRoom({ code: view.room.code, nickname: 'Sam' });
  await GamesAPI.addBots({ roomId, playerId: host.id, count: 1 });
  let v = (await GamesAPI.startGame({ roomId, playerId: host.id })).view;
  ok(v.state.phase === 'judge_writing' && v.state.judgeId === host.id, 'round 1 judge is the host');
  await throws(() => GamesAPI.submitAnswer({ roomId, playerId: host.id, roundNo: 0, choice: 0 }), 'judge cannot answer own round');
  v = (await GamesAPI.submitJudgeQuestion({ roomId, playerId: host.id, question: { type: 'wyr', text: '爬山还是冲浪？', options: ['爬山', '冲浪'] } })).view;
  ok(v.state.phase === 'question', 'judge question opens the round');
  for (const p of v.players.filter((p) => p.id !== host.id)) await answerParty(v, p.id);
  const judgeBefore = scoreOf(v, 'Lucy');
  v = (await GamesAPI.advanceGame({ roomId, playerId: host.id, action: 'next' })).view;
  ok(scoreOf(v, 'Lucy') - judgeBefore === 100, 'judge earns +100 for running the round');
  v = (await GamesAPI.advanceGame({ roomId, playerId: host.id, action: 'next' })).view;
  ok(v.state.phase === 'judge_writing' && v.state.judgeId === sam.id, 'round 2 judge rotated to next in join order');
}

// ---- 3. Bot driver: host tab drives bot answers ---------------------------
console.log('\n3. Bots — host-client driver acts for bots');
{
  const { view, player: host } = await GamesAPI.createRoom({ hostName: 'Lucy', game: 'party', judgeMode: false });
  const roomId = view.room.id;
  await GamesAPI.addBots({ roomId, playerId: host.id, count: 1 });
  let v = (await GamesAPI.startGame({ roomId, playerId: host.id })).view;
  const bot = v.players.find((p) => p.is_bot);
  await tickBots(v);
  v = await stateAs(roomId, host.id);
  const botView = await stateAs(roomId, bot.id);
  ok(botView.state.myAnswer != null, 'bot answered after one driver tick');
}

// ---- 4. Truth / Wish / Lie: trios, guessing, scoring ----------------------
console.log('\n4. Truth/Wish/Lie — trios, +300 correct guess, +50 fooled');
{
  const { view, player: host } = await GamesAPI.createRoom({ hostName: 'Lucy', game: 'twl', judgeMode: false });
  const roomId = view.room.id;
  const { player: sam } = await GamesAPI.joinRoom({ code: view.room.code, nickname: 'Sam' });
  await GamesAPI.addBots({ roomId, playerId: host.id, count: 1 });
  let v = (await GamesAPI.startGame({ roomId, playerId: host.id })).view;
  ok(v.state.phase === 'writing', 'starts in writing phase');
  await GamesAPI.submitStatements({ roomId, playerId: host.id, truth: '我会做红烧肉', wish: '想去冰岛', lie: '我会五种语言' });
  await GamesAPI.submitStatements({ roomId, playerId: sam.id, truth: '我跑过半马', wish: '想开咖啡馆', lie: '我见过外星人' });
  const bot = v.players.find((p) => p.is_bot);
  await GamesAPI.submitStatements({ roomId, playerId: bot.id, truth: 'bot真话', wish: 'bot愿望', lie: 'bot谎言' });
  v = await stateAs(roomId, host.id);
  ok(v.state.triosIn === 3, 'trios in counter 3/3');
  v = (await GamesAPI.advanceGame({ roomId, playerId: host.id, action: 'next' })).view;
  ok(v.state.phase === 'guessing' && v.state.currentTrio, 'guessing opens with a shuffled trio');
  const raw = rawRoom(roomId);
  const authorId = raw.state.guessOrder[0];
  const author = raw.players.find((p) => p.id === authorId);
  const lieIdx = raw.state.currentTrio.cards.findIndex((c) => c.kind === 'lie');
  // Author view must NOT reveal authorship; non-author views must hide kinds.
  const authorView = await stateAs(roomId, authorId);
  ok(authorView.state.amAuthor === true, 'author sees sit-out flag (amAuthor)');
  const otherView = await stateAs(roomId, raw.players.find((p) => p.id !== authorId).id);
  ok(otherView.state.currentTrio.authorId === null && otherView.state.currentTrio.cards.every((c) => c.kind === null), 'others see no author and no kinds');
  // One guesser nails author + lie (+300); the other guesses wrong (author +50).
  const guessers = raw.players.filter((p) => p.id !== authorId);
  await GamesAPI.submitAnswer({ roomId, playerId: guessers[0].id, roundNo: 0, choice: { author: authorId, lie: lieIdx } });
  const wrongLie = (lieIdx + 1) % 3;
  await GamesAPI.submitAnswer({ roomId, playerId: guessers[1].id, roundNo: 0, choice: { author: guessers[0].id, lie: wrongLie } });
  await throws(() => GamesAPI.submitAnswer({ roomId, playerId: authorId, roundNo: 0, choice: { author: authorId, lie: 0 } }), 'author cannot guess own trio');
  const beforeGood = scoreOf(await stateAs(roomId, guessers[0].id), guessers[0].nickname);
  const beforeAuthor = scoreOf(await stateAs(roomId, authorId), author.nickname);
  v = (await GamesAPI.advanceGame({ roomId, playerId: host.id, action: 'next' })).view;
  ok(v.state.phase === 'reveal' && v.state.roundDetail.cards.every((c) => c.kind), 'reveal labels truth/wish/lie');
  ok(scoreOf(v, guessers[0].nickname) - beforeGood === 300, 'correct author + lie = +300');
  ok(scoreOf(v, author.nickname) - beforeAuthor === 50, 'author +50 for the one fooled guesser');
  // Play out remaining trios, then finished + play again.
  for (let i = 1; i < 3; i++) {
    v = (await GamesAPI.advanceGame({ roomId, playerId: host.id, action: 'next' })).view;
    const r2 = rawRoom(roomId);
    const a2 = r2.state.guessOrder[r2.current_round];
    const lie2 = r2.state.currentTrio.cards.findIndex((c) => c.kind === 'lie');
    for (const p of r2.players.filter((p) => p.id !== a2)) {
      await GamesAPI.submitAnswer({ roomId, playerId: p.id, roundNo: r2.current_round, choice: { author: a2, lie: lie2 } });
    }
    v = (await GamesAPI.advanceGame({ roomId, playerId: host.id, action: 'next' })).view;
  }
  v = (await GamesAPI.advanceGame({ roomId, playerId: host.id, action: 'next' })).view;
  ok(v.room.status === 'finished', 'all trios guessed: finished');
  v = (await GamesAPI.advanceGame({ roomId, playerId: host.id, action: 'playAgain' })).view;
  ok(v.room.status === 'lobby' && v.state.triosIn === 0, 'play again clears trios');
}

// ---- 5. Undercover: deal secrecy, vote out undercover, civilian win --------
console.log('\n5. Undercover — secret words, vote out undercover, civilians win');
{
  const { view, player: host } = await GamesAPI.createRoom({ hostName: 'Lucy', game: 'undercover', judgeMode: false });
  const roomId = view.room.id;
  const { player: sam } = await GamesAPI.joinRoom({ code: view.room.code, nickname: 'Sam' });
  await GamesAPI.addBots({ roomId, playerId: host.id, count: 3 });
  const small = await GamesAPI.createRoom({ hostName: 'Solo', game: 'undercover', judgeMode: false });
  await throws(() => GamesAPI.startGame({ roomId: small.view.room.id, playerId: small.player.id }), 'undercover refuses <4 players');
  let v = (await GamesAPI.startGame({ roomId, playerId: host.id })).view;
  ok(v.state.phase === 'describe', 'starts in describe phase');
  const raw = rawRoom(roomId);
  const under = raw.players.find((p) => p.is_undercover);
  const aCivilian = raw.players.find((p) => !p.is_undercover);
  ok(under && raw.players.filter((p) => p.word).length === raw.players.length, `one undercover dealt, all ${raw.players.length} have words (no blank under 6)`);
  // Secrecy: each player sees only their own word.
  for (const p of raw.players) {
    const pv = await stateAs(roomId, p.id);
    const seen = pv.players.filter((x) => x.word !== undefined && x.word !== null);
    ok(seen.length === 1 && seen[0].id === p.id, `${p.nickname} sees only their own word`);
  }
  for (const p of raw.players) await GamesAPI.submitDescription({ roomId, playerId: p.id, text: '我的提示' });
  v = await stateAs(roomId, host.id);
  ok(v.state.cluesCount === raw.players.length, `all ${raw.players.length} clues in`);
  v = (await GamesAPI.advanceGame({ roomId, playerId: host.id, action: 'next' })).view;
  ok(v.state.phase === 'vote', 'describe -> vote');
  for (const p of raw.players) await GamesAPI.submitAnswer({ roomId, playerId: p.id, roundNo: 1, choice: under.id });
  v = (await GamesAPI.advanceGame({ roomId, playerId: host.id, action: 'next' })).view;
  ok(v.state.phase === 'reveal' && v.state.winnerSide === 'civilians', 'undercover voted out: civilians win');
  ok(v.state.lastEliminated.role === 'undercover', 'reveal names the eliminated role');
  const civScore = scoreOf(v, aCivilian.nickname);
  ok(civScore === 300, `civilian voter ${aCivilian.nickname} +100 vote +200 survival = 300 (got ${civScore})`);
  v = (await GamesAPI.advanceGame({ roomId, playerId: host.id, action: 'next' })).view;
  ok(v.room.status === 'finished' && v.state.pair, 'finished: word pair revealed to all');
  v = (await GamesAPI.advanceGame({ roomId, playerId: host.id, action: 'playAgain' })).view;
  ok(v.room.status === 'lobby' && v.players.every((p) => !p.word && p.score === 0), 'play again clears words and scores');
}

// ---- 6. Undercover: wrong vote continues; undercover wins at 2 left -------
console.log('\n6. Undercover — wrong vote continues, undercover wins at 2 left');
{
  const { view, player: host } = await GamesAPI.createRoom({ hostName: 'Lucy', game: 'undercover', judgeMode: false });
  const roomId = view.room.id;
  await GamesAPI.addBots({ roomId, playerId: host.id, count: 3 });
  let v = (await GamesAPI.startGame({ roomId, playerId: host.id })).view;
  const raw = rawRoom(roomId);
  const under = raw.players.find((p) => p.is_undercover);
  const civilian = raw.players.find((p) => !p.is_undercover);
  for (const p of raw.players) await GamesAPI.submitDescription({ roomId, playerId: p.id, text: '提示' });
  await GamesAPI.advanceGame({ roomId, playerId: host.id, action: 'next' });
  for (const p of raw.players) await GamesAPI.submitAnswer({ roomId, playerId: p.id, roundNo: 1, choice: civilian.id });
  v = (await GamesAPI.advanceGame({ roomId, playerId: host.id, action: 'next' })).view;
  ok(v.state.phase === 'reveal' && v.state.winnerSide === null && v.state.lastEliminated.role === 'civilian', 'civilian voted out: game continues');
  v = (await GamesAPI.advanceGame({ roomId, playerId: host.id, action: 'next' })).view;
  ok(v.state.phase === 'describe' && v.state.roundNo === 2, 'round 2 describe');
  const alive = rawRoom(roomId).players.filter((p) => p.alive);
  for (const p of alive) await GamesAPI.submitDescription({ roomId, playerId: p.id, text: '提示2' });
  await GamesAPI.advanceGame({ roomId, playerId: host.id, action: 'next' });
  const civilian2 = alive.find((p) => !p.is_undercover);
  for (const p of alive) await GamesAPI.submitAnswer({ roomId, playerId: p.id, roundNo: 2, choice: civilian2.id });
  v = (await GamesAPI.advanceGame({ roomId, playerId: host.id, action: 'next' })).view;
  ok(v.state.winnerSide === 'undercover', '2 players left: undercover wins');
  ok(scoreOf(v, under.nickname) >= 300, 'winning undercover gets +300');
}

// ---- 7. Undercover judge mode ----------------------------------------------
console.log('\n7. Undercover — judge mode (5 players, judge writes pair, +100)');
{
  const { view, player: host } = await GamesAPI.createRoom({ hostName: 'Lucy', game: 'undercover', judgeMode: true });
  const roomId = view.room.id;
  await GamesAPI.addBots({ roomId, playerId: host.id, count: 3 });
  await throws(() => GamesAPI.startGame({ roomId, playerId: host.id }), 'judge mode refuses 4 players (needs 5)');
  const { player: sam } = await GamesAPI.joinRoom({ code: view.room.code, nickname: 'Sam' });
  let v = (await GamesAPI.startGame({ roomId, playerId: host.id })).view;
  ok(v.state.phase === 'judge_words', 'judge mode starts at word-writing');
  await throws(() => GamesAPI.submitJudgeWords({ roomId, playerId: sam.id, wordA: '咖啡', wordB: '茶' }), 'only the host-judge writes the pair');
  v = (await GamesAPI.submitJudgeWords({ roomId, playerId: host.id, wordA: '珍珠奶茶', wordB: '柠檬茶' })).view;
  ok(v.state.phase === 'describe', 'pair dealt: describe opens');
  ok(scoreOf(v, 'Lucy') === 100, 'judge +100 for setting the pair');
  const raw = rawRoom(roomId);
  ok(raw.players.find((p) => p.id === host.id).word === null, 'judge holds no word');
  const jv = await stateAs(roomId, host.id);
  ok(jv.state.judgeView && jv.state.judgeView.pair.zh_a === '珍珠奶茶', 'judge sees the pair and the undercover');
  const wordPlayers = raw.players.filter((p) => !p.is_judge);
  for (const p of wordPlayers) await GamesAPI.submitDescription({ roomId, playerId: p.id, text: '好喝的' });
  await GamesAPI.advanceGame({ roomId, playerId: host.id, action: 'next' });
  const under = raw.players.find((p) => p.is_undercover);
  for (const p of wordPlayers) await GamesAPI.submitAnswer({ roomId, playerId: p.id, roundNo: 1, choice: under.id });
  await throws(() => GamesAPI.submitAnswer({ roomId, playerId: host.id, roundNo: 1, choice: under.id }), 'judge cannot vote');
  v = (await GamesAPI.advanceGame({ roomId, playerId: host.id, action: 'next' })).view;
  ok(v.state.winnerSide === 'civilians', 'judge-mode game: civilians win when undercover is caught');
}

// ---- 8. Roast: write, guess, +200 / +50 scoring ----------------------------
console.log('\n8. No Blushing — anonymous roasts, guess the author');
{
  const { view, player: host } = await GamesAPI.createRoom({ hostName: 'Lucy', game: 'roast', judgeMode: false });
  const roomId = view.room.id;
  const { player: sam } = await GamesAPI.joinRoom({ code: view.room.code, nickname: 'Sam' });
  await GamesAPI.addBots({ roomId, playerId: host.id, count: 1 });
  let v = (await GamesAPI.startGame({ roomId, playerId: host.id })).view;
  ok(v.state.phase === 'writing', 'starts in writing phase');
  const players = v.players;
  for (const p of players) {
    const roasts = players.filter((x) => x.id !== p.id).map((x) => ({ targetId: x.id, text: `吐槽${x.nickname}一句` }));
    await GamesAPI.submitRoasts({ roomId, playerId: p.id, roasts });
  }
  v = await stateAs(roomId, host.id);
  ok(v.state.roastsIn === 3, 'all 3 roast sets in');
  v = (await GamesAPI.advanceGame({ roomId, playerId: host.id, action: 'next' })).view;
  ok(v.state.phase === 'guessing' && v.state.totalRoasts === 6, '6 roasts queued (3 players x 2 targets)');
  const raw = rawRoom(roomId);
  const roast0 = raw.state.roasts[0];
  const author = raw.players.find((p) => p.id === roast0.authorId);
  const hostView = await stateAs(roomId, host.id);
  ok(hostView.state.currentRoast.authorId === null, 'author hidden before reveal');
  const guessers = raw.players.filter((p) => p.id !== roast0.authorId);
  await GamesAPI.submitAnswer({ roomId, playerId: guessers[0].id, roundNo: 0, choice: roast0.authorId });
  await GamesAPI.submitAnswer({ roomId, playerId: guessers[1].id, roundNo: 0, choice: guessers[0].id });
  await throws(() => GamesAPI.submitAnswer({ roomId, playerId: roast0.authorId, roundNo: 0, choice: guessers[0].id }), 'author cannot guess own roast');
  const beforeGood = scoreOf(await stateAs(roomId, guessers[0].id), guessers[0].nickname);
  const beforeAuthor = scoreOf(await stateAs(roomId, author.id), author.nickname);
  v = (await GamesAPI.advanceGame({ roomId, playerId: host.id, action: 'next' })).view;
  ok(v.state.phase === 'reveal' && v.state.roundDetail.roast.authorId === roast0.authorId, 'reveal names the author');
  ok(scoreOf(v, guessers[0].nickname) - beforeGood === 200, 'correct author guess = +200');
  ok(scoreOf(v, author.nickname) - beforeAuthor === 50, 'author +50 for the one fooled guesser');
  // Play out the remaining 5 roasts (everyone guesses the right author).
  for (let i = 1; i < 6; i++) {
    v = (await GamesAPI.advanceGame({ roomId, playerId: host.id, action: 'next' })).view;
    const r = rawRoom(roomId);
    const cur = r.state.roasts[r.state.currentRoastIdx];
    for (const p of r.players.filter((p) => p.id !== cur.authorId)) {
      await GamesAPI.submitAnswer({ roomId, playerId: p.id, roundNo: r.state.currentRoastIdx, choice: cur.authorId });
    }
    v = (await GamesAPI.advanceGame({ roomId, playerId: host.id, action: 'next' })).view;
  }
  v = (await GamesAPI.advanceGame({ roomId, playerId: host.id, action: 'next' })).view;
  ok(v.room.status === 'finished', 'all roasts read: finished');
  v = (await GamesAPI.advanceGame({ roomId, playerId: host.id, action: 'playAgain' })).view;
  ok(v.room.status === 'lobby' && v.players.every((p) => p.score === 0), 'play again resets cleanly');
}

// ---- summary ----------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
