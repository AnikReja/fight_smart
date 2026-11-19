import type { MouseEvent } from 'react';
import { stampPrecise } from '../lib/format';
import type { NumberedRound } from '../lib/rounds';
import type { Tag } from '../lib/types';

type Props = {
  duration: number;
  currentTime: number;
  tags: Tag[];
  rounds: NumberedRound[];
  selectedRound: number | null;
  onSeek: (time: number) => void;
};

/**
 * A scrubbable overview of the whole video: rounds as shaded bands, your tags as ticks above the
 * center line (green), the opponent's below (blue), and the playhead. Click anywhere to seek.
 */
export function TimelineStrip({ duration, currentTime, tags, rounds, selectedRound, onSeek }: Props) {
  if (!Number.isFinite(duration) || duration <= 0) return <div className="timeline tlEmpty" />;
  const pct = (t: number) => `${Math.min(100, Math.max(0, (t / duration) * 100))}%`;

  function handleClick(e: MouseEvent<HTMLDivElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    onSeek(((e.clientX - box.left) / box.width) * duration);
  }

  return (
    <div className="timeline" onClick={handleClick} role="slider" aria-label="Video timeline"
      aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(currentTime)}
      aria-valuetext={stampPrecise(currentTime)} tabIndex={-1}>
      {rounds.map(r => {
        const end = Number.isFinite(r.effectiveEnd) ? r.effectiveEnd : duration;
        return (
          <div key={r.id} className={`tlRound${selectedRound === r.number ? ' selected' : ''}`}
            style={{ left: pct(r.start), width: `calc(${pct(end)} - ${pct(r.start)})` }}>
            <span>R{r.number}</span>
          </div>
        );
      })}
      <div className="tlMidline" />
      {tags.map(t => (
        <div key={t.id} className={`tlTick ${t.fighter ?? 'none'}`} style={{ left: pct(t.time) }}
          title={`${stampPrecise(t.time)} · ${t.fighter === 'you' ? 'You' : t.fighter === 'opponent' ? 'Opponent' : 'Unassigned'} · ${t.label}`} />
      ))}
      <div className="tlPlayhead" style={{ left: pct(currentTime) }} />
    </div>
  );
}
