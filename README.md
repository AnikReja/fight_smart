# FightSmart

A keyboard-driven boxing film study app for reviewing sparring footage and scouting opponents.
Built with React + TypeScript (Vite). Runs entirely in your browser; videos never leave your computer.

> **Status:** manual annotation and analytics in the app. Computer vision experiments (pose estimation, fighter tracking, punch detection) live in [`cv/`](cv/README.md) with measured results; punch detection is **not** accurate enough to ship yet.

## Features

- **Fast tagging:** punches, defense, and mistakes for **You** (green) or **Opponent** (blue), one key per action
- **Punch outcomes:** mark the last punch landed / blocked / missed (`Q` / `W` / `E`); accuracy is computed only over punches with a known outcome
- **Precise review:** frame stepping, ±1s / ±5s seeking, 0.25×–2× playback, timestamps to 0.1s
- **Rounds:** mark round start/end while watching (`N` / `⇧N`), jump between rounds, filter stats and tags per round
- **Edit tags:** time, action, fighter, outcome, and note; undo the last tag with `Z`
- **Combination suggestions:** punches by the same fighter within 1.5s are suggested as combos for you to confirm or reject; if the punches change after review, the combo is flagged for re-review instead of silently losing your decision
- **Per-fighter analytics:** punch and defense breakdowns, accuracy, most frequent confirmed combos
- **Pattern analytics (scouting):** repeated action sequences, what a fighter does after each action, and how the other fighter responds within 1s. Every number links to the moments it came from, and patterns with fewer than 5 examples are flagged as small samples
- **Import / export:** versioned JSON (schema v2) with tags, combo decisions, and rounds; imports also accept files from older versions and merge without deleting anything

## Run it

Requires Node.js 20.19+ (or 22.12+).

```bash
npm install
npm run dev        # start the app (http://localhost:5173)
npm test           # unit tests (Vitest)
npm run build      # type-check + production build
```

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `1` / `2` | Tag as You / Opponent |
| `J` `C` `H` `U` `F` | Jab, Cross, Hook, Uppercut, Feint |
| `S` `R` `B` `K` `P` `L` `T` | Slip, Roll, Block, Catch, Parry, Pull back, Step back |
| `M` / `O` | Mistake / Other |
| `Q` / `W` / `E` | Last punch landed / blocked / missed |
| `Z` | Undo last tag |
| `Space` | Play / pause |
| `←` `→` (with `⇧`) | Seek 5s (1s) |
| `,` / `.` | Previous / next frame (assumes 30 fps) |
| `[` / `]` | Slower / faster |
| `N` / `⇧N` | Start / end round |

Shortcuts are ignored while typing in a text field.

## Project structure

```
src/
  App.tsx                 # State, persistence, keyboard shortcuts, layout
  components/             # TagPad, TimelineStrip, RoundBar, TagList (+ editor), CombinationList, StatsPanel, PatternsPanel, ShortcutGuide
  lib/                    # Pure, unit-tested logic (no React)
    combinations.ts       #   combo detection + review matching
    stats.ts              #   per-fighter statistics and accuracy
    patterns.ts           #   sequence mining, follow-ups, responses, evidence-backed insights
    rounds.ts             #   round numbering, lookup, start/end
    dataFile.ts           #   versioned import/export, validation, merge
    storage.ts            #   localStorage layout
    *.test.ts             #   Vitest tests
```

## Data and privacy

- Videos are played from your disk with a temporary browser URL; they are never uploaded.
- Tags are saved in browser `localStorage`, keyed by the video's filename, size, and modified time. Reselect the same unmodified file after a refresh to restore them.
- Clearing browser data deletes saved tags. Use **Export JSON** as a backup.
- Only analyze footage you have permission to use, and don't commit sparring videos to a public repository (`.gitignore` excludes common video formats).

## Roadmap

1. ~~Tested logic modules, combo review fix~~
2. ~~Versioned import/export~~
3. ~~Tag editing, frame stepping, precise timestamps~~
4. ~~Rounds and punch outcomes~~
5. ~~Computer vision spike: pose estimation, fighter tracking, measured on local hardware~~ (see [cv/README.md](cv/README.md))
6. ~~Punch-candidate detection, evaluated against manual tags~~: not reliable yet (held-out F1 0.09 gym camera, 0.28 on 1080p footage)
7. FastAPI + SQLite backend for sessions across multiple videos
8. ~~Pattern analytics with evidence links~~ (scouting report export next)
