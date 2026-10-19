import { useEffect, useRef, useState } from 'react';


type Fighter = 'you' | 'opponent';

type Tag = {
  id: string;
  time: number;
  label: string;
  note: string;
  fighter?: Fighter;
};

const ACTION_GROUPS = {
  Punches: ['Jab', 'Cross', 'Hook', 'Uppercut', 'Feint'],
  Defense: ['Slip', 'Roll', 'Block', 'Catch', 'Parry', 'Pull back', 'Step back'],
  Other: ['Mistake', 'Other'],
};
const stamp = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

const ACTION_SHORTCUTS: Record<string, string> = {
  j: "Jab",
  c: "Cross",
  h: "Hook",
  u: "Uppercut",
  f: "Feint",
  s: "Slip",
  r: "Roll",
  b: "Block",
  k: "Catch",
  p: "Parry",
  m: "Mistake",
};

const PUNCHES = new Set([
  'Jab', 'Cross', 'Hook', 'Uppercut'
]);


type ReviewStatus = 'confirmed' | 'rejected';

type Combination = {
  id: string;
  fighter: 'you' | 'opponent';
  punches: string[];
  start: number;
  end: number;
};

function detectCombinations(tags: Tag[]): Combination[] {
  const results: Combination[] = [];
  const MAX_GAP = 1.5;

  for (const fighter of ['you', 'opponent'] as const) {
    const events = tags
      .filter(t =>
        t.fighter === fighter && PUNCHES.has(t.label)
      )
      .sort((a, b) => a.time - b.time);

    let sequence: Tag[] = [];

    function finishSequence() {
      if (sequence.length < 2) return;

      results.push({
        id: `${fighter}:${sequence.map(t => t.id).join(':')}`,
        fighter,
        punches: sequence.map(t => t.label),
        start: sequence[0].time,
        end: sequence[sequence.length - 1].time
      });
    }

    for (const event of events) {
      const previous = sequence[sequence.length - 1];

      if (previous && event.time - previous.time > MAX_GAP) {
        finishSequence();
        sequence = [];
      }

      sequence.push(event);
    }

    finishSequence();
  }

  return results.sort((a, b) => a.start - b.start);
}


export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [storageKey, setStorageKey] = useState('');
  const [tags, setTags] = useState<Tag[]>([]);
  const [reviews, setReviews] = useState<
    Record<string, ReviewStatus>
  >({});
  const [label, setLabel] = useState('Jab');
  const [fighter, setFighter] = useState<Fighter>('you');
  const [note, setNote] = useState('');
  const [speed, setSpeed] = useState(1);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);  
  const combinations = detectCombinations(tags);


  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  function confirmTag(message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(''), 2200);
  }

  function loadVideo(file?: File) {
    if (!file) return;
    if (file.type && !file.type.startsWith('video/')) { alert('Please select a video file.'); return; }
    const key = `corneriq:tags:${file.name}:${file.size}:${file.lastModified}`;
    setStorageKey(key);
    setFileName(file.name);
    setVideoUrl(URL.createObjectURL(file));
    setSpeed(1);
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '[]') as Tag[];
      setTags(Array.isArray(saved) ? saved : []);
    } catch { setTags([]); }

try {
  const savedReviews = JSON.parse(
    localStorage.getItem(`${key}:reviews`) || '{}'
  );

  setReviews(
    savedReviews &&
    typeof savedReviews === 'object' &&
    !Array.isArray(savedReviews)
      ? savedReviews
      : {}
  );
} catch {
  setReviews({});
}

  }

  function save(next: Tag[]) {
    setTags(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); }
    catch { alert('Browser storage is unavailable. Tags will not persist after refresh.'); }
  }



function addTag(action = label) {
  const v = videoRef.current;
  if (!v || !storageKey) return;

  const t: Tag = {
    id: crypto.randomUUID(),
    time: v.currentTime,
    label: action,
    note: note.trim(),
    fighter: fighter
  };

  save([...tags, t].sort((a, b) => a.time - b.time));

  setNote('');

  const fighterName =
    fighter === 'you' ? 'You' : 'Opponent';

  confirmTag(
    `${fighterName}: ${action} tagged at ${stamp(t.time)}`
  );
}


useEffect(() => {
  function handleKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;

    // Ignore shortcuts when typing into a form.
    if (
      target?.closest(
        "input, textarea, select, [contenteditable]"
      )
    ) return;

    // Don't interfere with browser shortcuts.
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.repeat
    ) return;

if (event.key === '1') {
  event.preventDefault();
  setFighter('you');
  return;
}

if (event.key === '2') {
  event.preventDefault();
  setFighter('opponent');
  return;
}

const video = videoRef.current;

// Spacebar: Play / Pause
if (event.code === 'Space') {
  if (!video) return;

  event.preventDefault();

  if (video.paused) {
    void video.play().catch(() => {
      console.log('Unable to play video');
    });
  } else {
    video.pause();
  }

  return;
}

// Left Arrow: Rewind 5 seconds
if (event.key === 'ArrowLeft') {
  if (!video) return;

  event.preventDefault();
  seek(video.currentTime - 5);
  return;
}

// Right Arrow: Forward 5 seconds
if (event.key === 'ArrowRight') {
  if (!video) return;

  event.preventDefault();
  seek(video.currentTime + 5);
  return;
}

    const action =
      ACTION_SHORTCUTS[event.key.toLowerCase()];

    if (!action) return;

    event.preventDefault();
    addTag(action);
  }

  window.addEventListener("keydown", handleKeyDown);

  return () => {
    window.removeEventListener("keydown", handleKeyDown);
  };
});

  function seek(seconds: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(Number.isFinite(v.duration) ? v.duration : Infinity, seconds));
  }

  function changeSpeed(next: number) {
    setSpeed(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
  }

function reviewCombination(
  id: string,
  decision: ReviewStatus | null
) {
  if (!storageKey) return;

  setReviews(previous => {
    const updated = { ...previous };

    if (decision === null) {
      delete updated[id];
    } else {
      updated[id] = decision;
    }

    try {
      localStorage.setItem(
        `${storageKey}:reviews`,
        JSON.stringify(updated)
      );
    } catch {
      alert('Could not save combination review.');
    }

    return updated;
  });
}

  function exportTags() {
    const data = JSON.stringify({ videoName: fileName, tags }, null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fileName.replace(/\.[^/.]+$/, '') || 'sparring'}-tags.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <div className="shell">
    <div className="toast" role="status" aria-live="polite" aria-atomic="true" data-visible={Boolean(toast)}>{toast ? `✓ ${toast}` : ""}</div>
    <header><div className="brand">◈ CORNER<span>IQ</span></div><div className="subtle">Boxing film study • Session 01</div></header>
    <main>
      <section className="intro"><p className="eyebrow">YOUR FILM. YOUR INSIGHTS.</p><h1>Study the moments that matter.</h1><p>Load a sparring video, review it at your pace, and mark anything worth revisiting.</p></section>
      <div className="columns">
        <section className="panel">
          <div className="panelTitle"><h2>Film review</h2><span className="subtle">Local video only</span></div>
          {!videoUrl ? <label className="drop"> <span className="uploadIcon">↑</span><strong>Choose your sparring video</strong><span>MP4, WebM, or other browser-supported format</span><input type="file" accept="video/*" onChange={e => loadVideo(e.target.files?.[0])}/></label>
            : <><div className="videoFrame"><video key={videoUrl} ref={videoRef} src={videoUrl} controls playsInline onLoadedMetadata={() => changeSpeed(1)}/></div><div className="filename">{fileName}</div></>}
          <div className="controls"><button disabled={!videoUrl} onClick={() => seek((videoRef.current?.currentTime ?? 0) - 5)}>↶ 5 sec</button><label>Playback <select value={speed} disabled={!videoUrl} onChange={e => changeSpeed(Number(e.target.value))}><option value={0.5}>0.5×</option><option value={0.75}>0.75×</option><option value={1}>1×</option><option value={1.5}>1.5×</option></select></label><label className="fileButton">Change video<input type="file" accept="video/*" onChange={e => loadVideo(e.target.files?.[0])}/></label></div>
          <div className="divider"/>

<details className="shortcutPanel" open>
  <summary>⌨ Keyboard Shortcuts</summary>

  <div className="shortcutGrid">
    <div>
      <h4>Fighter</h4>
      <p>You <kbd>1</kbd></p>
      <p>Opponent <kbd>2</kbd></p>

      <h4>Defense</h4>
      <p>Slip <kbd>S</kbd></p>
      <p>Roll <kbd>R</kbd></p>
      <p>Block <kbd>B</kbd></p>
      <p>Catch <kbd>K</kbd></p>
      <p>Parry <kbd>P</kbd></p>
    </div>

    <div>
      <h4>Punches</h4>
      <p>Jab <kbd>J</kbd></p>
      <p>Cross <kbd>C</kbd></p>
      <p>Hook <kbd>H</kbd></p>
      <p>Uppercut <kbd>U</kbd></p>
      <p>Feint <kbd>F</kbd></p>

      <h4>Other</h4>
      <p>Mistake <kbd>M</kbd></p>

<h4>Video Controls</h4>

<p>
  Play / Pause <kbd>Space</kbd>
</p>

<p>
  Rewind 5 sec <kbd>←</kbd>
</p>

<p>
  Forward 5 sec <kbd>→</kbd>
</p>
 
    </div>
  </div>

  <p className="shortcutHint">
    Shortcuts work when you're not typing in a text field.
  </p>
</details>

          <h2>Tag a moment</h2>
<div className="fighterSelector">
  <span className="fighterLabel">
    Who performed the action?
  </span>

  <div className="fighterButtons">
    <button
      type="button"
      className={fighter === 'you' ? 'fighterActive' : ''}
      aria-pressed={fighter === 'you'}
      onClick={() => setFighter('you')}
    >
      You
    </button>

    <button
      type="button"
      className={fighter === 'opponent' ? 'fighterActive' : ''}
      aria-pressed={fighter === 'opponent'}
      onClick={() => setFighter('opponent')}
    >
      Opponent
    </button>
  </div>
</div>
<div className="tagForm"><label>Action<select value={label} onChange={e => setLabel(e.target.value)}>{Object.entries(ACTION_GROUPS).map(([group, actions]) => <optgroup key={group} label={group}>{actions.map(action => <option key={action} value={action}>{action}</option>)}</optgroup>)}</select></label><label>Note (optional)<input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. right hand drops after jab" onKeyDown={e => { if (e.key === 'Enter') addTag(); }}/></label>
<button
  className="primary"
  disabled={!videoUrl}
  onClick={() => addTag()}
>
  + Save timestamp
</button></div>
        </section>
        <aside className="panel"><div className="panelTitle"><h2>Tagged moments</h2><strong className="count">{tags.length}</strong></div><p className="hint">Click a timestamp to jump to that moment in your video.</p>
          {tags.length === 0 ? <div className="empty">Your event timeline starts here.<br/>Play a video and add your first tag.</div> : <div className="events">{tags.map(tag => <div className="event" key={tag.id}><button className="timestamp" onClick={() => seek(tag.time)}>{stamp(tag.time)} ▶</button><div className="eventText">
<strong>
  {tag.fighter === 'you'
    ? 'You'
    : tag.fighter === 'opponent'
      ? 'Opponent'
      : 'Unassigned'}
  {' • '}
  {tag.label}
</strong>
{tag.note && <p>{tag.note}</p>}</div><button className="delete" title="Delete tag" aria-label={`Delete ${tag.label} at ${stamp(tag.time)}`} onClick={() => save(tags.filter(x => x.id !== tag.id))}>×</button></div>)}</div>}
          

<div className="combinationSection">
  <h3>🥊 Potential Combinations</h3>

  {combinations.length === 0 ? (
    <p className="hint">
      Tag consecutive punches to discover combinations.
    </p>
  ) : (
    <div className="combinationList">
      {combinations.map(combo => {
        const status = reviews[combo.id];

        return (
          <div
            key={combo.id}
            className="combinationCard"
          >
            <div className="comboHeader">
              <span className="comboFighter">
                {combo.fighter === 'you'
                  ? 'You'
                  : 'Opponent'}
              </span>

              <span className={`reviewBadge ${status || 'pending'}`}>
                {status === 'confirmed'
                  ? '✓ Confirmed'
                  : status === 'rejected'
                    ? '✕ Rejected'
                    : 'Needs review'}
              </span>
            </div>

            <strong>
              {combo.punches.join(' → ')}
            </strong>

            <button
              type="button"
              className="comboTime"
              onClick={() => seek(combo.start)}
            >
              ▶ Review at {stamp(combo.start)}
            </button>

            <div className="reviewButtons">
              <button
                type="button"
                className="confirmButton"
                aria-pressed={status === 'confirmed'}
                onClick={() =>
                  reviewCombination(combo.id, 'confirmed')
                }
              >
                ✓ Confirm
              </button>

              <button
                type="button"
                className="rejectButton"
                aria-pressed={status === 'rejected'}
                onClick={() =>
                  reviewCombination(combo.id, 'rejected')
                }
              >
                ✕ Reject
              </button>
            </div>

            {status && (
              <button
                type="button"
                className="undoReview"
                onClick={() =>
                  reviewCombination(combo.id, null)
                }
              >
                Undo decision
              </button>
            )}
          </div>
        );
      })}
    </div>
  )}
</div>
<button className="export" disabled={!tags.length} onClick={exportTags}>↓ Export tags as JSON</button><p className="privacy">Videos stay on your device. Tags are saved in this browser, and can be exported. Re-select the same file to restore its tags.</p>
        </aside>
      </div>
    </main><footer>CornerIQ • First iteration • No AI claims, just useful film study.</footer>
  </div>;
}
