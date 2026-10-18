# CornerIQ — Session 1

A minimal React + TypeScript boxing film-review app. **Not an AI analyzer yet.**

## Prerequisites
- Node.js 20.19+ (or 22.12+); npm
- VS Code (recommended)

## Run it
```bash
npm install
npm run dev
```
Open the local URL shown in the terminal (usually http://localhost:5173).

## First exercise
1. Select a browser-compatible sparring video (MP4 with H.264 is a good starting point).
2. Play it; try 0.5× speed and the 5-second rewind button.
3. Tag a jab, a defensive action, and a mistake. Add useful notes.
4. Click timestamps to revisit each moment.
5. Refresh the page and reselect **the same unmodified video file** to restore annotations.
6. Export tags as JSON.

## What is stored?
- Video stays local in your browser; it is not uploaded.
- Tags are saved in browser `localStorage`, keyed by filename, size and last-modified timestamp.
- The browser cannot automatically reopen a local file after refresh; reselect the video.
- Clearing browser storage deletes saved tags. Export JSON as a backup. Import is a later feature.
- Browser storage is not encrypted, so don't include private details in tags on a shared computer.

## Simple structure
```
src/
  App.tsx       # Video player, tagging, navigation, export
  main.tsx      # React entry
  styles.css    # Layout and theme
index.html
package.json
tsconfig.json
vite.config.ts
```

## Good next tasks
- Add a way to import previously exported JSON tags.
- Add editable tag descriptions.
- Add keyboard shortcuts (but not while typing in a text field).
- Add round boundaries and stats.
- Later: FastAPI + SQLite for persistent sessions and tagged-event queries.

## Privacy / responsible use
Use video footage you have permission to store and analyze. Don't commit identifiable sparring video files to a public repository.
