// app.js — Glomere Games UI shell.
// Single-page app: home -> lobby -> game -> podium. Polls getRoomState every
// 1s; the database (mock localStorage, or Supabase) is the source of truth.
// If state looks stuck, the UI says so and tells the user to hard-refresh.
//
// Session (roomId + playerId) persists in localStorage so a refresh rejoins.

import { GamesAPI } from './api.js';
import { getLang, setLang, t } from './i18n.js';
import { tickBots, resetBotTimers } from './bots.js';

const $ = (sel) => document.querySelector(sel);
const SESSION_KEY = 'glomere-games-session';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let view = null;           // current per-player room view
let session = null;        // { roomId, playerId }
let pollTimer = null;
let botTimer = null;
let countdownTimer = null;
let errorMsg = '';
let autoAdvancedRound = -1;
let selectedGame = 'undercover';
let judgeMode = false;

function saveSession() { try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (_) {} }
function loadSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (_) { return null; } }
function clearSession() { session = null; try { localStorage.removeItem(SESSION_KEY); } catch (_) {} }

// --- boot ------------------------------------------------------------------
async function boot() {
  await GamesAPI.init();
  session = loadSession();
  document.documentElement.lang = getLang() === 'zh' ? 'zh-CN' : 'en';
  if (session) {
    try {
      const { view: v } = await GamesAPI.getRoomState({ roomId: session.roomId, playerId: session.playerId });
      view = v;
      startPolling();
    } catch (_) { clearSession(); view = null; }
  }
  render();
}
window.addEventListener('DOMContentLoaded', boot);

// --- polling ---------------------------------------------------------------
function startPolling() {
  stopPolling();
  pollTimer = setInterval(poll, GamesAPI.POLL_MS);
  botTimer = setInterval(() => { if (view && view.me && view.me.is_host) tickBots(view); }, 2000);
  poll();
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  if (botTimer) clearInterval(botTimer);
  pollTimer = botTimer = null;
}
async function poll() {
  if (!session) return;
  try {
    const { view: v } = await GamesAPI.getRoomState({ roomId: session.roomId, playerId: session.playerId });
    view = v;
    errorMsg = '';
    hostAutoAdvance();
    render();
  } catch (e) {
    errorMsg = e.message || String(e);
    render();
  }
}

// Host drives the clock: when every eligible player has answered a Party Mix
// round, or the 25s timer expires, the host advances to the reveal.
function hostAutoAdvance() {
  if (!view || !view.me || !view.me.is_host) return;
  if (view.room.game !== 'party' || view.room.status !== 'playing') return;
  const st = view.state;
  if (st.phase === 'question') {
    const key = view.room.current_round;
    if (st.answersCount >= st.answersTotal && st.answersTotal > 0 && autoAdvancedRound !== key) {
      autoAdvancedRound = key;
      setTimeout(() => GamesAPI.advanceGame({ roomId: session.roomId, playerId: session.playerId, action: 'next' }).catch(() => {}), 1500);
    }
    if (st.roundStartedAt && Date.now() - st.roundStartedAt > st.seconds * 1000 && autoAdvancedRound !== key) {
      autoAdvancedRound = key;
      GamesAPI.advanceGame({ roomId: session.roomId, playerId: session.playerId, action: 'next' }).catch(() => {});
    }
  }
}

// --- actions (called from the delegated click handler) ---------------------
async function act(fn) {
  try { errorMsg = ''; await fn(); await poll(); }
  catch (e) { errorMsg = e.message || String(e); render(); }
}

const actions = {
  'toggle-lang': () => { setLang(getLang() === 'zh' ? 'en' : 'zh'); render(); },
  'pick-game': (el) => { selectedGame = el.dataset.game; judgeMode = false; render(); },
  'toggle-judge': (el) => { judgeMode = el.checked; },
  'create-room': () => act(async () => {
    const name = $('#create-name').value.trim();
    if (!name) throw new Error(t('createFirst'));
    const { view: v, player } = await GamesAPI.createRoom({ hostName: name, game: selectedGame, judgeMode });
    session = { roomId: v.room.id, playerId: player.id };
    saveSession(); view = v; resetBotTimers(); startPolling(); render();
  }),
  'join-room': () => act(async () => {
    const pin = $('#join-pin').value.trim().toUpperCase();
    const name = $('#join-name').value.trim();
    if (!pin) throw new Error(t('pinFirst'));
    if (!name) throw new Error(t('createFirst'));
    const { view: v, player } = await GamesAPI.joinRoom({ code: pin, nickname: name });
    session = { roomId: v.room.id, playerId: player.id };
    saveSession(); view = v; startPolling(); render();
  }),
  'leave-room': () => act(async () => {
    await GamesAPI.leaveRoom({ roomId: session.roomId, playerId: session.playerId });
    stopPolling(); clearSession(); view = null; render();
  }),
  'add-bots-1': () => act(() => GamesAPI.addBots({ roomId: session.roomId, playerId: session.playerId, count: 1 })),
  'add-bots-3': () => act(() => GamesAPI.addBots({ roomId: session.roomId, playerId: session.playerId, count: 3 })),
  'remove-bot': (el) => act(() => GamesAPI.removeBot({ roomId: session.roomId, playerId: session.playerId, botId: el.dataset.bot })),
  'start-game': () => act(() => GamesAPI.startGame({ roomId: session.roomId, playerId: session.playerId })),
  'advance': () => act(() => GamesAPI.advanceGame({ roomId: session.roomId, playerId: session.playerId, action: 'next' })),
  'play-again': () => act(async () => {
    await GamesAPI.advanceGame({ roomId: session.roomId, playerId: session.playerId, action: 'playAgain' });
    autoAdvancedRound = -1; resetBotTimers();
  }),
  'copy-pin': () => { if (view) navigator.clipboard?.writeText(view.room.code).catch(() => {}); },
  'answer': (el) => act(() => GamesAPI.submitAnswer({
    roomId: session.roomId, playerId: session.playerId, roundNo: view.room.current_round,
    choice: el.dataset.choiceType === 'num' ? Number(el.dataset.choice) : el.dataset.choice,
  })),
  'submit-clue': () => act(() => GamesAPI.submitDescription({
    roomId: session.roomId, playerId: session.playerId, text: $('#clue-input').value,
  })),
  'submit-judge-words': () => act(() => GamesAPI.submitJudgeWords({
    roomId: session.roomId, playerId: session.playerId,
    wordA: $('#word-a').value, wordB: $('#word-b').value,
  })),
  'submit-judge-question': () => act(() => {
    const type = $('#jq-type').value;
    const options = $('#jq-options').value.split('\n').map((s) => s.trim()).filter(Boolean);
    return GamesAPI.submitJudgeQuestion({
      roomId: session.roomId, playerId: session.playerId,
      question: { type, text: $('#jq-text').value.trim(), options, correct: Number($('#jq-correct').value) || 0 },
    });
  }),
  'submit-trio': () => act(() => GamesAPI.submitStatements({
    roomId: session.roomId, playerId: session.playerId,
    truth: $('#trio-truth').value, wish: $('#trio-wish').value, lie: $('#trio-lie').value,
  })),
  'submit-twl-guess': () => act(() => {
    const author = document.querySelector('input[name="twl-author"]:checked')?.value;
    const lie = document.querySelector('input[name="twl-lie"]:checked')?.value;
    if (!author || lie === undefined) throw new Error('pick an author and a lie');
    return GamesAPI.submitAnswer({ roomId: session.roomId, playerId: session.playerId, roundNo: view.room.current_round, choice: { author, lie: Number(lie) } });
  }),
  'submit-roasts': () => act(() => {
    const roasts = [...document.querySelectorAll('[data-roast-target]')].map((el) => ({ targetId: el.dataset.roastTarget, text: el.value }));
    return GamesAPI.submitRoasts({ roomId: session.roomId, playerId: session.playerId, roasts });
  }),
  'submit-roast-guess': () => act(() => {
    const author = document.querySelector('input[name="roast-author"]:checked')?.value;
    if (!author) throw new Error('pick who wrote it');
    return GamesAPI.submitAnswer({ roomId: session.roomId, playerId: session.playerId, roundNo: view.state.currentRoastIdx, choice: author });
  }),
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) fn(el, ev);
});

// --- rendering -------------------------------------------------------------
function lang() { return getLang(); }
function L(zh, en) { return lang() === 'zh' ? zh : en; }
function gameName(g) {
  return { party: t('gameParty'), twl: t('gameTwl'), undercover: t('gameUnder'), roast: t('gameRoast') }[g] || g;
}
function playerLine(p) {
  return `<li>${esc(p.nickname)} ${p.is_bot ? `<span class="badge bot">${t('bot')}</span>` : ''} ${p.is_host ? `<span class="badge host">${t('host')}</span>` : ''} ${p.is_judge ? `<span class="badge judge">${t('judge')}</span>` : ''} ${!p.alive ? '💀' : ''} <span class="score">${t('points', { n: p.score })}</span></li>`;
}
function leaderboard() {
  const sorted = view.players.slice().sort((a, b) => b.score - a.score);
  return `<ol class="board">${sorted.map((p, i) => `<li>${i === 0 ? '👑 ' : ''}${esc(p.nickname)} — ${t('points', { n: p.score })}${view.me && p.id === view.me.id ? ` (${t('you')})` : ''}</li>`).join('')}</ol>`;
}
function errLine() { return errorMsg ? `<p class="error">${esc(t('error', { m: errorMsg }))}</p>` : ''; }
function modeBadge() {
  return `<p class="mode">${GamesAPI.mode === 'supabase' ? t('liveMode') : t('mockMode')}</p>`;
}

function render() {
  const root = $('#screen');
  if (!root) return;
  if (!view) { root.innerHTML = homeHtml(); return; }
  if (view.room.status === 'lobby') { root.innerHTML = lobbyHtml(); return; }
  if (view.room.status === 'finished') { root.innerHTML = finishedHtml(); return; }
  root.innerHTML = { party: partyHtml, twl: twlHtml, undercover: undercoverHtml, roast: roastHtml }[view.room.game]();
  startCountdown();
}

function homeHtml() {
  const games = ['undercover'];
  return `
  <header><button class="lang" data-action="toggle-lang">${lang() === 'zh' ? 'EN' : '中文'}</button></header>
  <h1>🎉 Glomere Games</h1>
  <p class="tagline">${t('tagline')}</p>
  <p class="sub">${t('sub')}</p>
  ${modeBadge()}
  <section class="card"><h2>${t('createRoom')}</h2>
    <label>${t('yourName')}<input id="create-name" maxlength="20" autocomplete="off"></label>
    <div class="games">${games.map((g) => `<button class="game-card ${selectedGame === g ? 'sel' : ''}" data-action="pick-game" data-game="${g}">
      <b>${gameName(g)}</b><span>${t('game' + { party: 'Party', twl: 'Twl', undercover: 'Under', roast: 'Roast' }[g] + 'Desc')}</span></button>`).join('')}</div>
    <button class="primary" data-action="create-room">${t('createRoom')}</button>
  </section>
  <section class="card"><h2>${t('joinRoom')}</h2>
    <label>${t('roomPin')}<input id="join-pin" maxlength="4" autocomplete="off" placeholder="ABCD"></label>
    <label>${t('yourName')}<input id="join-name" maxlength="20" autocomplete="off"></label>
    <button class="primary" data-action="join-room">${t('joinRoom')}</button>
  </section>
  ${errLine()}`;
}

function lobbyHtml() {
  const isHost = view.me && view.me.is_host;
  const need = { party: 2, twl: 2, undercover: view.room.judge_mode ? 5 : 4, roast: 3 }[view.room.game];
  return `
  <header><button class="lang" data-action="toggle-lang">${lang() === 'zh' ? 'EN' : '中文'}</button></header>
  <h1>${gameName(view.room.game)}</h1>
  ${view.room.judge_mode ? `<p><span class="badge judge">⚖️ ${t('judgeMode')}</span></p>` : ''}
  <p class="pin-label">${t('roomPin')}</p>
  <p class="pin" data-action="copy-pin" title="${t('pinCopied')}">${esc(view.room.code)}</p>
  <p class="hint">${t('players')}: ${view.players.length}</p>
  <ul class="players">${view.players.map(playerLine).join('')}</ul>
  ${isHost ? `<div class="row"><button data-action="add-bots-1">+1 🤖</button><button data-action="add-bots-3">+3 🤖</button></div>
  <p class="hint">${view.players.filter((p) => p.is_bot).map((b) => `<button class="mini" data-action="remove-bot" data-bot="${b.id}">✕ ${esc(b.nickname)}</button>`).join(' ')}</p>` : ''}
  ${isHost
    ? `<button class="primary" data-action="start-game" ${view.players.length < need ? 'disabled' : ''}>${t('startGame')}</button>
       ${view.players.length < need ? `<p class="hint">${t('needPlayers', { game: gameName(view.room.game), n: need })}</p>` : ''}`
    : `<p>${t('waitingHost')}</p>`}
  <button class="ghost" data-action="leave-room">${t('leaveRoom')}</button>
  <p class="stuck">${t('hardRefresh')}</p>
  ${errLine()}`;
}

function finishedHtml() {
  return `
  <header><button class="lang" data-action="toggle-lang">${lang() === 'zh' ? 'EN' : '中文'}</button></header>
  <h1>${t('finalStandings')}</h1>
  <p>${t('winner')}: ${esc(view.players.slice().sort((a, b) => b.score - a.score)[0]?.nickname || '')}</p>
  ${leaderboard()}
  ${view.me && view.me.is_host ? `<button class="primary" data-action="play-again">${t('playAgain')}</button>` : ''}
  <button class="ghost" data-action="leave-room">${t('leaveRoom')}</button>
  ${errLine()}`;
}

// --- Party Mix ---
function startCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
  if (!view || view.room.game !== 'party' || view.state.phase !== 'question' || !view.state.roundStartedAt) return;
  const tick = () => {
    const el = $('#countdown');
    if (!el) { clearInterval(countdownTimer); return; }
    const left = Math.max(0, Math.ceil(view.state.seconds - (Date.now() - view.state.roundStartedAt) / 1000));
    el.textContent = t('secondsLeft', { n: left });
  };
  tick();
  countdownTimer = setInterval(tick, 500);
}

function partyHtml() {
  const st = view.state;
  const round = st.round;
  const isHost = view.me && view.me.is_host;
  const isJudge = view.room.judge_mode && st.judgeId === view.me?.id;
  let body = `<p>${t('round', { n: view.room.current_round + 1, t: st.totalRounds })}</p>`;
  if (st.phase === 'judge_writing') {
    body += isJudge ? `
      <h2>${t('writeQuestion')}</h2>
      <label>${t('qType')}<select id="jq-type"><option value="wyr">Would You Rather / 二选一</option><option value="mlt">Most Likely To / 最可能</option><option value="trivia">Trivia / 快问快答</option></select></label>
      <label>${t('qText')}<input id="jq-text"></label>
      <label>${t('qOptions')}<textarea id="jq-options" rows="4" placeholder="A&#10;B&#10;C&#10;D"></textarea></label>
      <label>${t('qCorrect')}<input id="jq-correct" type="number" min="0" max="3" value="0"></label>
      <button class="primary" data-action="submit-judge-question">${t('sendQuestion')}</button>`
      : `<p>${t('judgeWriting')}</p>`;
  } else if (st.phase === 'question' && round) {
    const qText = lang() === 'zh' ? (round.zh || round.en) : (round.en || round.zh);
    body += `<p id="countdown" class="timer"></p><h2>${esc(qText)}</h2>`;
    if (st.myAnswer) body += `<p>${t('submitted')}</p>`;
    else if (round.type === 'mlt') body += `<div class="opts">${view.players.map((p) => `<button data-action="answer" data-choice-type="id" data-choice="${p.id}">${esc(p.nickname)}</button>`).join('')}</div>`;
    else {
      const opts = lang() === 'zh' ? (round.options_zh || round.options) : (round.options_en || round.options);
      body += `<div class="opts">${(opts || []).map((o, i) => `<button data-action="answer" data-choice-type="num" data-choice="${i}">${esc(o)}</button>`).join('')}</div>`;
    }
    body += `<p>${t('waitingAnswers', { a: st.answersCount, t: st.answersTotal })}</p>`;
  } else if (st.phase === 'reveal' && st.roundDetail) {
    const d = st.roundDetail;
    body += `<h2>${t('reveal')}</h2>`;
    if (round.type === 'trivia') {
      const mine = st.myAnswer;
      body += `<p>${mine ? (mine.choice === round.correct ? t('correct') : t('wrong')) : ''}</p><p>${L('正确答案：', 'Correct answer: ')}${esc(lang() === 'zh' ? (round.answer_zh || '') : (round.answer_en || ''))}</p>`;
    }
    if (round.type === 'wyr' && d.majority !== null) body += `<p>${t('majority')} ${(lang() === 'zh' ? (round.options_zh || round.options) : (round.options_en || round.options))[d.majority]}</p>`;
    if (round.type === 'mlt' && d.mostVoted) { const p = view.players.find((x) => x.id === d.mostVoted); body += `<p>${t('mostVoted')}: ${esc(p?.nickname || '')} ${t('crownBonus')}</p>`; }
    body += `<ul>${Object.entries(st.roundDeltas || {}).map(([pid, n]) => { const p = view.players.find((x) => x.id === pid); return `<li>${esc(p?.nickname || '?')} +${n}</li>`; }).join('') || '<li>—</li>'}</ul>`;
    body += `<h3>${t('leaderboard')}</h3>${leaderboard()}`;
    body += isHost ? `<button class="primary" data-action="advance">${view.room.current_round >= st.totalRounds - 1 ? t('finish') : t('nextRound')}</button>` : `<p>${t('waitingHost')}</p>`;
  }
  return `<header><button class="lang" data-action="toggle-lang">${lang() === 'zh' ? 'EN' : '中文'}</button></header>
  <h1>${gameName('party')}</h1>${body}<p class="stuck">${t('hardRefresh')}</p>${errLine()}`;
}

// --- Truth / Wish / Lie ---
function twlHtml() {
  const st = view.state;
  const isHost = view.me && view.me.is_host;
  let body = '';
  if (st.phase === 'writing') {
    body += `<h2>${t('writeTrio')}</h2>`;
    if (st.myTrioIn) body += `<p>${t('submitted')}</p>`;
    else body += `
      <label>${t('truth')}<input id="trio-truth"></label>
      <label>${t('wish')}<input id="trio-wish"></label>
      <label>${t('lie')}<input id="trio-lie"></label>
      <button class="primary" data-action="submit-trio">${t('submitTrio')}</button>`;
    body += `<p>${t('triosIn', { a: st.triosIn, t: st.triosTotal })}</p>`;
    body += isHost ? `<button class="primary" data-action="advance" ${st.triosIn < st.triosTotal ? 'disabled' : ''}>${t('next')}</button>` : `<p>${t('waitingHost')}</p>`;
  } else if (st.phase === 'guessing' && st.currentTrio) {
    const amAuthor = !!st.amAuthor;
    body += `<h2>${t('guessWho')}</h2>`;
    body += `<div class="cards">${st.currentTrio.cards.map((c) => `<div class="card-line">${esc(c.text)}</div>`).join('')}</div>`;
    if (amAuthor) body += `<p>${L('这组是你写的，你这轮旁观。', 'This trio is yours — you sit this round out.')}</p>`;
    else if (st.myGuess) body += `<p>${t('submitted')}</p>`;
    else {
      body += `<fieldset><legend>${t('guessWho')}</legend>${view.players.filter((p) => p.id !== view.me?.id).map((p) => `<label><input type="radio" name="twl-author" value="${p.id}"> ${esc(p.nickname)}</label>`).join('')}</fieldset>
      <fieldset><legend>${t('guessLie')}</legend>${st.currentTrio.cards.map((c, i) => `<label><input type="radio" name="twl-lie" value="${i}"> ${esc(c.text)}</label>`).join('')}</fieldset>
      <button class="primary" data-action="submit-twl-guess">${t('submitGuess')}</button>`;
    }
    body += `<p>${t('waitingGuesses')} ${st.guessesCount} / ${st.guessersTotal}</p>`;
    body += isHost ? `<button class="primary" data-action="advance">${t('reveal')}</button>` : '';
  } else if (st.phase === 'reveal' && st.roundDetail) {
    const d = st.roundDetail;
    const author = view.players.find((p) => p.id === d.authorId);
    body += `<h2>${t('reveal')}</h2><p>${t('authorWas', { name: author?.nickname || '?' })}</p>`;
    body += `<div class="cards">${d.cards.map((c) => `<div class="card-line"><b>${c.kind === 'truth' ? t('truth') : c.kind === 'wish' ? t('wish') : t('lie')}</b> — ${esc(c.text)}</div>`).join('')}</div>`;
    body += `<p>${t('fooled', { n: d.fooled, p: d.fooled * 50 })}</p>`;
    body += `<h3>${t('leaderboard')}</h3>${leaderboard()}`;
    body += isHost ? `<button class="primary" data-action="advance">${view.room.current_round >= st.guessOrder.length - 1 ? t('finish') : t('nextRound')}</button>` : `<p>${t('waitingHost')}</p>`;
  }
  return `<header><button class="lang" data-action="toggle-lang">${lang() === 'zh' ? 'EN' : '中文'}</button></header>
  <h1>${gameName('twl')}</h1>${body}<p class="stuck">${t('hardRefresh')}</p>${errLine()}`;
}

// --- Undercover ---
function undercoverHtml() {
  const st = view.state;
  const isHost = view.me && view.me.is_host;
  const isJudge = view.me && view.me.is_judge;
  let body = `<p>${t('describeRound')} ${st.roundNo}</p>`;
  if (isJudge && st.judgeView) {
    body += `<p class="judge-panel">${t('judgeSees', { a: st.judgeView.pair.zh_a, b: st.judgeView.pair.zh_b, name: (view.players.find((p) => p.id === st.judgeView.undercoverId) || {}).nickname || '?' })}</p>`;
  }
  if (st.phase === 'judge_words') {
    body += isJudge ? `
      <h2>${t('writeWordPair')}</h2>
      <label>${t('wordA')}<input id="word-a"></label>
      <label>${t('wordB')}<input id="word-b"></label>
      <button class="primary" data-action="submit-judge-words">${t('dealWords')}</button>`
      : `<p>${t('waitingHost')}</p>`;
  } else if (st.phase === 'describe') {
    if (!isJudge) {
      const myWord = lang() === 'zh' ? st.myWord : (st.myWordEn || st.myWord);
      body += st.iAmBlank
        ? `<p class="word blank">${t('noWord')}</p>`
        : `<p class="word">${st.iAmUndercover ? t('undercoverWord') + ' ' : t('yourWord') + ': '}<b>${esc(myWord || '')}</b></p>`;
      body += st.myClue ? `<p>${t('submitted')}: ${esc(st.myClue)}</p>` : `
        <label>${t('writeClue')}<input id="clue-input" maxlength="60"></label>
        <button class="primary" data-action="submit-clue">${t('submitClue')}</button>`;
    }
    body += `<h3>${t('cluesIn', { a: st.cluesCount, t: st.cluesTotal })}</h3><ul>${st.clues.map((c) => `<li><b>${esc(c.nickname)}</b>: ${esc(c.text)}</li>`).join('')}</ul>`;
    body += isHost ? `<button class="primary" data-action="advance">${t('voteOut')}</button>` : '';
  } else if (st.phase === 'vote') {
    body += `<h2>${t('voteOut')}</h2><ul>${st.clues.map((c) => `<li><b>${esc(c.nickname)}</b>: ${esc(c.text)}</li>`).join('')}</ul>`;
    if (isJudge) body += `<p>${L('你是裁判，不投票。', 'You are the judge — you don’t vote.')}</p>`;
    else if (!view.me || !view.players.find((p) => p.id === view.me.id)?.alive) body += `<p>💀 ${L('你已被投出，旁观本轮。', 'You were voted out — watching this round.')}</p>`;
    else if (st.myVote) body += `<p>${t('submitted')}</p>`;
    else body += `<div class="opts">${aliveWordPlayers().map((p) => `<button data-action="answer" data-choice-type="id" data-choice="${p.id}">${esc(p.nickname)}</button>`).join('')}</div>`;
    body += `<p>${t('votesIn', { a: st.votesCount, t: st.votesTotal })}</p>`;
    body += isHost ? `<button class="primary" data-action="advance">${t('reveal')}</button>` : '';
  } else if (st.phase === 'reveal' && st.lastEliminated) {
    const elim = view.players.find((p) => p.id === st.lastEliminated.id);
    const role = st.lastEliminated.role;
    body += `<h2>${t('eliminated', { name: elim?.nickname || '?' })}</h2>`;
    body += `<p>${role === 'undercover' ? t('wasUndercover') : role === 'blank' ? t('wasBlank') : t('wasCivilian')}</p>`;
    if (role !== 'undercover' && st.lastEliminated.word) body += `<p>${t('yourWord')}: ${esc(lang() === 'zh' ? st.lastEliminated.word : (st.lastEliminated.wordEn || st.lastEliminated.word))}</p>`;
    if (st.winnerSide === 'undercover') body += `<p>${t('undercoverWins')}</p>`;
    if (st.winnerSide) {
      if (st.pair) body += `<p>${t('wordPairWas', { a: lang() === 'zh' ? st.pair.zh_a : st.pair.en_a, b: lang() === 'zh' ? st.pair.zh_b : st.pair.en_b })}</p>`;
      body += `<p>${t('undercoverWas', { name: (view.players.find((p) => p.id === st.undercoverId) || {}).nickname || '?' })}</p>`;
    }
    body += `<ul>${Object.entries(st.roundDeltas || {}).map(([pid, n]) => { const p = view.players.find((x) => x.id === pid); return `<li>${esc(p?.nickname || '?')} +${n}</li>`; }).join('')}</ul>`;
    body += `<h3>${t('leaderboard')}</h3>${leaderboard()}`;
    body += isHost ? `<button class="primary" data-action="advance">${st.winnerSide ? t('finish') : t('next')}</button>` : `<p>${t('waitingHost')}</p>`;
  }
  return `<header><button class="lang" data-action="toggle-lang">${lang() === 'zh' ? 'EN' : '中文'}</button></header>
  <h1>${gameName('undercover')}</h1>${body}<p class="stuck">${t('hardRefresh')}</p>${errLine()}`;
}
function aliveWordPlayers() { return view.players.filter((p) => p.alive && !p.is_judge); }

// --- Roast ---
function roastHtml() {
  const st = view.state;
  const isHost = view.me && view.me.is_host;
  let body = '';
  if (st.phase === 'writing') {
    body += `<h2>${t('writeRoast')}</h2>`;
    if (st.myRoastsIn) body += `<p>${t('submitted')}</p>`;
    else {
      body += view.players.filter((p) => p.id !== view.me?.id).map((p) => `<label>${t('roastPlaceholder', { name: p.nickname })}<textarea data-roast-target="${p.id}" rows="2" maxlength="140"></textarea></label>`).join('');
      body += `<button class="primary" data-action="submit-roasts">${t('submitRoasts')}</button>`;
    }
    body += `<p>${t('roastsIn', { a: st.roastsIn, t: st.roastsTotal })}</p>`;
    body += isHost ? `<button class="primary" data-action="advance" ${st.roastsIn < st.roastsTotal ? 'disabled' : ''}>${t('next')}</button>` : `<p>${t('waitingHost')}</p>`;
  } else if (st.phase === 'guessing' && st.currentRoast) {
    const r = st.currentRoast;
    body += `<p>${t('round', { n: st.currentRoastIdx + 1, t: st.totalRoasts })}</p>`;
    body += `<h2>${t('roastTarget', { name: r.targetNickname })}</h2><blockquote>“${esc(r.text)}”</blockquote>`;
    if (r.amAuthor) body += `<p>${L('这条是你写的，你这轮旁观。', 'You wrote this one — you sit this round out.')}</p>`;
    else if (st.myGuess) body += `<p>${t('submitted')}</p>`;
    else {
      body += `<fieldset><legend>${t('whoWrote')}</legend>${view.players.filter((p) => p.id !== view.me?.id).map((p) => `<label><input type="radio" name="roast-author" value="${p.id}"> ${esc(p.nickname)}</label>`).join('')}</fieldset>
      <button class="primary" data-action="submit-roast-guess">${t('submitGuess')}</button>`;
    }
    body += `<p>${t('waitingGuesses')} ${st.guessesCount} / ${st.guessersTotal}</p>`;
    body += isHost ? `<button class="primary" data-action="advance">${t('reveal')}</button>` : '';
  } else if (st.phase === 'reveal' && st.roundDetail) {
    const d = st.roundDetail;
    const author = view.players.find((p) => p.id === d.roast.authorId);
    body += `<h2>${t('reveal')}</h2><blockquote>“${esc(d.roast.text)}”</blockquote>`;
    body += `<p>${t('authorWas', { name: author?.nickname || '?' })}</p>`;
    body += `<p>${t('fooled', { n: d.fooled, p: d.fooled * 50 })}</p>`;
    body += `<h3>${t('leaderboard')}</h3>${leaderboard()}`;
    body += isHost ? `<button class="primary" data-action="advance">${st.currentRoastIdx >= st.totalRoasts - 1 ? t('finish') : t('nextRound')}</button>` : `<p>${t('waitingHost')}</p>`;
  }
  return `<header><button class="lang" data-action="toggle-lang">${lang() === 'zh' ? 'EN' : '中文'}</button></header>
  <h1>${gameName('roast')}</h1>${body}<p class="stuck">${t('hardRefresh')}</p>${errLine()}`;
}
