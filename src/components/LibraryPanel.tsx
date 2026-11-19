import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../lib/api';
import type { Session, SessionDetail, SessionKind, VideoSummary } from '../lib/api';

type Props = {
  open: boolean;
  serverUp: boolean | null;
  currentVideo: VideoSummary | null;
  onClose: () => void;
  onVideoChanged: (video: VideoSummary) => void;
};

const today = () => new Date().toISOString().slice(0, 10);
const minutes = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '—');

/** Sessions stored by the local server: create them, open one to see its videos, and file the current video. */
export function LibraryPanel({ open, serverUp, currentVideo, onClose, onVideoChanged }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [expanded, setExpanded] = useState<SessionDetail | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({ name: '', date: today(), opponent: '', kind: 'sparring' as SessionKind });

  const refresh = useCallback(async () => {
    try {
      setSessions(await api.listSessions());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the server');
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (serverUp) void refresh();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, serverUp, refresh, onClose]);

  if (!open) return null;

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!draft.name.trim()) return;
    try {
      const s = await api.createSession({ name: draft.name.trim(), date: draft.date || null, kind: draft.kind, opponent: draft.opponent.trim() || null });
      setDraft({ name: '', date: today(), opponent: '', kind: draft.kind });
      if (currentVideo && currentVideo.session_id === null) onVideoChanged(await api.assignVideo(currentVideo.id, s.id));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the session');
    }
  }

  async function assign(sessionId: number | null) {
    if (!currentVideo) return;
    try {
      onVideoChanged(await api.assignVideo(currentVideo.id, sessionId));
      await refresh();
      if (expanded) setExpanded(await api.getSession(expanded.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not move the video');
    }
  }

  async function toggle(id: number) {
    if (expanded?.id === id) { setExpanded(null); return; }
    try { setExpanded(await api.getSession(id)); } catch (err) { setError(err instanceof Error ? err.message : 'Could not load the session'); }
  }

  async function remove(s: Session) {
    if (!confirm(`Delete session "${s.name}"? Its videos and tags are kept, just unfiled.`)) return;
    try {
      await api.deleteSession(s.id);
      if (expanded?.id === s.id) setExpanded(null);
      if (currentVideo?.session_id === s.id) onVideoChanged({ ...currentVideo, session_id: null });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the session');
    }
  }

  return (
    <div className="modalBackdrop" onClick={onClose}>
      <div className="modal library" role="dialog" aria-modal="true" aria-labelledby="libraryTitle" onClick={e => e.stopPropagation()}>
        <div className="modalHeader">
          <h2 id="libraryTitle">Library</h2>
          <button type="button" className="iconButton" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {!serverUp ? (
          <div className="serverOff">
            <p>The local library server isn't running, so tags are saved in this browser only.</p>
            <p className="subtle">Start it in a terminal from the project folder, then reopen this window:</p>
            <pre>cd server{'\n'}.venv\Scripts\python -m uvicorn fightsmart_api.main:create_app --factory --port 8000</pre>
          </div>
        ) : (
          <>
            {error && <p className="formError" role="alert">{error}</p>}

            {currentVideo && (
              <div className="currentVideo">
                <span className="subtle">This video</span>
                <strong className="filename">{currentVideo.file_name}</strong>
                <label>
                  Session
                  <select value={currentVideo.session_id ?? ''} onChange={e => void assign(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">Not filed</option>
                    {sessions.map(s => <option key={s.id} value={s.id}>{s.name}{s.date ? ` · ${s.date}` : ''}</option>)}
                  </select>
                </label>
              </div>
            )}

            <form className="newSession" onSubmit={create}>
              <input aria-label="Session name" placeholder="New session, e.g. Thursday sparring" value={draft.name}
                onChange={e => setDraft({ ...draft, name: e.target.value })} />
              <input aria-label="Date" type="date" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} />
              <input aria-label="Opponent" placeholder="Opponent" value={draft.opponent} onChange={e => setDraft({ ...draft, opponent: e.target.value })} />
              <select aria-label="Type" value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as SessionKind })}>
                <option value="sparring">Sparring</option>
                <option value="scouting">Scouting</option>
              </select>
              <button type="submit" className="primary" disabled={!draft.name.trim()}>Create</button>
            </form>
            {currentVideo?.session_id === null && <p className="subtle">A new session also files this video into it.</p>}

            {sessions.length === 0 ? (
              <div className="empty">No sessions yet. Create one above.</div>
            ) : (
              <ul className="sessionList">
                {sessions.map(s => (
                  <li key={s.id} className={`sessionRow${currentVideo?.session_id === s.id ? ' current' : ''}`}>
                    <button type="button" className="sessionMain" onClick={() => void toggle(s.id)} aria-expanded={expanded?.id === s.id}>
                      <span className={`chip kind-${s.kind}`}>{s.kind}</span>
                      <strong>{s.name}</strong>
                      <span className="subtle">{[s.date, s.opponent && `vs ${s.opponent}`].filter(Boolean).join(' · ')}</span>
                      <span className="sessionCounts mono">{s.video_count} video{s.video_count === 1 ? '' : 's'} · {s.tag_count} tags</span>
                    </button>
                    <button type="button" className="iconButton" title="Delete session" aria-label={`Delete ${s.name}`} onClick={() => void remove(s)}>🗑</button>
                    {expanded?.id === s.id && (
                      <ul className="videoList">
                        {expanded.videos.length === 0 && <li className="subtle">No videos yet. Open a video and file it here.</li>}
                        {expanded.videos.map(v => (
                          <li key={v.id}>
                            <span className="filename">{v.file_name}</span>
                            <span className="mono subtle">{minutes(v.duration)} · {v.tag_count} tags · {v.round_count} rounds</span>
                            {currentVideo?.id === v.id && <span className="chip live">open</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
