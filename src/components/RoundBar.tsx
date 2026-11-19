import { stamp } from '../lib/format';
import type { NumberedRound } from '../lib/rounds';

type Props = {
  rounds: NumberedRound[];
  selected: number | null;
  current: number | null;
  disabled: boolean;
  onSelect: (round: NumberedRound | null) => void;
  onStart: () => void;
  onEnd: () => void;
  onDelete: (round: NumberedRound) => void;
};

const range = (r: NumberedRound) => `${stamp(r.start)}–${Number.isFinite(r.effectiveEnd) ? stamp(r.effectiveEnd) : '…'}`;

/** One-line round selector: filter chips on the left, start/end/delete on the right. */
export function RoundBar({ rounds, selected, current, disabled, onSelect, onStart, onEnd, onDelete }: Props) {
  const selectedRound = rounds.find(r => r.number === selected);
  return (
    <section className="roundBar" aria-label="Rounds">
      <div className="roundChips" role="tablist" aria-label="Show round">
        <span className="roundLabel">Rounds</span>
        <button type="button" role="tab" aria-selected={selected === null} className={selected === null ? 'roundChip active' : 'roundChip'} onClick={() => onSelect(null)}>
          All
        </button>
        {rounds.map(r => (
          <button key={r.id} type="button" role="tab" aria-selected={selected === r.number}
            className={`roundChip${selected === r.number ? ' active' : ''}${current === r.number ? ' live' : ''}`}
            onClick={() => onSelect(r)} title={`Round ${r.number}, ${range(r)}. Show only this round and jump to its start.`}>
            R{r.number} <span>{range(r)}</span>
          </button>
        ))}
        {rounds.length === 0 && <span className="subtle">Press <kbd>N</kbd> at the opening bell</span>}
      </div>
      <div className="roundActions">
        <button type="button" disabled={disabled} onClick={onStart} title="Start a round at the current time (N)">+ Start</button>
        <button type="button" disabled={disabled || !current} onClick={onEnd} title="End the current round here (Shift+N)">End</button>
        {selectedRound && (
          <button type="button" className="danger" onClick={() => onDelete(selectedRound)}>Delete R{selectedRound.number}</button>
        )}
      </div>
    </section>
  );
}
