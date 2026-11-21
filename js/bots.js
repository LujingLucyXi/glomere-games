// bots.js — mock-player (bot) driver for Glomere Games.
//
// LIMITATION (see README): v1 has no server process, so bots are a
// HOST-CLIENT SIMULATION. The host's browser drives every bot action through
// the same public API a human uses, on staggered timers. If the host's tab
// closes or loses network, the bots stop acting. Bots count toward player
// minimums and play every game: they answer, write clues, vote, write trios
// and roasts, and guess.
//
// The driver is deliberately dumb: bots pick at random (votes slightly biased
// away from themselves) and write from small canned line banks. Player-written
// bot lines are canned Chinese/English one-liners, never translated.

import { GamesAPI } from './api.js';

export const BOT_NAMES = ['Momo 🐼', 'Kiki 🐰', 'Dudu 🐶', 'Lulu 🦄', 'BaoBao 🐸', 'Nana 🍓', 'Toto 🥑', 'Pipi 🍕'];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const delay = (min, max) => min + Math.random() * (max - min);

const CLUES = [
  '天天都能见到它', '我小时候就喜欢', '圆圆的', '热乎乎的才好吃', '出门常常用到',
  '要花钱买', '颜色挺好看的', '跟朋友一起才有意思', '我家附近就有', '有点难形容',
  '软软的', '脆脆的', '香香的', '冬天更想吃', '夏天更想吃', '离不开它',
];
const TRUTHS = ['我爬墙第一次就摔了个屁股墩', '我会做一手好红烧肉', '我曾经在机场睡过一夜', '我怕黑，但假装不怕', '我收集过十年的车票', '我滑雪摔断过一根登山杖'];
const WISHES = ['我想去冰岛看极光', '我想开一家自己的小咖啡馆', '我想学会冲浪', '我想环游世界一年', '我想养一只金毛', '我想住在海边'];
const LIES = ['我会说五种语言', '我跑过全程马拉松', '我见过外星人', '我是国家级厨师', '我一夜没睡还能爬 V8', '我从来不吃甜食'];
const ROASTS = [
  '{t} 笑起来像偷吃成功的猫', '{t} 拍照永远只发同一角度', '{t} 说“我五分钟就到”的时候至少还要半小时',
  '{t} 的歌单里全是 2015 年的歌', '{t} 爬墙喊得比谁都大声，爬得比谁都慢', '{t} 手机电量永远低于 20%',
  '{t} 是群里撤回消息次数最多的人', '{t} 吃饭拍照比吃饭认真', '{t} 的“随便”其实一点都不随便',
  '{t} 一喝多就开始讲人生道理', '{t} 出门必带三根充电线', '{t} 是全场最会点菜的人，没有之一',
];

// Per-bot timers, kept in the host tab only.
const botTimers = new Map(); // botId -> timestamp (ms) when it may act next

function ready(botId, minMs = 1500, maxMs = 6000) {
  const at = botTimers.get(botId) || 0;
  if (Date.now() < at) return false;
  botTimers.set(botId, Date.now() + delay(minMs, maxMs));
  return true;
}
export function resetBotTimers() { botTimers.clear(); }

function others(view, botId) { return view.players.filter((p) => p.id !== botId); }
function aliveOthers(view, botId) { return view.players.filter((p) => p.id !== botId && p.alive && !p.is_judge); }

async function botAnswerParty(view, bot) {
  // NOTE: getRoomState is per-player, so the bot's own answer state is only
  // visible when polling AS the bot. The driver re-reads state as the bot
  // before acting, so this check is authoritative.
  const { view: bv } = await GamesAPI.getRoomState({ roomId: view.room.id, playerId: bot.id });
  const st = bv.state;
  if (bv.room.status !== 'playing' || st.phase !== 'question' || !st.round) return;
  if (st.myAnswer) return;
  const round = st.round;
  if (round.type === 'mlt') {
    const targets = bv.players.filter((p) => p.id !== bot.id);
    await GamesAPI.submitAnswer({ roomId: bv.room.id, playerId: bot.id, roundNo: bv.room.current_round, choice: pick(targets).id });
  } else {
    const n = (round.options && round.options.length) || 2;
    await GamesAPI.submitAnswer({ roomId: bv.room.id, playerId: bot.id, roundNo: bv.room.current_round, choice: Math.floor(Math.random() * n) });
  }
}

async function botJudgeParty(view, bot) {
  const { view: bv } = await GamesAPI.getRoomState({ roomId: view.room.id, playerId: bot.id });
  if (bv.room.status !== 'playing' || bv.state.phase !== 'judge_writing' || bv.state.judgeId !== bot.id) return;
  const type = pick(['wyr', 'mlt', 'trivia']);
  if (type === 'wyr') {
    await GamesAPI.submitJudgeQuestion({ roomId: bv.room.id, playerId: bot.id, question: { type, text: '宁愿一辈子只爬 V0，还是只吃白人饭？', options: ['只爬 V0', '只吃白人饭'] } });
  } else if (type === 'mlt') {
    await GamesAPI.submitJudgeQuestion({ roomId: bv.room.id, playerId: bot.id, question: { type, text: '谁最可能在聚会里第一个喝多？' } });
  } else {
    await GamesAPI.submitJudgeQuestion({ roomId: bv.room.id, playerId: bot.id, question: { type, text: '太空针塔有多高？', options: ['约 505 英尺', '约 605 英尺', '约 705 英尺', '约 805 英尺'], correct: 1 } });
  }
}

async function botTwl(view, bot) {
  const { view: bv } = await GamesAPI.getRoomState({ roomId: view.room.id, playerId: bot.id });
  const st = bv.state;
  if (bv.room.status !== 'playing') return;
  if (st.phase === 'writing' && !st.myTrioIn) {
    await GamesAPI.submitStatements({ roomId: bv.room.id, playerId: bot.id, truth: pick(TRUTHS), wish: pick(WISHES), lie: pick(LIES) });
  } else if (st.phase === 'guessing' && st.currentTrio && !st.myGuess) {
    const author = pick(others(bv, bot.id));
    await GamesAPI.submitAnswer({ roomId: bv.room.id, playerId: bot.id, roundNo: bv.room.current_round, choice: { author: author.id, lie: Math.floor(Math.random() * 3) } });
  }
}

async function botUndercover(view, bot) {
  const { view: bv } = await GamesAPI.getRoomState({ roomId: view.room.id, playerId: bot.id });
  const st = bv.state;
  if (bv.room.status !== 'playing') return;
  const me = bv.players.find((p) => p.id === bot.id);
  if (!me || !me.alive || me.is_judge) return;
  if (st.phase === 'describe' && !st.myClue) {
    await GamesAPI.submitDescription({ roomId: bv.room.id, playerId: bot.id, text: pick(CLUES) });
  } else if (st.phase === 'vote' && st.myVote == null) {
    const targets = aliveOthers(bv, bot.id);
    if (targets.length) await GamesAPI.submitAnswer({ roomId: bv.room.id, playerId: bot.id, roundNo: st.roundNo, choice: pick(targets).id });
  }
}

async function botRoast(view, bot) {
  const { view: bv } = await GamesAPI.getRoomState({ roomId: view.room.id, playerId: bot.id });
  const st = bv.state;
  if (bv.room.status !== 'playing') return;
  if (st.phase === 'writing' && !st.myRoastsIn) {
    const roasts = others(bv, bot.id).map((p) => ({ targetId: p.id, text: pick(ROASTS).replace('{t}', p.nickname) }));
    await GamesAPI.submitRoasts({ roomId: bv.room.id, playerId: bot.id, roasts });
  } else if (st.phase === 'guessing' && st.currentRoast && !st.myGuess) {
    const author = pick(others(bv, bot.id));
    await GamesAPI.submitAnswer({ roomId: bv.room.id, playerId: bot.id, roundNo: st.currentRoastIdx, choice: author.id });
  }
}

// One driver tick: called by the host tab on an interval (see app.js).
// view = the host's current room view. Only acts for bots in the room.
export async function tickBots(view) {
  if (!view || !view.me || !view.me.is_host) return;
  const bots = view.players.filter((p) => p.is_bot);
  for (const bot of bots) {
    try {
      if (!ready(bot.id)) continue;
      if (view.room.status !== 'playing') continue;
      const game = view.room.game;
      if (game === 'party') {
        if (view.room.judge_mode && view.state.judgeId === bot.id && view.state.phase === 'judge_writing') await botJudgeParty(view, bot);
        else await botAnswerParty(view, bot);
      } else if (game === 'twl') await botTwl(view, bot);
      else if (game === 'undercover') await botUndercover(view, bot);
      else if (game === 'roast') await botRoast(view, bot);
    } catch (e) {
      // A bot failing one action (e.g. phase moved on) is not fatal; the
      // next tick retries. Never let a bot error break the host UI.
      // console.debug('bot action failed', bot.nickname, e.message);
    }
  }
}
