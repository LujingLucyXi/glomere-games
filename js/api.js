// api.js — GamesAPI: the 14-action API contract for Glomere Games.
//
// The action names mirror the Muse artifact's published server actions:
//   createRoom, joinRoom, leaveRoom, addBots, removeBot, startGame,
//   advanceGame, getRoomState, submitAnswer, submitDescription,
//   submitJudgeWords, submitJudgeQuestion, submitStatements, submitRoasts
//
// Two backends, one rule engine:
//  - Mock backend (default): in-memory + localStorage, single device. The UI
//    is fully testable with no Supabase project. Rooms persist in localStorage
//    so two tabs on the same machine can play together.
//  - Supabase backend (when window.GAMES_CONFIG has supabaseUrl + anonKey):
//    PostgREST reads/writes against rooms / players / submissions. The game
//    rules still run in the browser (see README "Supabase mode" limits:
//    last-write-wins on rooms.state; secrets are hidden by the UI, not by
//    the database — a v2 edge function should enforce per-player views).
//
// Usage (browser):
//   <script src="config.js"></script>          <!-- optional -->
//   <script type="module">
//     import { GamesAPI } from './js/api.js';
//     await GamesAPI.init();                    // loads banks, picks backend
//     const { room, player } = await GamesAPI.createRoom({ hostName: 'Lucy', game: 'party', judgeMode: false });
//     const view = await GamesAPI.getRoomState({ roomId: room.id, playerId: player.id });
//   </script>

import {
  BOT_NAMES, PARTY_ROUNDS, PARTY_SECONDS, buildPartyRounds, dealUndercover,
  minPlayers, newPin, partyJudgeForRound, scorePartyRound, scoreRoastRound,
  scoreTwlRound, shuffle, tallyVotes, uid, undercoverOutcome,
} from './games.js';

const LS_KEY = 'glomere-games-mock-v1';
const POLL_MS = 1000;

function lsGet() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return JSON.parse(localStorage.getItem(LS_KEY) || 'null');
  } catch (_) { return null; }
}
function lsSet(v) {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch (_) {}
}
function nowIso() { return new Date().toISOString(); }
function err(msg) { throw new Error(msg); }

// ---------------------------------------------------------------------------
// Rule engine: pure operations over a store { rooms: { [id]: record } }.
// A record mirrors the Supabase tables: room fields + players[] + submissions[].
// Every op returns { view, record } where view is the per-player filtered state.
// ---------------------------------------------------------------------------

function getRoom(store, roomId) {
  const r = store.rooms[roomId];
  if (!r) err('room not found');
  return r;
}
function getPlayer(room, playerId) {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) err('player not in room');
  return p;
}
function requireHost(room, playerId) {
  if (room.host_player_id !== playerId) err('only the host can do this');
}
function aliveWordPlayers(room) {
  return room.players.filter((p) => p.alive && !p.is_judge);
}
function addSubmission(room, playerId, roundNo, kind, payload) {
  const row = { id: uid(), room_id: room.id, player_id: playerId, round_no: roundNo, kind, payload, created_at: nowIso() };
  room.submissions.push(row);
  return row;
}
function touch(room) { room.updated_at = nowIso(); }

function freshState(game) {
  if (game === 'party') return { phase: 'question', rounds: [], answers: {}, roundStartedAt: null, roundDetail: null, roundDeltas: null };
  if (game === 'twl') return { phase: 'writing', trios: {}, guessOrder: [], guesses: {}, currentTrio: null, roundDetail: null };
  if (game === 'undercover') return { phase: 'describe', pair: null, clues: {}, votes: {}, eliminated: [], roundNo: 1, winnerSide: null, lastEliminated: null, voteDetail: null, judgeView: null };
  return { phase: 'writing', roastSets: {}, roasts: [], guesses: {}, currentRoastIdx: 0, roundDetail: null };
}

function resetRoomForLobby(room) {
  room.status = 'lobby';
  room.current_round = 0;
  room.state = freshState(room.game);
  room.submissions = [];
  for (const p of room.players) {
    p.score = 0; p.word = null; p.word_en = null;
    p.is_undercover = false; p.has_blank = false; p.alive = true; p.is_judge = false;
  }
  touch(room);
}

function applyDeltas(room, deltas) {
  for (const [pid, n] of Object.entries(deltas || {})) {
    const p = room.players.find((x) => x.id === pid);
    if (p) p.score += n;
  }
}

const Ops = {
  createRoom(store, ctx, { hostName, game, judgeMode }) {
    if (!hostName || !hostName.trim()) err('nickname required');
    if (!['party', 'twl', 'undercover', 'roast'].includes(game)) err('unknown game');
    let code = newPin();
    while (Object.values(store.rooms).some((r) => r.code === code)) code = newPin();
    const roomId = uid();
    const hostId = uid();
    const room = {
      id: roomId, code, game, status: 'lobby', judge_mode: !!judgeMode,
      host_player_id: hostId, current_round: 0, state: freshState(game),
      created_at: nowIso(), updated_at: nowIso(),
      players: [{ id: hostId, room_id: roomId, nickname: hostName.trim(), is_host: true, is_bot: false, lang: 'zh', score: 0, word: null, word_en: null, is_undercover: false, has_blank: false, join_order: 0, alive: true, is_judge: false }],
      submissions: [],
    };
    store.rooms[roomId] = room;
    return { view: buildView(room, hostId), record: room, player: room.players[0] };
  },

  joinRoom(store, ctx, { code, nickname }) {
    if (!nickname || !nickname.trim()) err('nickname required');
    const room = Object.values(store.rooms).find((r) => r.code === String(code || '').toUpperCase());
    if (!room) err('no room with that PIN');
    const p = { id: uid(), room_id: room.id, nickname: nickname.trim(), is_host: false, is_bot: false, lang: 'zh', score: 0, word: null, word_en: null, is_undercover: false, has_blank: false, join_order: room.players.length, alive: true, is_judge: false };
    room.players.push(p);
    touch(room);
    return { view: buildView(room, p.id), record: room, player: p };
  },

  leaveRoom(store, ctx, { roomId, playerId }) {
    const room = getRoom(store, roomId);
    room.players = room.players.filter((p) => p.id !== playerId);
    if (room.players.length === 0) { delete store.rooms[roomId]; return { view: null, record: null, left: true }; }
    if (room.host_player_id === playerId) {
      const next = room.players.slice().sort((a, b) => a.join_order - b.join_order)[0];
      room.host_player_id = next.id;
      next.is_host = true;
    }
    touch(room);
    return { view: buildView(room, room.host_player_id), record: room, left: true };
  },

  addBots(store, ctx, { roomId, playerId, count }) {
    const room = getRoom(store, roomId);
    requireHost(room, playerId);
    if (room.status !== 'lobby') err('bots can only be added in the lobby');
    const n = count === 1 ? 1 : 3;
    const used = new Set(room.players.map((p) => p.nickname));
    const added = [];
    for (const name of BOT_NAMES) {
      if (added.length >= n) break;
      if (used.has(name)) continue;
      const b = { id: uid(), room_id: room.id, nickname: name, is_host: false, is_bot: true, lang: 'zh', score: 0, word: null, word_en: null, is_undercover: false, has_blank: false, join_order: room.players.length, alive: true, is_judge: false };
      room.players.push(b); added.push(b);
    }
    touch(room);
    return { view: buildView(room, playerId), record: room, added };
  },

  removeBot(store, ctx, { roomId, playerId, botId }) {
    const room = getRoom(store, roomId);
    requireHost(room, playerId);
    const bot = room.players.find((p) => p.id === botId);
    if (!bot || !bot.is_bot) err('not a bot');
    room.players = room.players.filter((p) => p.id !== botId);
    touch(room);
    return { view: buildView(room, playerId), record: room };
  },

  startGame(store, ctx, { roomId, playerId }) {
    const room = getRoom(store, roomId);
    requireHost(room, playerId);
    if (room.status !== 'lobby') err('game already started');
    const need = minPlayers(room.game, room.judge_mode);
    if (room.players.length < need) err(`needs at least ${need} players`);
    room.status = 'playing';
    room.current_round = 0;
    room.state = freshState(room.game);
    if (room.game === 'party') {
      if (room.judge_mode) { room.state.phase = 'judge_writing'; }
      else {
        room.state.rounds = buildPartyRounds(ctx.bank);
        room.state.phase = 'question';
        room.state.roundStartedAt = Date.now();
      }
    } else if (room.game === 'undercover') {
      if (room.judge_mode) {
        const judge = room.players.find((p) => p.id === room.host_player_id);
        judge.is_judge = true;
        room.state.phase = 'judge_words';
      } else {
        const pair = ctx.pairs[Math.floor(Math.random() * ctx.pairs.length)];
        room.state.pair = pair;
        for (const a of dealUndercover(room.players, pair)) {
          const p = room.players.find((x) => x.id === a.id);
          p.word = a.word; p.word_en = a.wordEn; p.is_undercover = a.is_undercover; p.has_blank = a.has_blank;
        }
        room.state.phase = 'describe';
      }
    }
    touch(room);
    return { view: buildView(room, playerId), record: room };
  },

  advanceGame(store, ctx, { roomId, playerId, action }) {
    const room = getRoom(store, roomId);
    requireHost(room, playerId);
    const st = room.state;
    if (action === 'playAgain') {
      if (room.status !== 'finished') err('play again is only available when finished');
      resetRoomForLobby(room);
      return { view: buildView(room, playerId), record: room };
    }
    if (room.status !== 'playing') err('game is not playing');
    const game = room.game;

    if (game === 'party') {
      if (st.phase === 'judge_writing') err('waiting for the judge to write a question');
      if (st.phase === 'question') {
        const round = st.rounds[room.current_round];
        const { deltas, detail } = scorePartyRound(round, st.answers, room.players, st.roundStartedAt);
        if (room.judge_mode) {
          const judge = partyJudgeForRound(room.players, room.current_round);
          if (judge && Object.keys(st.answers).length > 0) deltas[judge.id] = (deltas[judge.id] || 0) + 100;
        }
        applyDeltas(room, deltas);
        st.roundDeltas = deltas; st.roundDetail = detail; st.phase = 'reveal';
      } else if (st.phase === 'reveal') {
        if (room.current_round >= PARTY_ROUNDS - 1) { room.status = 'finished'; st.phase = 'done'; }
        else {
          room.current_round += 1;
          st.answers = {}; st.roundDetail = null; st.roundDeltas = null;
          if (room.judge_mode) { st.phase = 'judge_writing'; st.roundStartedAt = null; }
          else { st.phase = 'question'; st.roundStartedAt = Date.now(); }
        }
      } else err('cannot advance from here');
    } else if (game === 'twl') {
      if (st.phase === 'writing') {
        const submitted = Object.keys(st.trios).filter((pid) => room.players.some((p) => p.id === pid));
        if (submitted.length < room.players.length) err('not all trios are in yet');
        st.guessOrder = shuffle(room.players.map((p) => p.id));
        room.current_round = 0;
        st.phase = 'guessing';
        st.currentTrio = makeTrio(st, st.guessOrder[0]);
        st.guesses = {};
      } else if (st.phase === 'guessing') {
        const authorId = st.guessOrder[room.current_round];
        const { deltas, fooled } = scoreTwlRound(authorId, st.guesses);
        applyDeltas(room, deltas);
        st.roundDetail = { authorId, cards: st.currentTrio.cards, guesses: { ...st.guesses }, fooled };
        st.phase = 'reveal';
      } else if (st.phase === 'reveal') {
        if (room.current_round >= st.guessOrder.length - 1) { room.status = 'finished'; st.phase = 'done'; }
        else {
          room.current_round += 1;
          st.phase = 'guessing';
          st.currentTrio = makeTrio(st, st.guessOrder[room.current_round]);
          st.guesses = {}; st.roundDetail = null;
        }
      } else err('cannot advance from here');
    } else if (game === 'undercover') {
      if (st.phase === 'judge_words') err('waiting for the judge to write the word pair');
      if (st.phase === 'describe') { st.phase = 'vote'; st.votes = {}; }
      else if (st.phase === 'vote') {
        const alive = aliveWordPlayers(room).map((p) => p.id);
        const { eliminatedId, counts, tied } = tallyVotes(st.votes, alive);
        st.voteDetail = { counts, tied };
        if (tied || !eliminatedId) {
          // No elimination: back to describing, next round.
          st.phase = 'describe'; st.roundNo += 1; st.clues = {}; st.votes = {};
          st.lastEliminated = null;
        } else {
          const elim = room.players.find((p) => p.id === eliminatedId);
          elim.alive = false;
          st.eliminated.push(eliminatedId);
          // +100 to everyone who voted the undercover.
          const deltas = {};
          for (const [voter, target] of Object.entries(st.votes)) {
            const t = room.players.find((p) => p.id === target);
            if (t && t.is_undercover) deltas[voter] = (deltas[voter] || 0) + 100;
          }
          const stillAlive = aliveWordPlayers(room).map((p) => p.id);
          const outcome = undercoverOutcome(elim, stillAlive);
          st.winnerSide = outcome.winnerSide;
          if (outcome.winnerSide === 'civilians') {
            for (const p of aliveWordPlayers(room)) deltas[p.id] = (deltas[p.id] || 0) + 200;
          } else if (outcome.winnerSide === 'undercover') {
            const u = room.players.find((p) => p.is_undercover);
            if (u) deltas[u.id] = (deltas[u.id] || 0) + 300;
          }
          applyDeltas(room, deltas);
          st.roundDeltas = deltas;
          st.lastEliminated = { id: elim.id, role: elim.is_undercover ? 'undercover' : (elim.has_blank ? 'blank' : 'civilian'), word: elim.word, wordEn: elim.word_en };
          st.phase = 'reveal';
        }
      } else if (st.phase === 'reveal') {
        if (st.winnerSide) { room.status = 'finished'; st.phase = 'done'; }
        else { st.phase = 'describe'; st.roundNo += 1; st.clues = {}; st.votes = {}; st.lastEliminated = null; st.voteDetail = null; }
      } else err('cannot advance from here');
    } else if (game === 'roast') {
      if (st.phase === 'writing') {
        const submitted = Object.keys(st.roastSets).filter((pid) => room.players.some((p) => p.id === pid));
        if (submitted.length < room.players.length) err('not all roast sets are in yet');
        const all = [];
        for (const [authorId, set] of Object.entries(st.roastSets)) {
          for (const r of set) all.push({ id: uid(), targetId: r.targetId, authorId, text: r.text });
        }
        st.roasts = shuffle(all);
        st.currentRoastIdx = 0; st.phase = 'guessing'; st.guesses = {};
      } else if (st.phase === 'guessing') {
        const roast = st.roasts[st.currentRoastIdx];
        const { deltas, fooled } = scoreRoastRound(roast.authorId, st.guesses);
        applyDeltas(room, deltas);
        st.roundDetail = { roast, guesses: { ...st.guesses }, fooled };
        st.phase = 'reveal';
      } else if (st.phase === 'reveal') {
        if (st.currentRoastIdx >= st.roasts.length - 1) { room.status = 'finished'; st.phase = 'done'; }
        else { st.currentRoastIdx += 1; st.phase = 'guessing'; st.guesses = {}; st.roundDetail = null; }
      } else err('cannot advance from here');
    }
    touch(room);
    return { view: buildView(room, playerId), record: room };
  },

  submitAnswer(store, ctx, { roomId, playerId, roundNo, choice }) {
    const room = getRoom(store, roomId);
    const me = getPlayer(room, playerId);
    const st = room.state;
    if (room.status !== 'playing') err('game is not playing');
    if (room.game === 'party') {
      if (st.phase !== 'question') err('not answering right now');
      const round = st.rounds[room.current_round];
      if (room.judge_mode) {
        const judge = partyJudgeForRound(room.players, room.current_round);
        if (judge && judge.id === playerId) err('the judge does not answer their own question');
      }
      if (round.type === 'mlt') {
        if (!room.players.some((p) => p.id === choice)) err('vote for a player in the room');
        st.answers[playerId] = { choice, at: Date.now() };
      } else {
        // Bank rounds carry options_zh / options_en (trivia) or options (judge-written).
        const n = (round.options && round.options.length) || (round.options_zh && round.options_zh.length) || (round.options_en && round.options_en.length) || 2;
        if (typeof choice !== 'number' || choice < 0 || choice >= n) err('bad option');
        st.answers[playerId] = { choice, at: Date.now() };
      }
      addSubmission(room, playerId, room.current_round, 'answer', { choice });
    } else if (room.game === 'twl') {
      if (st.phase !== 'guessing' || !st.currentTrio) err('not guessing right now');
      const authorId = st.guessOrder[room.current_round];
      if (playerId === authorId) err('the author sits this round out');
      if (!room.players.some((p) => p.id === choice.author)) err('guess an author in the room');
      const card = st.currentTrio.cards[choice.lie];
      if (!card) err('bad lie pick');
      st.guesses[playerId] = { author: choice.author, lie: choice.lie, lieKind: card.kind };
      addSubmission(room, playerId, room.current_round, 'answer', { author: choice.author, lie: choice.lie });
    } else if (room.game === 'undercover') {
      if (st.phase !== 'vote') err('not voting right now');
      if (!me.alive || me.is_judge) err('you cannot vote this round');
      if (!room.players.some((p) => p.id === choice && p.alive && !p.is_judge)) err('vote for a living player');
      st.votes[playerId] = choice;
      addSubmission(room, playerId, st.roundNo, 'vote', { target: choice });
    } else if (room.game === 'roast') {
      if (st.phase !== 'guessing') err('not guessing right now');
      const roast = st.roasts[st.currentRoastIdx];
      if (!roast) err('no roast to guess');
      if (playerId === roast.authorId) err('the author sits this roast out');
      if (!room.players.some((p) => p.id === choice)) err('guess an author in the room');
      st.guesses[playerId] = { author: choice };
      addSubmission(room, playerId, st.currentRoastIdx, 'answer', { author: choice });
    }
    touch(room);
    return { view: buildView(room, playerId), record: room };
  },

  submitDescription(store, ctx, { roomId, playerId, text }) {
    const room = getRoom(store, roomId);
    const me = getPlayer(room, playerId);
    const st = room.state;
    if (room.game !== 'undercover' || room.status !== 'playing') err('not an undercover game in play');
    if (st.phase !== 'describe') err('not describing right now');
    if (!me.alive || me.is_judge) err('you do not describe this round');
    if (!text || !text.trim()) err('write a clue');
    st.clues[playerId] = text.trim();
    addSubmission(room, playerId, st.roundNo, 'clue', { text: text.trim() });
    touch(room);
    return { view: buildView(room, playerId), record: room };
  },

  submitJudgeWords(store, ctx, { roomId, playerId, wordA, wordB }) {
    const room = getRoom(store, roomId);
    requireHost(room, playerId);
    const st = room.state;
    if (room.game !== 'undercover' || !room.judge_mode) err('judge mode is off');
    if (st.phase !== 'judge_words') err('words already set');
    if (!wordA || !wordB || wordA.trim() === wordB.trim()) err('write two different words');
    const pair = { zh_a: wordA.trim(), zh_b: wordB.trim(), en_a: wordA.trim(), en_b: wordB.trim() };
    room.state.pair = pair;
    const wordPlayers = room.players.filter((p) => !p.is_judge);
    for (const a of dealUndercover(wordPlayers, pair)) {
      const p = room.players.find((x) => x.id === a.id);
      p.word = a.word; p.word_en = a.wordEn; p.is_undercover = a.is_undercover; p.has_blank = a.has_blank;
    }
    const judge = room.players.find((p) => p.id === playerId);
    judge.score += 100; // +100 for setting the pair
    const u = room.players.find((p) => p.is_undercover);
    st.judgeView = { pair, undercoverId: u ? u.id : null };
    st.phase = 'describe';
    addSubmission(room, playerId, 0, 'judge_question', { wordA: pair.zh_a, wordB: pair.zh_b });
    touch(room);
    return { view: buildView(room, playerId), record: room };
  },

  submitJudgeQuestion(store, ctx, { roomId, playerId, question }) {
    const room = getRoom(store, roomId);
    const st = room.state;
    if (room.game !== 'party' || !room.judge_mode) err('judge mode is off');
    if (st.phase !== 'judge_writing') err('not writing right now');
    const judge = partyJudgeForRound(room.players, room.current_round);
    if (!judge || judge.id !== playerId) err('you are not this round’s judge');
    if (!question || !question.type || !question.text) err('write a question');
    if (question.type === 'trivia' && (!question.options || question.options.length < 2)) err('trivia needs options');
    if ((question.type === 'wyr' || question.type === 'trivia') && (!question.options || question.options.length < 2)) err('needs at least 2 options');
    const q = { type: question.type, id: 'judge-' + room.current_round, zh: question.text, en: question.text, options: question.options || null, correct: question.correct ?? null };
    if (!st.rounds) st.rounds = [];
    st.rounds[room.current_round] = q;
    st.phase = 'question';
    st.roundStartedAt = Date.now();
    addSubmission(room, playerId, room.current_round, 'judge_question', { question: q });
    touch(room);
    return { view: buildView(room, playerId), record: room };
  },

  submitStatements(store, ctx, { roomId, playerId, truth, wish, lie }) {
    const room = getRoom(store, roomId);
    getPlayer(room, playerId);
    const st = room.state;
    if (room.game !== 'twl' || room.status !== 'playing') err('not a truth/wish/lie game in play');
    if (st.phase !== 'writing') err('writing is closed');
    for (const [k, v] of [['truth', truth], ['wish', wish], ['lie', lie]]) {
      if (!v || !String(v).trim()) err(`${k} is empty`);
    }
    st.trios[playerId] = { truth: truth.trim(), wish: wish.trim(), lie: lie.trim() };
    addSubmission(room, playerId, 0, 'statement', { truth: truth.trim(), wish: wish.trim(), lie: lie.trim() });
    touch(room);
    return { view: buildView(room, playerId), record: room };
  },

  submitRoasts(store, ctx, { roomId, playerId, roasts }) {
    const room = getRoom(store, roomId);
    getPlayer(room, playerId);
    const st = room.state;
    if (room.game !== 'roast' || room.status !== 'playing') err('not a roast game in play');
    if (st.phase !== 'writing') err('writing is closed');
    const others = room.players.filter((p) => p.id !== playerId);
    if (!Array.isArray(roasts) || roasts.length !== others.length) err('write one roast for every other player');
    for (const r of roasts) {
      if (!others.some((p) => p.id === r.targetId)) err('roast target must be another player');
      if (!r.text || !String(r.text).trim()) err('a roast is empty');
    }
    st.roastSets[playerId] = roasts.map((r) => ({ targetId: r.targetId, text: String(r.text).trim() }));
    addSubmission(room, playerId, 0, 'roast', { roasts: st.roastSets[playerId] });
    touch(room);
    return { view: buildView(room, playerId), record: room };
  },
};

function makeTrio(st, authorId) {
  const trio = st.trios[authorId];
  const cards = shuffle([
    { text: trio.truth, kind: 'truth' },
    { text: trio.wish, kind: 'wish' },
    { text: trio.lie, kind: 'lie' },
  ]);
  return { authorId, cards };
}

// --- Per-player view ---------------------------------------------------------
// Secrets are filtered here: a player sees only their own word, never other
// players' words, trio authors, or roast authors until the reveal shows them.
function buildView(room, meId) {
  if (!room) return null;
  const me = room.players.find((p) => p.id === meId) || null;
  const st = room.state || {};
  const isJudge = !!(me && room.game === 'undercover' && room.judge_mode && me.id === room.host_player_id);
  const players = room.players.map((p) => {
    const base = { id: p.id, nickname: p.nickname, is_host: p.is_host, is_bot: p.is_bot, score: p.score, join_order: p.join_order, alive: p.alive, is_judge: !!p.is_judge };
    if (me && p.id === me.id) {
      base.word = p.word; base.word_en = p.word_en;
      base.is_undercover = p.is_undercover; base.has_blank = p.has_blank;
    }
    return base;
  });
  const view = {
    room: { id: room.id, code: room.code, game: room.game, status: room.status, judge_mode: room.judge_mode, host_player_id: room.host_player_id, current_round: room.current_round },
    me: me ? { id: me.id, nickname: me.nickname, is_host: me.is_host, is_bot: me.is_bot, score: me.score, is_judge: isJudge } : null,
    players,
    state: { phase: st.phase || null },
  };
  if (room.game === 'party') {
    const round = (st.rounds || [])[room.current_round] || null;
    const eligible = room.judge_mode
      ? room.players.filter((p) => { const j = partyJudgeForRound(room.players, room.current_round); return !j || p.id !== j.id; })
      : room.players;
    const judge = room.judge_mode ? partyJudgeForRound(room.players, room.current_round) : null;
    view.state.round = round;
    view.state.totalRounds = PARTY_ROUNDS;
    view.state.seconds = PARTY_SECONDS;
    view.state.roundStartedAt = st.roundStartedAt || null;
    view.state.answersCount = Object.keys(st.answers || {}).length;
    view.state.answersTotal = eligible.length;
    view.state.myAnswer = me && st.answers ? (st.answers[me.id] ?? null) : null;
    view.state.judgeId = judge ? judge.id : null;
    if (st.phase === 'reveal') { view.state.roundDetail = st.roundDetail; view.state.roundDeltas = st.roundDeltas; }
  } else if (room.game === 'twl') {
    view.state.triosIn = Object.keys(st.trios || {}).filter((pid) => room.players.some((p) => p.id === pid)).length;
    view.state.triosTotal = room.players.length;
    view.state.myTrioIn = !!(me && st.trios && st.trios[me.id]);
    view.state.guessOrder = st.guessOrder || [];
    if (st.currentTrio) {
      const showKinds = st.phase === 'reveal';
      view.state.currentTrio = {
        cards: st.currentTrio.cards.map((c) => ({ text: c.text, kind: showKinds ? c.kind : null })),
        authorId: showKinds ? st.currentTrio.authorId : null,
      };
    }
    view.state.guessesCount = Object.keys(st.guesses || {}).length;
    view.state.guessersTotal = Math.max(0, room.players.length - 1);
    view.state.myGuess = me && st.guesses ? (st.guesses[me.id] ?? null) : null;
    // The author must sit their own trio out, but the author id stays hidden
    // from everyone else — so expose only a boolean for the requesting player.
    view.state.amAuthor = !!(me && st.currentTrio && st.currentTrio.authorId === me.id);
    if (st.phase === 'reveal' && st.roundDetail) view.state.roundDetail = st.roundDetail;
  } else if (room.game === 'undercover') {
    view.state.roundNo = st.roundNo || 1;
    view.state.clues = Object.entries(st.clues || {}).map(([pid, text]) => {
      const p = room.players.find((x) => x.id === pid);
      return { playerId: pid, nickname: p ? p.nickname : '?', text };
    });
    view.state.cluesCount = Object.keys(st.clues || {}).length;
    view.state.cluesTotal = aliveWordPlayers(room).length;
    view.state.myClue = me && st.clues ? (st.clues[me.id] ?? null) : null;
    view.state.votesCount = Object.keys(st.votes || {}).length;
    view.state.votesTotal = aliveWordPlayers(room).length;
    view.state.myVote = me && st.votes ? (st.votes[me.id] ?? null) : null;
    view.state.winnerSide = st.winnerSide || null;
    view.state.lastEliminated = st.lastEliminated || null;
    view.state.voteDetail = st.voteDetail || null;
    view.state.roundDeltas = st.roundDeltas || null;
    if (me) {
      const mine = room.players.find((p) => p.id === me.id);
      if (mine) {
        view.state.myWord = mine.word;
        // word_en is not a column in the players table (V0 schema): derive
        // the English word from the pair — civilians hold zh_a, undercover zh_b.
        view.state.myWordEn = mine.word_en || (st.pair && mine.word ? (mine.word === st.pair.zh_a ? st.pair.en_a : st.pair.en_b) : null);
        view.state.iAmUndercover = mine.is_undercover; view.state.iAmBlank = mine.has_blank;
      }
    }
    const showPair = room.status === 'finished' || isJudge;
    if (showPair && st.pair) view.state.pair = st.pair;
    if (isJudge && st.judgeView) view.state.judgeView = st.judgeView;
    if (room.status === 'finished') {
      const u = room.players.find((p) => p.is_undercover);
      view.state.undercoverId = u ? u.id : null;
    }
  } else if (room.game === 'roast') {
    view.state.roastsIn = Object.keys(st.roastSets || {}).filter((pid) => room.players.some((p) => p.id === pid)).length;
    view.state.roastsTotal = room.players.length;
    view.state.myRoastsIn = !!(me && st.roastSets && st.roastSets[me.id]);
    view.state.totalRoasts = (st.roasts || []).length;
    view.state.currentRoastIdx = st.currentRoastIdx || 0;
    const roast = (st.roasts || [])[st.currentRoastIdx];
    if (roast) {
      const target = room.players.find((p) => p.id === roast.targetId);
      view.state.currentRoast = {
        text: roast.text,
        targetId: roast.targetId,
        targetNickname: target ? target.nickname : '?',
        authorId: st.phase === 'reveal' ? roast.authorId : null,
        // Boolean only: the author sits their own roast out, without the
        // author id leaking to anyone else before the reveal.
        amAuthor: !!(me && roast.authorId === me.id),
      };
    }
    view.state.guessesCount = Object.keys(st.guesses || {}).length;
    view.state.guessersTotal = Math.max(0, room.players.length - 1);
    view.state.myGuess = me && st.guesses ? (st.guesses[me.id] ?? null) : null;
    if (st.phase === 'reveal' && st.roundDetail) view.state.roundDetail = st.roundDetail;
  }
  return view;
}

// ---------------------------------------------------------------------------
// Mock backend (localStorage)
// ---------------------------------------------------------------------------
class MockBackend {
  constructor(ctx) { this.ctx = ctx; }
  _load() { return lsGet() || { rooms: {} }; }
  _save(store) { lsSet(store); }
  async _run(op, args) {
    const store = this._load();
    const out = Ops[op](store, this.ctx, args);
    this._save(store);
    return out.view !== undefined ? out : out;
  }
  async createRoom(a) { return this._run('createRoom', a); }
  async joinRoom(a) { return this._run('joinRoom', a); }
  async leaveRoom(a) { return this._run('leaveRoom', a); }
  async addBots(a) { return this._run('addBots', a); }
  async removeBot(a) { return this._run('removeBot', a); }
  async startGame(a) { return this._run('startGame', a); }
  async advanceGame(a) { return this._run('advanceGame', a); }
  async submitAnswer(a) { return this._run('submitAnswer', a); }
  async submitDescription(a) { return this._run('submitDescription', a); }
  async submitJudgeWords(a) { return this._run('submitJudgeWords', a); }
  async submitJudgeQuestion(a) { return this._run('submitJudgeQuestion', a); }
  async submitStatements(a) { return this._run('submitStatements', a); }
  async submitRoasts(a) { return this._run('submitRoasts', a); }
  async getRoomState({ roomId, playerId }) {
    const store = this._load();
    const room = getRoom(store, roomId);
    return { view: buildView(room, playerId), record: null };
  }
}

// ---------------------------------------------------------------------------
// Supabase backend (PostgREST). Same rule engine, run client-side:
// load the room's rows -> run the op -> write the changed rows back.
// v1 limits (see README): last-write-wins on rooms.state; no server-side
// per-player secret filtering — the UI hides secrets, the DB does not.
// ---------------------------------------------------------------------------
class SupabaseBackend {
  constructor(ctx, url, key) {
    this.ctx = ctx;
    this.url = url.replace(/\/$/, '');
    this.key = key;
  }
  async _sb(path, method = 'GET', body = null, extra = {}) {
    const res = await fetch(`${this.url}/rest/v1/${path}`, {
      method,
      headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...extra },
      body: body ? JSON.stringify(body) : null,
    });
    if (!res.ok) err(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  _toRecord(roomRow, players, submissions) {
    return { ...roomRow, state: roomRow.state || freshState(roomRow.game), players: players || [], submissions: submissions || [] };
  }
  async _loadRoom(roomId) {
    const [rooms, players, submissions] = await Promise.all([
      this._sb(`rooms?id=eq.${roomId}&select=*`),
      this._sb(`players?room_id=eq.${roomId}&select=*&order=join_order`),
      this._sb(`submissions?room_id=eq.${roomId}&select=*&order=created_at&limit=500`),
    ]);
    if (!rooms || !rooms.length) err('room not found');
    return this._toRecord(rooms[0], players, submissions);
  }
  async _persist(record, beforeSubmissionIds) {
    const { players, submissions, ...roomRow } = record;
    await this._sb(`rooms?id=eq.${record.id}`, 'PATCH', {
      code: roomRow.code, game: roomRow.game, status: roomRow.status,
      judge_mode: roomRow.judge_mode, host_player_id: roomRow.host_player_id,
      current_round: roomRow.current_round, state: roomRow.state, updated_at: nowIso(),
    });
    for (const p of players) {
      // The players table has no word_en column (V0 schema): strip it on
      // write. The English word is derived on read in buildView.
      const { room_id, word_en: _wordEn, ...row } = p;
      await this._sb('players?on_conflict=id', 'POST', { ...row, room_id }, { Prefer: 'resolution=merge-duplicates,return=representation' });
    }
    for (const s of submissions) {
      if (beforeSubmissionIds && beforeSubmissionIds.has(s.id)) continue;
      await this._sb('submissions', 'POST', { id: s.id, room_id: s.room_id, player_id: s.player_id, round_no: s.round_no, kind: s.kind, payload: s.payload });
    }
  }
  async _run(op, args, roomId) {
    const record = await this._loadRoom(roomId);
    const before = new Set(record.submissions.map((s) => s.id));
    const store = { rooms: { [roomId]: record } };
    const out = Ops[op](store, this.ctx, args);
    const next = store.rooms[roomId];
    if (next) await this._persist(next, before);
    else await this._sb(`rooms?id=eq.${roomId}`, 'DELETE');
    return out;
  }
  async createRoom({ hostName, game, judgeMode }) {
    const store = { rooms: {} };
    const out = Ops.createRoom(store, this.ctx, { hostName, game, judgeMode });
    const record = out.record;
    const { players, submissions, ...roomRow } = record;
    await this._sb('rooms', 'POST', { ...roomRow, created_at: roomRow.created_at, updated_at: roomRow.updated_at });
    // The players table has no word_en column (V0 schema): strip it on write.
    const { word_en: _wordEn, ...hostRow } = players[0];
    await this._sb('players', 'POST', hostRow);
    return out;
  }
  async joinRoom({ code, nickname }) {
    const rooms = await this._sb(`rooms?code=eq.${String(code).toUpperCase()}&select=*`);
    if (!rooms || !rooms.length) err('no room with that PIN');
    return this._run('joinRoom', { code, nickname }, rooms[0].id);
  }
  async leaveRoom(a) { return this._run('leaveRoom', a, a.roomId); }
  async addBots(a) { return this._run('addBots', a, a.roomId); }
  async removeBot(a) { return this._run('removeBot', a, a.roomId); }
  async startGame(a) { return this._run('startGame', a, a.roomId); }
  async advanceGame(a) { return this._run('advanceGame', a, a.roomId); }
  async submitAnswer(a) { return this._run('submitAnswer', a, a.roomId); }
  async submitDescription(a) { return this._run('submitDescription', a, a.roomId); }
  async submitJudgeWords(a) { return this._run('submitJudgeWords', a, a.roomId); }
  async submitJudgeQuestion(a) { return this._run('submitJudgeQuestion', a, a.roomId); }
  async submitStatements(a) { return this._run('submitStatements', a, a.roomId); }
  async submitRoasts(a) { return this._run('submitRoasts', a, a.roomId); }
  async getRoomState({ roomId, playerId }) {
    const record = await this._loadRoom(roomId);
    return { view: buildView(record, playerId), record: null };
  }
}

// ---------------------------------------------------------------------------
// Public facade
// ---------------------------------------------------------------------------
export const GamesAPI = {
  mode: 'mock',
  bank: null,
  pairs: null,
  backend: null,
  POLL_MS,

  config() {
    if (typeof window !== 'undefined' && window.GAMES_CONFIG) return window.GAMES_CONFIG;
    if (typeof globalThis !== 'undefined' && globalThis.GAMES_CONFIG) return globalThis.GAMES_CONFIG;
    return {};
  },
  isConfigured() {
    const c = this.config();
    return !!(c.supabaseUrl && c.anonKey);
  },
  _setBanks(bank, pairs) { this.bank = bank; this.pairs = pairs; },
  async _loadBanks() {
    if (this.bank && this.pairs) return;
    const [bank, pairs] = await Promise.all([
      fetch('data/party-mix.json').then((r) => r.json()),
      fetch('data/undercover-pairs.json').then((r) => r.json()),
    ]);
    this.bank = bank; this.pairs = pairs.pairs;
  },
  async init(opts = {}) {
    // config.js is optional: copy config.example.js -> config.js to go live.
    // A missing file just means mock mode; the import rejection is swallowed
    // on purpose so the console stays clean.
    try { await import(new URL('../config.js', import.meta.url)); } catch (_) { /* no config.js — mock mode */ }
    await this._loadBanks();
    const ctx = { bank: this.bank, pairs: this.pairs };
    if (this.isConfigured() && !opts.forceMock) {
      const c = this.config();
      this.backend = new SupabaseBackend(ctx, c.supabaseUrl, c.anonKey);
      this.mode = 'supabase';
    } else {
      this.backend = new MockBackend(ctx);
      this.mode = 'mock';
    }
    return this.mode;
  },
  _needInit() { if (!this.backend) err('GamesAPI.init() first'); },
  async createRoom(a) { this._needInit(); return this.backend.createRoom(a); },
  async joinRoom(a) { this._needInit(); return this.backend.joinRoom(a); },
  async leaveRoom(a) { this._needInit(); return this.backend.leaveRoom(a); },
  async addBots(a) { this._needInit(); return this.backend.addBots(a); },
  async removeBot(a) { this._needInit(); return this.backend.removeBot(a); }
  ,
  async startGame(a) { this._needInit(); return this.backend.startGame(a); },
  async advanceGame(a) { this._needInit(); return this.backend.advanceGame(a); },
  async getRoomState(a) { this._needInit(); return this.backend.getRoomState(a); },
  async submitAnswer(a) { this._needInit(); return this.backend.submitAnswer(a); },
  async submitDescription(a) { this._needInit(); return this.backend.submitDescription(a); },
  async submitJudgeWords(a) { this._needInit(); return this.backend.submitJudgeWords(a); },
  async submitJudgeQuestion(a) { this._needInit(); return this.backend.submitJudgeQuestion(a); },
  async submitStatements(a) { this._needInit(); return this.backend.submitStatements(a); },
  async submitRoasts(a) { this._needInit(); return this.backend.submitRoasts(a); },
};

// Also export internals for the test harness.
export { Ops, buildView, freshState };
