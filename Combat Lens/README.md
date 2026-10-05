# GSIV Combat Lens

Two things live here:

1. **Live dashboard** — `combat_dashboard.html` (open in a browser) + `combatlens.lic` (Lich bridge). Real-time combat awareness during a hunt. See `PROJECT_HANDOFF.md`.
2. **Offline analysis CLI** — `lens.js` + `lens-core.js`. Node tool for forensic queries over finished `.xml` logs. This is what you point at a log to answer "what actually happened."

The dashboard and the CLI share their state-parsing rules through `lens-core.js` (one source of truth).

---

## Offline CLI — requirements

- Node.js (v18+; tested on v22).
- Your Lich XML logs, in the usual tree: `…/logs/GSIV-<Char>/<year>/<month>/<file>.xml`.

Set the log root once (either edit `DEFAULT_ROOT` at the top of `lens.js`, or pass `--root`, or set the `GSIV_LOGS` environment variable). On this machine the root is:

```
E:\Games\Other\Gemstone\Ruby4Lich5\R4LInstall\Lich5.12.12\logs
```

## Commands

### index — what logs exist, and their exact time spans
```
node lens.js index --char Kyrandos
node lens.js index                 # all characters
node lens.js index --json          # machine-readable
```
Lists every log file per character with its start → end time. Use this first so "which log / what timeframe" is never guessed.

### window — reconstruct second-by-second state around a moment
```
node lens.js window --char Kyrandos --at 17:39:23 --date 2026-08-05 --before 90 --after 10
node lens.js window --char Kyrandos --at 17:39:23 --file "…\2026-08-05_17-12-24.xml"
node lens.js window --char Kyrandos --at 17:39:23 --before 60 --json
```
Prints each meaningful event in the window with the player's live state attached:

```
TIME      HP    POS/flags        [tag]     event text
17:38:09  97%   PRONE rt10       [MOVE]    Momentum carries the dreadsteed northward, dragging you painfully behind it!
17:39:19  14%   PRONE STUNNED rt17 [STUN]  You are stunned for 3 rounds!
17:39:23  -4%   PRONE rt13       [KILL]    ... your neck bones snap and your body goes limp!
17:39:23  -4%   PRONE rt13       [DEATH]   It seems you have died, my friend...
```

- **HP** — from minivitals (can go negative on the killing blow; that's real overkill).
- **POS/flags** — position (PRONE/KNEELING/SITTING), STUNNED, and `rtN` = roundtime seconds remaining (from `<roundTime>` end vs. the prompt clock).
- **[tag]** — highlights: `[MOVE]` forced relocation, `[POS]` posture change, `[STUN]`, `[RT]` roundtime, `[KILL]` finisher, `[DISARM]`, `[DEATH]`.

Flags:
- `--before N` / `--after N` — window seconds (default 30 / 15).
- `--date YYYY-MM-DD` — narrows which session file to search (otherwise it finds the file covering `--at`).
- `--file PATH` — use an explicit log file.
- `--all` — include room/inventory/noise lines (off by default).
- `--json` — structured output for further processing.

## Notes / limits
- The CLI reads the **rich `.xml` logs** (per-line timestamps + tags), not the cleaned `.log` files.
- `index` reads only each file's head/tail, so it's fast even over a full history.
- Parsing rules live in `lens-core.js`. When GS adds a new message we care about (a new disarm phrasing, a new finisher), fix it there and both the CLI and the dashboard benefit.
- Roundtime remaining is approximate between prompt ticks.

## Next commands on the roadmap
`deaths` (every death: killing blow, HP trajectory, room, foes), `disarms` (weapon-leaving-hand events), `combat-summary` (per-fight offense/defense). All will reuse `lens-core.js`.
