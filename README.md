# Glomere Games — standalone site

Live party games for any get-together 🎉 / 聚会实时小游戏 🎉

A re-implementation of the Glomere Games Muse artifact (`glomere-games`, v9)
as a deployable static site: **Vercel frontend + Supabase backend**, no
accounts, no download — host creates a room, gets a 4-letter PIN, guests join
with PIN + nickname.

> The artifact's code could not be exported, so this was built from the spec
> and the artifact's published server-action contract. The artifact itself,
> glomere.tech, and Dream a Dream were not touched.

## Games

| Game | How it plays |
|---|---|
| **Party Mix** | 8 rounds per game — 3 Would You Rather + 3 Most Likely To + 2 trivia, randomly drawn. 25s per round, live leaderboard. Judge mode: the judge rotates in join order, writes questions live, decides points (+100 per round run). |
| **Truth · Wish · Lie** | Each player writes one truth, one wish, one lie. Nobody guesses until every trio is in ("trios in" counter). Correct author + lie = +300; the author earns +50 per fooled guesser. |
| **Who Is the Undercover （谁是卧底）** | Min 4 players; 6+ adds one blank player (no word). One undercover gets a close-but-different word. One-line clues, then vote. +100 for voting the undercover, +200 to surviving civilians on a civilian win, +300 to a winning undercover. Judge mode: the host is judge for the whole game — writes the word pair (+100), deals words, runs clue/vote rounds; holds no word, never describes/votes, can't be voted out. Needs 5 in the room (4 word-players + judge). |
| **不准红温 (No Blushing)** | Everyone anonymously writes one playful roast of every other player. Roasts are read out one by one — target named, author secret — and the room guesses who wrote each. +200 for naming the author, +50 to the author per fooled guesser. Play-again resets cleanly. |

Shared rules: Chinese-first, per-phone 中文/EN toggle (default Chinese,
persisted per phone in `localStorage`); **player-written lines are never
translated**. Clients poll room state every 1 second; the database is the
source of truth — if scores look stuck, the UI says to hard-refresh.

### Scoring details (Party Mix)

- Would You Rather: +100 for voting with the majority side.
- Most Likely To: +100 for voting for the most-voted player; that player gets
  a +200 crown bonus.
- Trivia: +100 correct, +50 if answered within 10s of the round opening.

## Files

```
index.html                  App shell (loads js/app.js as a module)
css/app.css                 Glomere theme (cream / #F2B83B / #DE4F7E)
js/app.js                   UI shell: home -> lobby -> game -> podium, 1s polling
js/api.js                   The 14-action API contract + mock & Supabase backends
js/games.js                 Pure game rules (scoring, dealing, vote tally)
js/bots.js                  Mock-player driver (host-client bot simulation)
js/i18n.js                  UI copy (zh/en); player-written lines never translated
data/party-mix.json         36 Party Mix prompts (expansion bank)
data/undercover-pairs.json  28 Undercover word pairs (10 expansion + 18 authored for V0)
supabase/migrations/001_games.sql   rooms / players / submissions + RLS + indexes
config.example.js           Copy to config.js and fill in to go live
deploy_games.py             Vercel deploy (upload by sha1, then create_deployment)
tests/test-games.mjs        End-to-end tests against the mock backend (85 checks)
```

**Every file is under 90KB raw** — a hard constraint, because the Vercel
deploy path uploads each file base64-encoded in a single CLI argument (OS
limit 128KB). `deploy_games.py` refuses to deploy if any file exceeds 90KB:
split the file, do not raise the limit.

## API contract

The 14 actions mirror the artifact's published server actions (same names,
same semantics). `js/api.js` exposes them as `GamesAPI.*`:

`createRoom, joinRoom, leaveRoom, addBots, removeBot, startGame, advanceGame,
getRoomState, submitAnswer, submitDescription, submitJudgeWords,
submitJudgeQuestion, submitStatements, submitRoasts`

- `advanceGame` — the host advances: question → reveal scoring → next round /
  finish; `action: 'playAgain'` resets to a clean lobby.
- `getRoomState` — full live state for polling, filtered per player: a player
  sees only their own secret word, never other players' words, trio authors,
  or roast authors until the reveal shows them.

Note: `artifact.list_actions` was not available to the builder subagent (the
artifact toolset here only exposes restore/share/unshare), so the contract
was mirrored from the task spec and the design history in the Glomere Event
App side chat — not from live action schemas. If any action's real request
shape differs, `js/api.js` is the one place to adjust.

## Architecture

```
browser (static, Vercel)  --1s poll / REST-->  Supabase Postgres
  js/api.js: GamesAPI            rooms / players / submissions (PostgREST)
  js/games.js: rules (one place)       RLS: anon read/write, PIN-gated
  js/bots.js: bot driver               by obscurity (same model as artifact)
```

- **Mock backend (default):** no Supabase configured → in-memory +
  `localStorage` (`glomere-games-mock-v1`), single device. Two tabs on the
  same machine can play together (state is re-read from `localStorage` on
  every call). The UI is fully testable with zero setup.
- **Supabase backend:** when `window.GAMES_CONFIG` has `supabaseUrl` +
  `anonKey` (via `config.js`), the same rule engine runs client-side and
  persists through PostgREST. **v1 limits:** last-write-wins on `rooms.state`
  if two phones write at once (host-driven transitions minimize this); and
  secrets are hidden by the UI's per-player view, not by the database — the
  anon role can read the tables. A v2 edge function should enforce
  per-player views server-side before this is used beyond trusted friends.

## Known gap — the original question bank

The ORIGINAL bank — **18 Party Mix prompts + 18 original Undercover pairs** —
lives only inside the Muse artifact and is not in any file. This build ships
only the expansion content from
`~/workspace/goals/glomere-games-multiplayer-games/hidden_files/party-mix-bank-expansion.md`:

- 36 Party Mix prompts (12 Would You Rather + 12 Most Likely To + 12 trivia
  with the given answers; **trivia distractors were authored for this build**
  — plausible wrong options, not from the expansion file)
- 28 Undercover pairs (10 from the expansion bank + 18 authored for V0 in the
  same close-pair style; skipped 滑雪/滑冰, already live; skipped 啤酒/红酒,
  duplicates the existing Beer/Wine pair; also avoided the known existing
  火锅/烧烤, 苹果/梨, 咖啡/茶). The artifact's original 18 pairs are locked
  inside the artifact and could not be extracted, so these 18 are new.

With 36 prompts and 8 used per game, repeats start after ~4–5 games instead
of 2–3. **Before going live, add the original 18 + 18** (transcribe them from
the artifact's live bank, de-duplicated against `data/*.json`) to reach
54 prompts / 28 pairs. The banks are plain JSON — just append entries.

## V0 scope (2026-11-21)

Home offers **only Who Is the Undercover** — the other three games' code stays
in the directory for later, and the judge toggle is hidden. Judge mode and the
other games come after the V0 deploy proves out.

## Live acceptance test (2026-11-21, PASSED 18/18)

`tests/test-live-supabase.mjs` plays a full 4-player Undercover round through
the real Supabase backend (create room -> PIN join -> words dealt -> clues ->
vote -> reveal -> finish): exactly 1 undercover, per-player views hide other
words, civilians score 300 (+100 vote, +200 win), undercover 0, room finishes,
test room deleted afterwards. Run it with `node tests/test-live-supabase.mjs`
(it reads the Supabase URL/key from `config.js`). Mock suite still passes
85/85 (`node tests/test-games.mjs`).

## Bot limitation

There is no server process in v1, so mock players are a **host-client
simulation**: the host's browser drives every bot action through the same
public API a human uses, on staggered timers (`js/bots.js`, `tickBots`).
If the host's tab closes or loses network, the bots stop acting. Bots count
toward player minimums and play all four games (canned Chinese/English lines;
votes are random, slightly biased away from themselves).

## Test locally

```bash
cd ~/workspace/glomere-games-deploy
python3 -m http.server 8471
# open http://localhost:8471 — mock mode, no Supabase needed.
# Create a room, add +3 bots, play a full round of each game.
```

Automated end-to-end tests (mock backend, no server):

```bash
node --check js/app.js js/api.js js/games.js js/bots.js js/i18n.js
node tests/test-games.mjs   # 85 checks: full games, scoring, secrecy, minimums, play-again
```

Verified 2026-11-21: `node --check` clean on all JS; `node
tests/test-games.mjs` **85 passed, 0 failed** (3 consecutive runs); all
assets return HTTP 200 from `python3 -m http.server`. Walked through all
four games end to end against the mock backend: Party Mix full 8 rounds
(trivia +150 verified), Party Mix judge rotation, bot driver tick, TWL
(+300 / +50 scoring, author hidden until reveal), Undercover civilian win
(+100 vote / +200 survival), wrong-vote continuation + undercover win at 2
left, judge mode (5 players, +100 pair bonus, judge holds no word and can't
vote), Roast (+200 / +50, 6 roasts, play-again reset).

**Not verified without live services:** multi-phone sync over Supabase
(1s polling across real devices), the Supabase adapter's PostgREST calls
against a real project (code-reviewed only, no live project exists yet),
and the Vercel deploy script end to end (not run — no Vercel project yet).
The Saturday-morning two-phone check still applies before real use.

## Go live (V0 — Git-connected Vercel project)

The Vercel MCP deploy path (`deploy_games.py`: `upload_file` +
`create_deployment`) is **blocked as of 2026-11-21**: after the Vercel
connector was reconnected, its token lost team scope and every call 403s on
`lujinglucyxis-projects` — including `upload_file`, which does not touch any
project. Do not retry it until team scope is restored. The live path is
Git-connected Vercel instead:

1. **Create the GitHub repo** `LujingLucyXi/glomere-games` (public, empty —
   the connector's `create_repository` is 403, so create it on github.com).
2. **Push this directory** (the connector's `push_files`, or a Mac git
   push). `config.js` and `deploy-refs.json` are git-ignored — never commit
   a real Supabase key. `vercel.json` + `build.sh` generate `config.js` at
   build time from env vars (below).
3. **Create the Vercel project** in the dashboard: Add New → Project →
   Import `glomere-games`. Set Environment Variables:
   `SUPABASE_URL` = `https://jlvlmuyegirglbyrnfbl.supabase.co`,
   `SUPABASE_ANON_KEY` = the project's publishable key. Deploy.
4. **Supabase tables**: run `supabase/migrations/001_games.sql` in the
   Dashboard (SQL Editor → New query → paste → Run). It creates `rooms`,
   `players`, `submissions` + anon RLS policies. (Done 2026-11-21 for the
   Glomere project — verify with
   `GET /rest/v1/rooms?select=id&limit=1` returning `200 []`, not
   `Could not find the table 'public.rooms'`.)
5. **Add the domain** `games.glomere.tech` to the Vercel project
   (dashboard → Domains; DNS: CNAME to `cname.vercel-dns.com`, or follow
   Vercel's domain instructions) and verify: create a room on one phone,
   join from a second phone with the PIN, play one full round of Who Is the
   Undercover and confirm both phones see the same state without refreshing.

### V0 fixes landed 2026-11-21 (not in the artifact)

- **Schema fix**: the migration has no `players.word_en` column, but the
  client sent it — PostgREST rejected every player write (`PGRST204`).
  `js/api.js` now strips `word_en` on write and derives the English word
  on read from the pair (civilians hold `zh_a`, undercover `zh_b`).
- **Config path fix**: `api.js` imported `./config.js` (resolved to
  `js/config.js`, which does not exist) so the site silently stayed in
  mock mode. It now imports `../config.js` (site root).
- **Undercover-only trim**: home offers only Who Is the Undercover; the
  judge toggle is hidden. The other three games' code stays in the repo
  for later.
- **Word bank**: 28 pairs (`data/undercover-pairs.json` v0-2026-11-21) —
  10 from the expansion file + 18 authored for V0 in the same style.
- **Tests**: `node tests/test-games.mjs` — 85 passed, 0 failed (mock
  backend; `GamesAPI.init({ forceMock: true })` so the suite stays on mock
  even with `config.js` present).
