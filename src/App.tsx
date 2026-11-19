import { useEffect, useRef, useState } from 'react';
import { CombinationList } from './components/CombinationList';
import { PatternsPanel } from './components/PatternsPanel';
import { RoundBar } from './components/RoundBar';
import { ShortcutGuide } from './components/ShortcutGuide';
import { StatsPanel } from './components/StatsPanel';
import { TagList } from './components/TagList';
import { TagPad } from './components/TagPad';
import { TimelineStrip } from './components/TimelineStrip';
import { ACTION_SHORTCUTS, FRAME_SECONDS, OUTCOME_SHORTCUTS, PUNCHES, SPEEDS } from './lib/actions';
import { applyReview, detectCombinations, resolveReview } from './lib/combinations';
import { buildExport, mergeData, parseImport } from './lib/dataFile';
import { stampPrecise } from './lib/format';
import { endRound, inRound, numberRounds, roundAt, startRound } from './lib/rounds';
import type { NumberedRound } from './lib/rounds';
import { computeFighterStats } from './lib/stats';
import { loadVideoData, saveField, videoStorageKey } from './lib/storage';
import type { Combination, Fighter, Outcome, ReviewStatus, Reviews, Round, Tag } from './lib/types';

const fighterName = (f: Fighter) => (f === 'you' ? 'You' : 'Opponent');

type SideTab = 'tags' | 'combos' | 'stats' | 'patterns';

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [storageKey, setStorageKey] = useState('');
  const [tags, setTags] = useState<Tag[]>([]);
  const [reviews, setReviews] = useState<Reviews>({});
  const [rounds, setRounds] = useState<Round[]>([]);
  const [fighter, setFighter] = useState<Fighter>('you');
  const [note, setNote] = useState('');
  const [speed, setSpeed] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(true);
  const [sideTab, setSideTab] = useState<SideTab>('tags');
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [selectedRound, setSelectedRound] = useState<number | null>(null);
  const [statsFighter, setStatsFighter] = useState<Fighter>('you');
  const [patternFighter, setPatternFighter] = useState<Fighter>('opponent');
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Most recently added tag, for the outcome (Q/W/E) and undo (Z) shortcuts. */
  const lastTagId = useRef<string | null>(null);

  // Derived data. Cheap at this scale (hundreds of tags), so recomputed each render.
  const numbered = numberRounds(rounds);
  const combinations = detectCombinations(tags);
  const visibleTags = inRound(tags, rounds, selectedRound, t => t.time);
  const visibleCombos = inRound(combinations, rounds, selectedRound, c => c.start);
  const stats = computeFighterStats(visibleTags, visibleCombos, reviews, statsFighter);
  const currentRound = roundAt(rounds, currentTime);
  const pendingCombos = visibleCombos.filter(c => {
    const { state } = resolveReview(c, reviews);
    return state === 'pending' || state === 'changed';
  }).length;
  const lastTag = tags.find(t => t.id === lastTagId.current) ?? null;

  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  function notify(message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(''), 2200);
  }

  // ---- Persistence -------------------------------------------------------

  const storageWarning = () => notify('⚠ Browser storage is unavailable. Export JSON to keep your work.');

  function updateTags(next: Tag[]) {
    setTags(next);
    if (!saveField(storageKey, 'tags', next)) storageWarning();
  }
  function updateReviews(next: Reviews) {
    setReviews(next);
    if (!saveField(storageKey, 'reviews', next)) storageWarning();
  }
  function updateRounds(next: Round[]) {
    setRounds(next);
    if (!saveField(storageKey, 'rounds', next)) storageWarning();
  }

  function loadVideo(file?: File) {
    if (!file) return;
    if (file.type && !file.type.startsWith('video/')) { alert('Please select a video file.'); return; }
    const key = videoStorageKey(file);
    const data = loadVideoData(key);
    setStorageKey(key);
    setFileName(file.name);
    setVideoUrl(URL.createObjectURL(file));
    setSpeed(1);
    setCurrentTime(0);
    setDuration(0);
    setPaused(true);
    setSelectedRound(null);
    setTags(data.tags);
    setReviews(data.reviews);
    setRounds(data.rounds);
    lastTagId.current = null;
  }

  // ---- Video control -----------------------------------------------------

  const now = () => videoRef.current?.currentTime ?? 0;

  function seek(seconds: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(Number.isFinite(v.duration) ? v.duration : Infinity, seconds));
    setCurrentTime(v.currentTime);
  }

  function stepFrames(frames: number) {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    seek(v.currentTime + frames * FRAME_SECONDS);
  }

  function changeSpeed(next: number) {
    setSpeed(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
  }

  function nudgeSpeed(direction: 1 | -1) {
    const index = SPEEDS.indexOf(speed as (typeof SPEEDS)[number]);
    const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (index === -1 ? 3 : index) + direction))];
    changeSpeed(next);
    notify(`Playback ${next}×`);
  }

  // ---- Tagging -----------------------------------------------------------

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => notify('Unable to play video'));
    else v.pause();
  }

  function addTag(action: string) {
    if (!videoRef.current || !storageKey) return;
    const t: Tag = { id: crypto.randomUUID(), time: now(), label: action, note: note.trim(), fighter };
    updateTags([...tags, t].sort((a, b) => a.time - b.time));
    lastTagId.current = t.id;
    setNote('');
    notify(`${fighterName(fighter)}: ${action} tagged at ${stampPrecise(t.time)}`);
  }

  function updateTag(next: Tag) {
    updateTags(tags.map(t => (t.id === next.id ? next : t)).sort((a, b) => a.time - b.time));
    notify(`Updated ${next.label} at ${stampPrecise(next.time)}`);
  }

  function deleteTag(tag: Tag) {
    updateTags(tags.filter(t => t.id !== tag.id));
    if (lastTagId.current === tag.id) lastTagId.current = null;
  }

  function setLastOutcome(outcome: Outcome) {
    const last = tags.find(t => t.id === lastTagId.current);
    if (!last) { notify('Tag a punch first, then press Q / W / E'); return; }
    if (!PUNCHES.has(last.label)) { notify(`Outcomes apply to punches, not ${last.label}`); return; }
    updateTags(tags.map(t => (t.id === last.id ? { ...t, outcome } : t)));
    notify(`${last.label} at ${stampPrecise(last.time)} → ${outcome}`);
  }

  function undoLastTag() {
    const last = tags.find(t => t.id === lastTagId.current);
    if (!last) { notify('Nothing to undo'); return; }
    deleteTag(last);
    notify(`Removed ${last.label} at ${stampPrecise(last.time)}`);
  }

  function reviewCombination(combo: Combination, decision: ReviewStatus | null) {
    if (!storageKey) return;
    updateReviews(applyReview(reviews, combo, decision));
  }

  // ---- Rounds ------------------------------------------------------------

  function startRoundHere() {
    if (!storageKey) return;
    const next = startRound(rounds, now(), crypto.randomUUID());
    if (next === rounds) { notify('A round already starts here'); return; }
    updateRounds(next);
    notify(`Round ${roundAt(next, now())} started at ${stampPrecise(now())}`);
  }

  function endRoundHere() {
    const next = endRound(rounds, now());
    if (next === rounds) { notify('Not inside a round'); return; }
    notify(`Round ${roundAt(rounds, now())} ended at ${stampPrecise(now())}`);
    updateRounds(next);
  }

  function selectRound(round: NumberedRound | null) {
    setSelectedRound(round ? round.number : null);
    if (round) seek(round.start);
  }

  function deleteRound(round: NumberedRound) {
    if (!confirm(`Delete round ${round.number}? Its tags are kept.`)) return;
    updateRounds(rounds.filter(r => r.id !== round.id));
    setSelectedRound(null);
  }

  // ---- Import / export ---------------------------------------------------

  function exportData() {
    const data = JSON.stringify(buildExport(fileName, { tags, reviews, rounds }), null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fileName.replace(/\.[^/.]+$/, '') || 'sparring'}-fightsmart.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importData(file?: File) {
    if (!file) return;
    if (!storageKey) { alert('Load the matching video first, then import its tags.'); return; }
    let result;
    try {
      result = parseImport(await file.text());
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not read that file.');
      return;
    }
    if (result.videoName && result.videoName !== fileName &&
        !confirm(`This file was exported from "${result.videoName}", but the loaded video is "${fileName}". Import anyway?`)) return;
    const merged = mergeData({ tags, reviews, rounds }, result);
    updateTags(merged.tags);
    updateReviews(merged.reviews);
    updateRounds(merged.rounds);
    notify(`Imported ${merged.addedTags} new and ${merged.updatedTags} updated tags` +
      (result.skipped ? ` · skipped ${result.skipped} invalid items` : ''));
  }

  // ---- Keyboard ----------------------------------------------------------

  function handleKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable]')) return; // typing in a form
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return; // browser shortcuts
    if (showShortcuts) return; // the dialog handles its own keys (Esc)
    if (event.key === '?' || (event.key === '/' && event.shiftKey)) { event.preventDefault(); setShowShortcuts(true); return; }
    const video = videoRef.current;
    const key = event.key.toLowerCase();

    const handled = (() => {
      if (key === '1') { setFighter('you'); return true; }
      if (key === '2') { setFighter('opponent'); return true; }
      if (!video) return false;
      // When the player itself has focus, the browser's built-in controls already handle Space;
      // handling it here too would play and immediately pause (verified in Chromium).
      if (event.code === 'Space' && target === video) return false;
      if (event.code === 'Space') { togglePlay(); return true; }
      if (key === 'arrowleft') { seek(video.currentTime - (event.shiftKey ? 1 : 5)); return true; }
      if (key === 'arrowright') { seek(video.currentTime + (event.shiftKey ? 1 : 5)); return true; }
      if (key === ',') { stepFrames(-1); return true; }
      if (key === '.') { stepFrames(1); return true; }
      if (key === '[') { nudgeSpeed(-1); return true; }
      if (key === ']') { nudgeSpeed(1); return true; }
      if (key === 'n') { if (event.shiftKey) endRoundHere(); else startRoundHere(); return true; }
      if (key === 'z') { undoLastTag(); return true; }
      if (OUTCOME_SHORTCUTS[key]) { setLastOutcome(OUTCOME_SHORTCUTS[key]); return true; }
      if (ACTION_SHORTCUTS[key]) { addTag(ACTION_SHORTCUTS[key]); return true; }
      return false;
    })();
    if (handled) event.preventDefault();
  }

  // Register the listener once; the ref always points at this render's handler so it sees current state.
  const keyHandler = useRef(handleKeyDown);
  keyHandler.current = handleKeyDown;
  useEffect(() => {
    const listener = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  // ---- Render ------------------------------------------------------------

  const scopeLabel = selectedRound === null ? 'All rounds' : `Round ${selectedRound}`;
  const videoInput = <input type="file" accept="video/*" onChange={e => { loadVideo(e.target.files?.[0]); e.target.value = ''; }} />;
  const tabs: [SideTab, string, number | null][] = [['tags', 'Tags', visibleTags.length], ['combos', 'Combos', pendingCombos], ['stats', 'Stats', null], ['patterns', 'Patterns', null]];

  return <div className="app">
    <div className="toast" role="status" aria-live="polite" aria-atomic="true" data-visible={Boolean(toast)}>{toast}</div>
    <ShortcutGuide open={showShortcuts} onClose={() => setShowShortcuts(false)} />

    <header className="topbar">
      <div className="brand">FIGHT<span>SMART</span></div>
      {videoUrl && (
        <div className="session">
          <span className="filename" title={fileName}>{fileName}</span>
          <span className="clock">{stampPrecise(currentTime)}</span>
          {currentRound !== null && <span className="chip live">Round {currentRound}</span>}
        </div>
      )}
      <nav className="topActions">
        {videoUrl && <label className="ghostButton" title="Open a different video"><span className="wideOnly">Change video</span><span className="narrowOnly">Video</span>{videoInput}</label>}
        <label className={`ghostButton${videoUrl ? '' : ' disabled'}`} title="Merge tags from a FightSmart JSON file">
          Import
          <input type="file" accept="application/json,.json" disabled={!videoUrl}
            onChange={e => { void importData(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        <button type="button" className="ghostButton" disabled={!tags.length && !rounds.length} onClick={exportData}>Export</button>
        <button type="button" className="ghostButton icon" onClick={() => setShowShortcuts(true)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">⌨</button>
      </nav>
    </header>

    {!videoUrl ? (
      <main className="welcome">
        <p className="eyebrow">YOUR FILM. YOUR INSIGHTS.</p>
        <h1>Study the moments that matter.</h1>
        <p className="lede">Tag punches, defense, and rounds from your sparring footage, then see your habits and your opponent's.</p>
        <label className="drop">
          <span className="uploadIcon">↑</span>
          <strong>Choose a sparring video</strong>
          <span>MP4, WebM, or any format your browser plays · stays on this computer</span>
          {videoInput}
        </label>
        <p className="subtle">Press <kbd>?</kbd> any time for keyboard shortcuts.</p>
      </main>
    ) : (
      <main className="workspace">
        <section className="stage">
          <div className="videoFrame">
            <video key={videoUrl} ref={videoRef} src={videoUrl} controls playsInline
              onLoadedMetadata={e => { changeSpeed(1); setDuration(e.currentTarget.duration); }}
              onDurationChange={e => setDuration(e.currentTarget.duration)}
              onPlay={() => setPaused(false)} onPause={() => setPaused(true)}
              onTimeUpdate={e => setCurrentTime(e.currentTarget.currentTime)}
              onSeeked={e => setCurrentTime(e.currentTarget.currentTime)} />
          </div>

          <TimelineStrip duration={duration} currentTime={currentTime} tags={tags} rounds={numbered}
            selectedRound={selectedRound} onSeek={seek} />

          <div className="transport">
            <div className="transportButtons">
              <button type="button" onClick={() => seek(now() - 5)} title="Back 5 seconds (←)">−5s</button>
              <button type="button" onClick={() => stepFrames(-1)} title="Previous frame (,)" aria-label="Previous frame">‹</button>
              <button type="button" className="play" onClick={togglePlay} title="Play / pause (Space)">{paused ? '▶ Play' : '❚❚ Pause'}</button>
              <button type="button" onClick={() => stepFrames(1)} title="Next frame (.)" aria-label="Next frame">›</button>
              <button type="button" onClick={() => seek(now() + 5)} title="Forward 5 seconds (→)">+5s</button>
            </div>
            <div className="segmented speed" role="radiogroup" aria-label="Playback speed">
              {SPEEDS.map(s => (
                <button key={s} type="button" role="radio" aria-checked={speed === s} className={speed === s ? 'on' : ''}
                  onClick={() => changeSpeed(s)}>{s}×</button>
              ))}
            </div>
          </div>

          <RoundBar rounds={numbered} selected={selectedRound} current={currentRound} disabled={!videoUrl}
            onSelect={selectRound} onStart={startRoundHere} onEnd={endRoundHere} onDelete={deleteRound} />

          <TagPad fighter={fighter} note={note} lastTag={lastTag} disabled={!videoUrl}
            onFighterChange={setFighter} onNoteChange={setNote} onTag={addTag}
            onOutcome={setLastOutcome} onUndo={undoLastTag} />
        </section>

        <aside className="sidebar">
          <div className="tabs" role="tablist">
            {tabs.map(([id, name, n]) => (
              <button key={id} type="button" role="tab" aria-selected={sideTab === id} className={sideTab === id ? 'on' : ''}
                onClick={() => setSideTab(id)}>
                {name}{n !== null && n > 0 && <span className={`badge${id === 'combos' ? ' attention' : ''}`}>{n}</span>}
              </button>
            ))}
            {selectedRound !== null && <span className="scope tabScope">{scopeLabel}</span>}
          </div>
          <div className="tabBody">
            {sideTab === 'tags' && (
              <TagList tags={visibleTags} roundOf={t => roundAt(rounds, t)} getCurrentTime={now}
                onSeek={seek} onUpdate={updateTag} onDelete={deleteTag} />
            )}
            {sideTab === 'combos' && (
              <CombinationList combinations={visibleCombos} reviews={reviews} onSeek={seek} onReview={reviewCombination} />
            )}
            {sideTab === 'patterns' && (
              <PatternsPanel tags={visibleTags} fighter={patternFighter} scopeLabel={scopeLabel}
                onFighterChange={setPatternFighter} onSeek={seek} />
            )}
            {sideTab === 'stats' && (
              <StatsPanel stats={stats} fighter={statsFighter} scopeLabel={scopeLabel} onFighterChange={setStatsFighter} />
            )}
          </div>
          <p className="privacy">Saved in this browser only · Export to back up</p>
        </aside>
      </main>
    )}
  </div>;
}
