// games.js — pure game rules for Glomere Games (no DOM, no network).
// Used by the mock backend (api.js) and by the Supabase adapter path, so the
// rules live in exactly one place. All functions are deterministic given their
// inputs except the explicit rng() argument (defaults to Math.random).
//
// Scoring (verified against the artifact's behaviour, see README):
//  Party Mix — Would You Rather: +100 for voting with the majority side.
//    Most Likely To: +100 for voting for the most-voted player; that player
//    gets a +200 crown bonus. Trivia: +100 correct, +50 if answered within 10s.
//    Judge mode: the round's judge earns +100 when the round reaches reveal.
//  Truth/Wish/Lie — correct author (+200) + correct lie (+100) = +300 max;
//    the author earns +50 for every guesser they fool.
//  Undercover — +100 for voting the undercover; +200 to surviving civilians
//    when the undercover is caught; +300 to a winning undercover.
//    Judge mode: the judge earns +100 for setting the pair.
//  No Blushing — +200 for naming the roast's author; the author earns +50
//    for every guesser they fool.

export const GAMES = ['party', 'twl', 'undercover', 'roast'];
export const PARTY_ROUNDS = 8;
export const PARTY_SECONDS = 25;
export const BOT_NAMES = ['Momo 🐼', 'Kiki 🐰', 'Dudu 🐶', 'Lulu 🦄', 'BaoBao 🐸', 'Nana 🍓', 'Toto 🥑', 'Pipi 🍕'];

export function minPlayers(game, judgeMode) {
  if (game === 'undercover') return judgeMode ? 5 : 4;
  if (game === 'party') return 2;
  if (game === 'twl') return 2;
  if (game === 'roast') return 3;
  return 2;
}

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export function pick(arr, rng = Math.random) { return arr[Math.floor(rng() * arr.length)]; }

// --- Party Mix -------------------------------------------------------------
export function buildPartyRounds(bank, rng = Math.random) {
  const wyr = shuffle(bank.would_you_rather, rng).slice(0, 3).map((q) => ({ type: 'wyr', ...q }));
  const mlt = shuffle(bank.most_likely_to, rng).slice(0, 3).map((q) => ({ type: 'mlt', ...q }));
  const tr = shuffle(bank.trivia, rng).slice(0, 2).map((q) => ({ type: 'trivia', ...q }));
  return shuffle([...wyr, ...mlt, ...tr], rng);
}

// answers: { playerId: { choice, at } } — choice is an option index for
// wyr/trivia, a playerId for mlt. at = ms timestamp of the answer.
// Returns { deltas: { playerId: points }, detail: {...} }.
export function scorePartyRound(round, answers, players, roundStartedAt) {
  const deltas = {};
  const add = (id, n) => { if (id) deltas[id] = (deltas[id] || 0) + n; };
  const detail = {};
  const entries = Object.entries(answers);
  if (round.type === 'wyr') {
    const counts = [0, 0];
    for (const [, a] of entries) if (a.choice === 0 || a.choice === 1) counts[a.choice]++;
    const majority = counts[0] === counts[1] ? null : (counts[0] > counts[1] ? 0 : 1);
    detail.counts = counts; detail.majority = majority;
    if (majority !== null) for (const [pid, a] of entries) if (a.choice === majority) add(pid, 100);
  } else if (round.type === 'mlt') {
    const counts = {};
    for (const [, a] of entries) if (a.choice) counts[a.choice] = (counts[a.choice] || 0) + 1;
    let top = null, topN = 0;
    for (const [pid, n] of Object.entries(counts)) if (n > topN) { top = pid; topN = n; }
    detail.counts = counts; detail.mostVoted = top;
    if (top) {
      for (const [pid, a] of entries) if (a.choice === top) add(pid, 100);
      add(top, 200); // crown bonus for the most-voted player
    }
  } else if (round.type === 'trivia') {
    detail.correct = round.correct;
    for (const [pid, a] of entries) {
      if (a.choice === round.correct) {
        add(pid, 100);
        if (roundStartedAt && a.at && a.at - roundStartedAt <= 10000) add(pid, 50); // speed bonus
      }
    }
  }
  return { deltas, detail };
}

// Judge for a Party Mix round: rotates in join order, round 0 = first joined.
export function partyJudgeForRound(players, roundNo) {
  const ordered = players.slice().sort((a, b) => a.join_order - b.join_order);
  return ordered.length ? ordered[roundNo % ordered.length] : null;
}

// --- Truth / Wish / Lie ----------------------------------------------------
export function scoreTwlRound(trioAuthorId, guesses) {
  // guesses: { guesserId: { author, lie } }; lie = index into shuffled trio.
  // The shuffled trio order is stored on the round (round.shuffledKinds).
  const deltas = {};
  let fooled = 0;
  for (const [gid, g] of Object.entries(guesses)) {
    if (gid === trioAuthorId) continue;
    const authorOk = g.author === trioAuthorId;
    const lieOk = g.lieKind === 'lie';
    if (authorOk && lieOk) deltas[gid] = (deltas[gid] || 0) + 300;
    else { fooled++; }
  }
  if (fooled > 0) deltas[trioAuthorId] = (deltas[trioAuthorId] || 0) + fooled * 50;
  return { deltas, fooled };
}

// --- Undercover ------------------------------------------------------------
export function dealUndercover(players, pair, rng = Math.random) {
  // players: word-players only (judge excluded by caller). Returns assignments.
  const ids = shuffle(players.map((p) => p.id), rng);
  const undercoverId = ids[0];
  const blankId = players.length >= 6 ? ids[1] : null;
  return players.map((p) => ({
    id: p.id,
    word: p.id === undercoverId ? pair.zh_b : (p.id === blankId ? null : pair.zh_a),
    wordEn: p.id === undercoverId ? pair.en_b : (p.id === blankId ? null : pair.en_a),
    is_undercover: p.id === undercoverId,
    has_blank: p.id === blankId,
  }));
}

// votes: { voterId: targetId }. aliveIds: word-players still in the game.
// Returns { eliminatedId, counts, tied }.
export function tallyVotes(votes, aliveIds) {
  const counts = {};
  for (const target of Object.values(votes)) {
    if (aliveIds.includes(target)) counts[target] = (counts[target] || 0) + 1;
  }
  let top = null, topN = 0, tied = false;
  for (const [pid, n] of Object.entries(counts)) {
    if (n > topN) { top = pid; topN = n; tied = false; }
    else if (n === topN) { tied = true; }
  }
  return { eliminatedId: tied ? null : top, counts, tied };
}

// After an elimination, decide whether the game is over.
// aliveIds: word-players still alive AFTER removing eliminatedId.
export function undercoverOutcome(eliminatedPlayer, aliveIds) {
  if (eliminatedPlayer && eliminatedPlayer.is_undercover) return { winnerSide: 'civilians' };
  if (aliveIds.length <= 2) return { winnerSide: 'undercover' };
  return { winnerSide: null };
}

// --- No Blushing (roast) ---------------------------------------------------
export function scoreRoastRound(roastAuthorId, guesses) {
  // guesses: { guesserId: { author } }
  const deltas = {};
  let fooled = 0;
  for (const [gid, g] of Object.entries(guesses)) {
    if (gid === roastAuthorId) continue;
    if (g.author === roastAuthorId) deltas[gid] = (deltas[gid] || 0) + 200;
    else fooled++;
  }
  if (fooled > 0) deltas[roastAuthorId] = (deltas[roastAuthorId] || 0) + fooled * 50;
  return { deltas, fooled };
}

// --- Shared helpers --------------------------------------------------------
export function newPin(rng = Math.random) {
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  let pin = '';
  for (let i = 0; i < 4; i++) pin += letters[Math.floor(rng() * letters.length)];
  return pin;
}
export function uid() {
  return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
