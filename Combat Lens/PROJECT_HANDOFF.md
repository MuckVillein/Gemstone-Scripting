# GSIV Combat Lens — Project Handoff

Hand this to a fresh session with the two code files and it can continue with no context loss.
Project home: `E:\Creative\Games\Gemstone 4\Combat Lens\`

---

## 1. What this is

A real-time combat situational-awareness tool for **GemStone IV** (a text MUD). In big group battles the game feed is a firehose; the app distills it into an at-a-glance dashboard: vitals, posture, hands/readiness, status effects, offense/defense effectiveness, enemy state, and an AI tactical read.

User (Kyrandos / "eric") plays via **Lich 5** (Ruby) on Windows and dual-boxes a second character, **Elmilrion** (dwarf warrior). Logs live under
`E:\Games\Other\Gemstone\Ruby4Lich5\R4LInstall\Lich5.12.12\logs\GSIV-<Char>\<year>\<month>\`
as both `.log` (cleaned text) and `.xml` (full tagged stream).

Reference sources for game mechanics: GSWiki (https://gswiki.play.net), the official "blue tracker" (https://blue-tracker.elanthia.online — treat as authoritative), player forums/Discord (cross-check).

---

## 2. Key insight

The `.log` file is the **cleaned text** — structured data is stripped. The `.xml` log (and Lich's live downstream) carries machine-readable tags: exact vitals (`<dialogData id='minivitals'>`), hands (`<left>`/`<right>`), stance, position (`<indicator id='IconPRONE' visible='y'/>` etc.), roundtime (`<roundTime>`), and per-line timestamps. So: tap the XML for self-state; parse flavor text only for the combat narrative.

**Ally vitals are NOT broadcast to you.** Ally HP only fills if everyone shares vitals over Lich's LNet. What *is* observable for allies is **status** (stunned/prone/webbed/…), inferred from combat text — the dashboard does this.

---

## 3. Files

| File | What it is |
|---|---|
| `combat_dashboard.html` | The app. Open in a browser. Replay mode + Live mode + AI. Self-contained, no build step. |
| `combatlens.lic` | Lich 5 Ruby bridge. Put in Lich `scripts/`, run `;combatlens`. Hooks the XML downstream + runs a minimal WebSocket server on `ws://127.0.0.1:8777`, pushing `{"t":"line"}` (combat text) and `{"t":"state"}` (vitals/hands/stance/status from `XMLData`). |
| `PROJECT_HANDOFF.md` | This doc. |

### Run it
- **Replay:** open the HTML, Load log (accepts `.log`/`.txt`/`.xml` — XML tags are stripped on load), "First combat", Play.
- **Live:** `;combatlens` in game, then click "Live" in the dashboard.
- **AI:** paste a Claude API key in AI settings. Continuous tactician runs during combat (default 15s, pauses when idle) on a cheap online model or local Ollama (toggle). The on-demand button uses a premium model (default `claude-sonnet-5`).

---

## 4. Log-format cheat-sheet (implemented in the parser)

- **Vitals:** `Health: 270/270     Mana: 191/191     Stamina: 151/151     Spirit: 10/10`
- **Outgoing weapon:** `AS: +498 vs DS: +237 with AvD: +26 + d100 roll: +42 = +319` then `... and hit for 70 points of damage!`
- **Incoming weapon:** same `AS ... vs DS ...` then `... and hits for 10 points of damage!` — **"hit for" = you hit (out); "hits for" = you were hit (in)**. Load-bearing grammar distinction.
- **Offensive spell:** `CS: +426 - TD: +360 + CvA: +25 + d100: +58 == +149` then `Warding failed!` (landed) or `Warded off!` (resisted).
- **Maneuver:** `[SMR result: 142 (Open d100: 73, Bonus: 6)]` then `... N points of damage!`.
- **Enemy stun/knockdown:** `The gold-bristled hinterboar is stunned!` / `It is knocked to the ground!`
- **Enemy death (varies):** `collapses to the ground, dead` / `goes still` / `last hint of life goes out` / `sinks to the ground as its form goes still`.
- **Targeting:** `You are now targeting an immense gold-bristled hinterboar.`
- **Group:** `You are grouped with Tijay who is leading and Vivina.` / `Elmilrion joins your group.`
- **Gear:** `You remove a wretched forged spear ... from in your weapons harness.` / `You put ... in ...`.
- **Posture:** `You kneel down.` / `You stand back up.` / `You fall flat on the ground!`
- **Enemy-name gotcha:** creatures are targeted by full name ("immense gold-bristled hinterboar") but referenced loosely ("the hinterboar"). Parser tracks a **token = last word** and matches on that. Don't regress.

### Forced-movement / hard-CC mechanics learned from real deaths (important for "why didn't I flee")
- **Dreadsteed charge:** `barrels into you at full speed! ... Momentum carries the dreadsteed northward, dragging you painfully behind it!` — a forced room relocation + knockdown + roundtime. You do NOT choose to enter; you're dragged, arriving prone with a roundtime.
- **Grotesque Stone Fist:** an enormous stone hand grabs and holds you (hold + debuff).
- **Grotesque wing-gust:** `Your arms are forced down to your sides!` + roundtime.
- **Ghast swiftkick:** `delivers a well placed kick!` → ~10s roundtime.
- **Ghast finisher:** `grabs you by the head and twists violently ... *CRACK* ... your body goes limp!` — instant-kill neck-snap.
- **Banshee mist wall / cacophonous shout:** AoE; can land a save-or-die **frozen-neck-snap** crit even at full HP.
- Roundtimes **chain** (they don't stack additively); prone independently blocks fleeing until you stand (a ~4–9s RT that can be re-interrupted). "Not stunned" ≠ "able to flee."

---

## 5. Dashboard internals

Single file, vanilla JS. `freshState()` holds the whole state. `parseLine(raw)` is the regex dispatcher (order matters: ally-status check runs before enemy-stun so ally names aren't miscounted). Item classification: `SHIELD_RE`/`WEAPON_RE`/`classifyItem` (supports weapon, shield, runestaff, bow, held item, barehanded). Render: `towerCell` (vitals), `figureSVG` (posture pictogram), `miniStatus` (pills). Replay engine, live WebSocket client (`connectLive`/`applyState`), AI (`buildPayload`/`callClaude`/`callOllama`/`aiRead`/`runContinuousTick`).

### Visual design (after several iterations with the user)
- **Vitals = "towers"**: vertical bars in a horizontal strip (≥4 fit, scroll for more). Self shows 4 bars H/M/St/Sp; **allies show 1 HP bar + status pills** (M/St/Sp aren't observable). Colors: Health `#d64550`, Mana `#4f8bd6`, **Stamina yellow `#e6c84c`**, **Spirit grey-white `#d7dbe0`**.
- **Posture = restroom-sign silhouette** in 4 poses (standing arms-down / kneeling seiza / sitting reclined / prone propped), gold=standing, amber=kneeling/sitting, red=prone. (Sitting/prone poses may still want visual tuning.)
- **Status pills**: STN/PRN/WEB/BLD/CLM/DIS/PSN/DED.

---

## 6. AI layer (user's spec)
- Always-on local **heuristics** drive the suggestion box (zero cost).
- **Continuous AI Tactician** runs on a timer during combat, pauses when idle; backend = cheap online model OR local Ollama (toggle).
- **On-demand button** always uses a premium online model (Sonnet/Opus).
- Payloads are compact JSON snapshots (~20 events), never raw log text. Anthropic called direct from browser with `anthropic-dangerous-direct-browser-access: true`.

**"Training the model on GemStone" — decided direction:** fine-tuning is NOT viable (as of 2026 Anthropic exposes no API fine-tuning; only Claude 3 Haiku SFT on Amazon Bedrock — weaker than needed). The real path is **retrieval (RAG) + a GemStone knowledge base**, not retraining: a curated glossary of message patterns, maneuver/roundtime tables, CC/forced-move mechanics (see §4), and the user's builds, injected into the prompt at question time. It compounds — every mechanic documented while analyzing logs becomes a permanent retrievable entry. This knowledge base is the shared asset across the dashboard, the bridge, and offline analysis.

---

## 7. Known issues / caveats (BE HONEST)
1. **Not run headless** — parser verified by inspection/tracing against real logs, not execution (the build sandbox was down: `HYPERVISOR_VIRT_DISABLED`). First task in a new session: load real logs in replay and watch the feed/tallies end-to-end.
2. **Bridge XMLData method names** (`max_health`, `stance_text`, `roundtime_end`, `GameObj.left_hand`) need one in-game shakeout; they vary across Lich versions.
3. **Combat direction attribution** is heuristic; solid for weapon hit/hits grammar and marked procs, fuzzier for bare ticks in chaotic swarms.
4. **Ally status** is text-inferred; unusual recovery phrasings may leave a pill stuck — extend the ally-status regex block.
5. **Sitting/prone figures** may need tuning.
6. **Browser→Anthropic CORS** relies on the dangerous-direct-browser-access header; if blocked, a tiny local proxy is needed.

---

## 8. Backlog / next steps
1. **Offline log-analysis tool** (the newest direction): a deterministic parser/CLI that answers forensic queries over finished logs — `index` (chars/files/time-spans, so "newest log" is never wrong), `deaths` (killing blow, HP trajectory, room, foes, weapon/shield state), `disarms` (weapon-leaving-hand events), `window` (parsed second-by-second state around a moment: position/stun/RT/HP), `combat-summary`. Should **share the parsing rules** with the dashboard (one source of truth) rather than being a third independent parser. Emits JSON read as ground truth and cited from.
2. **GemStone knowledge base** (RAG) — see §6.
3. **LNet ally-vitals sharing** so ally HP bars fill.
4. **HP-threshold tinting** (bars go amber/red as HP drops).
5. Run the parser end-to-end; add a Node/Python test harness over real logs as regression tests.

---

## 9. Working style (user)
- Concise, direct; minimal fluff.
- Iterates on visuals via rendered previews, then targeted "change X" feedback.
- **Demands rigor on log reading:** full contiguous reads, exact timestamps, evidence cited, and **inferences explicitly marked as inferences** — never state an inference as fact. (This standard came from real analysis errors; honor it.)
- Re-glob for newest files before answering anything about "latest"; confirm which character's log you're in (POV, max health, hand items) before attributing.
