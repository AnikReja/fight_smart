import { useState } from 'react';
import { ACTION_GROUPS, PUNCHES } from '../lib/actions';
import { stampPrecise } from '../lib/format';
import { OUTCOMES } from '../lib/types';
import type { Fighter, Outcome, Tag } from '../lib/types';

type Props = {
  tags: Tag[];
  roundOf: (time: number) => number | null;
  getCurrentTime: () => number;
  onSeek: (time: number) => void;
  onUpdate: (tag: Tag) => void;
  onDelete: (tag: Tag) => void;
};

const fighterName = (f?: Fighter) => (f === 'you' ? 'You' : f === 'opponent' ? 'Opponent' : 'Unassigned');

export function TagList({ tags, roundOf, getCurrentTime, onSeek, onUpdate, onDelete }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);

  if (tags.length === 0) {
    return <div className="empty">No tagged moments here yet.<br />Play a video and add your first tag.</div>;
  }

  return (
    <div className="events">
      {tags.map(tag =>
        tag.id === editingId ? (
          <TagEditor
            key={tag.id}
            tag={tag}
            getCurrentTime={getCurrentTime}
            onCancel={() => setEditingId(null)}
            onSave={next => { onUpdate(next); setEditingId(null); }}
          />
        ) : (
          <div className={`event fighter-${tag.fighter ?? 'none'}`} key={tag.id}>
            <button className="timestamp" onClick={() => onSeek(tag.time)}>{stampPrecise(tag.time)} ▶</button>
            <div className="eventText">
              <strong>
                <span className="fighterName">{fighterName(tag.fighter)}</span>
                {' • '}
                {tag.label}
              </strong>
              <span className="eventMeta">
                {roundOf(tag.time) !== null && <span className="chip">R{roundOf(tag.time)}</span>}
                {tag.outcome && <span className={`chip outcome-${tag.outcome}`}>{tag.outcome}</span>}
              </span>
              {tag.note && <p>{tag.note}</p>}
            </div>
            <button className="iconButton" title="Edit tag" aria-label={`Edit ${tag.label} at ${stampPrecise(tag.time)}`} onClick={() => setEditingId(tag.id)}>✎</button>
            <button className="delete" title="Delete tag" aria-label={`Delete ${tag.label} at ${stampPrecise(tag.time)}`} onClick={() => onDelete(tag)}>×</button>
          </div>
        ),
      )}
    </div>
  );
}

type EditorProps = {
  tag: Tag;
  getCurrentTime: () => number;
  onSave: (tag: Tag) => void;
  onCancel: () => void;
};

function TagEditor({ tag, getCurrentTime, onSave, onCancel }: EditorProps) {
  const [draft, setDraft] = useState<Tag>(tag);
  const [timeText, setTimeText] = useState(tag.time.toFixed(2));
  const time = Number(timeText);
  const timeValid = timeText.trim() !== '' && Number.isFinite(time) && time >= 0;
  const isPunch = PUNCHES.has(draft.label);

  function save() {
    if (!timeValid) return;
    const next: Tag = { ...draft, time, note: draft.note.trim() };
    if (!PUNCHES.has(next.label)) delete next.outcome;
    onSave(next);
  }

  return (
    <form className="tagEditor" onSubmit={e => { e.preventDefault(); save(); }} onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}>
      <div className="editorGrid">
        <label>
          Time (sec)
          <span className="timeField">
            <input type="number" step="0.1" min="0" value={timeText} aria-invalid={!timeValid} onChange={e => setTimeText(e.target.value)} autoFocus />
            <button type="button" onClick={() => setTimeText(getCurrentTime().toFixed(2))} title="Use the video's current time">Now</button>
          </span>
        </label>
        <label>
          Action
          <select value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })}>
            {Object.entries(ACTION_GROUPS).map(([group, actions]) => (
              <optgroup key={group} label={group}>{actions.map(a => <option key={a} value={a}>{a}</option>)}</optgroup>
            ))}
          </select>
        </label>
        <label>
          Fighter
          <select
            value={draft.fighter ?? ''}
            onChange={e => {
              const value = e.target.value;
              const next = { ...draft };
              if (value === 'you' || value === 'opponent') next.fighter = value;
              else delete next.fighter;
              setDraft(next);
            }}
          >
            {!tag.fighter && <option value="">Unassigned</option>}
            <option value="you">You</option>
            <option value="opponent">Opponent</option>
          </select>
        </label>
        <label>
          Outcome
          <select
            value={draft.outcome ?? ''}
            disabled={!isPunch}
            onChange={e => {
              const next = { ...draft };
              if (e.target.value) next.outcome = e.target.value as Outcome;
              else delete next.outcome;
              setDraft(next);
            }}
          >
            <option value="">Unknown</option>
            {OUTCOMES.map(o => <option key={o} value={o}>{o[0].toUpperCase() + o.slice(1)}</option>)}
          </select>
        </label>
      </div>
      <label>
        Note
        <input value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} placeholder="Optional" />
      </label>
      <div className="editorActions">
        <button type="submit" className="primary" disabled={!timeValid}>Save</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
