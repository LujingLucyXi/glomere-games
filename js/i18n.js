// i18n.js — UI copy for Glomere Games. Chinese-first, per-phone toggle.
// Player-written lines (truths, clues, roasts) are NEVER translated: they are
// data, not UI strings, and pass through untouched in both languages.
export const LANGS = ['zh', 'en'];
export const DEFAULT_LANG = 'zh';
const KEY = 'glomere-games-lang';

export function getLang() {
  try {
    const v = (typeof localStorage !== 'undefined' && localStorage.getItem(KEY)) || '';
    return LANGS.includes(v) ? v : DEFAULT_LANG;
  } catch (_) { return DEFAULT_LANG; }
}
export function setLang(lang) {
  if (!LANGS.includes(lang)) return;
  try { localStorage.setItem(KEY, lang); } catch (_) {}
  if (typeof document !== 'undefined') document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
}

export const STR = {
  tagline: { zh: '聚会实时小游戏 🎉', en: 'Live party games for any get-together 🎉' },
  sub: { zh: '不用下载，不用注册，PIN 进房就开玩', en: 'No download, no account — join with a PIN and play' },
  createRoom: { zh: '创建房间', en: 'Create a room' },
  joinRoom: { zh: '加入房间', en: 'Join a room' },
  yourName: { zh: '你的昵称', en: 'Your nickname' },
  roomPin: { zh: '房间 PIN', en: 'Room PIN' },
  pickGame: { zh: '选一个游戏', en: 'Pick a game' },
  judgeMode: { zh: '裁判模式', en: 'Judge mode' },
  judgeModeParty: { zh: '每轮换一位裁判，裁判现场出题、定分', en: 'Judge rotates each round; the judge writes questions live and decides points' },
  judgeModeUnder: { zh: '主持人当全场裁判：写词对、发词、主持描述和投票，不拿词、不投票', en: 'Host is judge for the whole game: writes the word pair, deals words, runs clue and vote rounds. No word, no vote.' },
  startGame: { zh: '开始游戏', en: 'Start game' },
  lobby: { zh: '大厅', en: 'Lobby' },
  players: { zh: '玩家', en: 'Players' },
  addBots: { zh: '加 mock 玩家', en: 'Add mock players' },
  bot: { zh: '机器人', en: 'BOT' },
  host: { zh: '主持人', en: 'Host' },
  judge: { zh: '裁判', en: 'Judge' },
  waitingHost: { zh: '等主持人开始…', en: 'Waiting for the host to start…' },
  leaveRoom: { zh: '离开房间', en: 'Leave room' },
  hardRefresh: { zh: '分数不动？硬刷新一下，数据库才是真相。', en: 'Scores stuck? Hard-refresh — the database is the source of truth.' },
  round: { zh: '第 {n} / {t} 轮', en: 'Round {n} of {t}' },
  secondsLeft: { zh: '还剩 {n} 秒', en: '{n}s left' },
  waitingAnswers: { zh: '已答 {a} / {t}', en: 'Answered {a} / {t}' },
  reveal: { zh: '揭晓', en: 'Reveal' },
  nextRound: { zh: '下一轮', en: 'Next round' },
  next: { zh: '继续', en: 'Continue' },
  finish: { zh: '看最终排名', en: 'See final standings' },
  playAgain: { zh: '再玩一局', en: 'Play again' },
  backLobby: { zh: '回大厅', en: 'Back to lobby' },
  leaderboard: { zh: '排行榜', en: 'Leaderboard' },
  points: { zh: '{n} 分', en: '{n} pts' },
  you: { zh: '你', en: 'You' },
  yourWord: { zh: '你的词', en: 'Your word' },
  noWord: { zh: '你是空白牌，没有词，靠编也要混过去！', en: 'You are the blank — no word. Bluff your way through!' },
  undercoverWord: { zh: '你是卧底，你的词是', en: 'You are the undercover. Your word is' },
  writeClue: { zh: '写一句关于你的词的提示（别直接说出词）', en: 'Write a one-line clue about your word (don’t say the word itself)' },
  cluePlaceholder: { zh: '一句话提示…', en: 'One-line clue…' },
  submitClue: { zh: '提交提示', en: 'Submit clue' },
  cluesIn: { zh: '已交提示 {a} / {t}', en: 'Clues in {a} / {t}' },
  voteOut: { zh: '投票：谁是卧底？', en: 'Vote: who is the undercover?' },
  votesIn: { zh: '已投 {a} / {t}', en: 'Votes in {a} / {t}' },
  submitVote: { zh: '投 TA 出局', en: 'Vote them out' },
  eliminated: { zh: '{name} 被投出去了', en: '{name} was voted out' },
  wasUndercover: { zh: 'TA 是卧底！平民赢了 🎉', en: 'They were the undercover! Civilians win 🎉' },
  wasCivilian: { zh: 'TA 是平民，卧底还在场上…', en: 'They were a civilian — the undercover is still out there…' },
  wasBlank: { zh: 'TA 是空白牌', en: 'They were the blank player' },
  undercoverWins: { zh: '只剩两个人了，卧底赢了 😈', en: 'Only two players left — the undercover wins 😈' },
  wordPairWas: { zh: '词对是：{a} / {b}', en: 'The word pair was: {a} / {b}' },
  undercoverWas: { zh: '卧底是 {name}', en: 'The undercover was {name}' },
  writeWordPair: { zh: '写一对相近的词（比如：珍珠奶茶 / 柠檬茶）', en: 'Write a pair of close words (e.g. Bubble tea / Lemon tea)' },
  wordA: { zh: '平民的词', en: 'Civilian word' },
  wordB: { zh: '卧底的词', en: 'Undercover word' },
  dealWords: { zh: '发词', en: 'Deal the words' },
  judgeSees: { zh: '你是裁判：平民词 {a}，卧底词 {b}，卧底是 {name}', en: 'You are the judge: civilian word {a}, undercover word {b}, undercover is {name}' },
  writeTrio: { zh: '各写一句：一个真话，一个愿望，一个谎言', en: 'Write one of each: a truth, a wish, a lie' },
  truth: { zh: '真话', en: 'Truth' },
  wish: { zh: '愿望', en: 'Wish' },
  lie: { zh: '谎言', en: 'Lie' },
  triosIn: { zh: '已交 {a} / {t} 组', en: 'Trios in {a} / {t}' },
  submitTrio: { zh: '提交', en: 'Submit' },
  guessWho: { zh: '这是谁写的？', en: 'Who wrote this?' },
  guessLie: { zh: '哪句是谎言？', en: 'Which one is the lie?' },
  submitGuess: { zh: '提交猜测', en: 'Submit guess' },
  authorWas: { zh: '作者是 {name}', en: 'Written by {name}' },
  writeRoast: { zh: '匿名吐槽：给每位其他玩家各写一句玩笑吐槽', en: 'Anonymous roast: write one playful roast for each other player' },
  roastPlaceholder: { zh: '写给 {name} 的吐槽…', en: 'Roast for {name}…' },
  submitRoasts: { zh: '提交吐槽', en: 'Submit roasts' },
  roastsIn: { zh: '已交 {a} / {t} 套', en: 'Roast sets in {a} / {t}' },
  roastTarget: { zh: '吐槽对象：{name}', en: 'Roast target: {name}' },
  whoWrote: { zh: '这是谁写的？', en: 'Who wrote this?' },
  judgeWriting: { zh: '裁判正在出题…', en: 'The judge is writing a question…' },
  writeQuestion: { zh: '你是本轮裁判，现场出一道题', en: 'You are this round’s judge — write a question live' },
  qType: { zh: '题型', en: 'Question type' },
  qText: { zh: '题目', en: 'Question' },
  qOptions: { zh: '选项（每行一个）', en: 'Options (one per line)' },
  qCorrect: { zh: '正确答案是第几个选项', en: 'Which option is correct' },
  sendQuestion: { zh: '发给全场', en: 'Send to the room' },
  needPlayers: { zh: '人数不够：{game} 至少需要 {n} 人', en: 'Not enough players: {game} needs at least {n}' },
  needPlayersJudge: { zh: '裁判模式需要 {n} 人（{m} 位玩家 + 裁判）', en: 'Judge mode needs {n} people ({m} players + the judge)' },
  pinCopied: { zh: 'PIN 已复制', en: 'PIN copied' },
  createFirst: { zh: '先输入昵称', en: 'Enter a nickname first' },
  pinFirst: { zh: '输入 4 位 PIN', en: 'Enter the 4-letter PIN' },
  error: { zh: '出错了：{m}', en: 'Error: {m}' },
  mockMode: { zh: '本地测试模式（未接 Supabase，单机）', en: 'Local test mode (no Supabase connected, single device)' },
  liveMode: { zh: '已接 Supabase · 实时同步', en: 'Connected to Supabase · live sync' },
  gameParty: { zh: 'Party Mix', en: 'Party Mix' },
  gamePartyDesc: { zh: '二选一 · 最可能 · 快问快答，8 轮', en: 'Would You Rather · Most Likely To · Trivia, 8 rounds' },
  gameTwl: { zh: '真话 · 愿望 · 谎言', en: 'Truth · Wish · Lie' },
  gameTwlDesc: { zh: '每人写一组，猜作者 + 猜谎言', en: 'Everyone writes a trio; guess the author and the lie' },
  gameUnder: { zh: '谁是卧底', en: 'Who Is the Undercover' },
  gameUnderDesc: { zh: '每人一个秘密词，找出卧底', en: 'Everyone gets a secret word — find the undercover' },
  gameRoast: { zh: '不准红温', en: 'No Blushing' },
  gameRoastDesc: { zh: '匿名吐槽全场，猜猜是谁写的', en: 'Anonymous roasts for everyone — guess who wrote each' },
  waitingClues: { zh: '等大家交提示…', en: 'Waiting for clues…' },
  waitingVotes: { zh: '等大家投票…', en: 'Waiting for votes…' },
  waitingGuesses: { zh: '等大家猜…', en: 'Waiting for guesses…' },
  waitingRoasts: { zh: '等大家写吐槽…', en: 'Waiting for roasts…' },
  submitted: { zh: '已提交 ✓', en: 'Submitted ✓' },
  describeRound: { zh: '描述轮', en: 'Describe round' },
  voteRound: { zh: '投票轮', en: 'Vote round' },
  correct: { zh: '答对了！', en: 'Correct!' },
  wrong: { zh: '答错了', en: 'Wrong' },
  majority: { zh: '多数人选了', en: 'The majority picked' },
  mostVoted: { zh: '得票最多', en: 'Most voted' },
  crownBonus: { zh: '👑 得票王 +200', en: '👑 Most-voted +200' },
  fooled: { zh: '蒙对了 {n} 个人 +{p}', en: 'Fooled {n} people +{p}' },
  votePoints: { zh: '投中卧底 +100', en: 'Voted the undercover +100' },
  surviveBonus: { zh: '平民胜利 +200', en: 'Civilians win +200' },
  underWinBonus: { zh: '卧底胜利 +300', en: 'Undercover wins +300' },
  judgeBonus: { zh: '出题 +100', en: 'Set the pair +100' },
  finalStandings: { zh: '最终排名', en: 'Final standings' },
  winner: { zh: '🏆 冠军', en: '🏆 Winner' },
};

export function t(key, vars) {
  const lang = getLang();
  const entry = STR[key];
  if (!entry) return key;
  let s = entry[lang] ?? entry.zh ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
