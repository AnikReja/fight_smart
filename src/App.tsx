import { useEffect, useRef, useState } from 'react';

type Tag = { id: string; time: number; label: string; note: string };
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

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [storageKey, setStorageKey] = useState('');
  const [tags, setTags] = useState<Tag[]>([]);
  const [label, setLabel] = useState('Jab');
  const [note, setNote] = useState('');
  const [speed, setSpeed] = useState(1);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    note: note.trim()
  };

  save([...tags, t].sort((a, b) => a.time - b.time));

  setNote('');
  confirmTag(`${action} tagged at ${stamp(t.time)}`);
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
          <h2>Tag a moment</h2><div className="tagForm"><label>Action<select value={label} onChange={e => setLabel(e.target.value)}>{Object.entries(ACTION_GROUPS).map(([group, actions]) => <optgroup key={group} label={group}>{actions.map(action => <option key={action} value={action}>{action}</option>)}</optgroup>)}</select></label><label>Note (optional)<input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. right hand drops after jab" onKeyDown={e => { if (e.key === 'Enter') addTag(); }}/></label>
<button
  className="primary"
  disabled={!videoUrl}
  onClick={() => addTag()}
>
  + Save timestamp
</button></div>
        </section>
        <aside className="panel"><div className="panelTitle"><h2>Tagged moments</h2><strong className="count">{tags.length}</strong></div><p className="hint">Click a timestamp to jump to that moment in your video.</p>
          {tags.length === 0 ? <div className="empty">Your event timeline starts here.<br/>Play a video and add your first tag.</div> : <div className="events">{tags.map(tag => <div className="event" key={tag.id}><button className="timestamp" onClick={() => seek(tag.time)}>{stamp(tag.time)} ▶</button><div className="eventText"><strong>{tag.label}</strong>{tag.note && <p>{tag.note}</p>}</div><button className="delete" title="Delete tag" aria-label={`Delete ${tag.label} at ${stamp(tag.time)}`} onClick={() => save(tags.filter(x => x.id !== tag.id))}>×</button></div>)}</div>}
          <button className="export" disabled={!tags.length} onClick={exportTags}>↓ Export tags as JSON</button><p className="privacy">Videos stay on your device. Tags are saved in this browser, and can be exported. Re-select the same file to restore its tags.</p>
        </aside>
      </div>
    </main><footer>CornerIQ • First iteration • No AI claims, just useful film study.</footer>
  </div>;
}
