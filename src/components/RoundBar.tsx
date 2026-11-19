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

export function RoundBar({ rounds, selected, current, disabled, onSelect, onStart, onEnd, onDelete }: Props) {
  const selectedRound = rounds.find(r => r.number === selected);
  return (
    <section className="roundBar" aria-label="Rounds">
      <div className="roundHeader">
        <h3>Rounds</h3>
        <span className="subtle">{current ? `Now in round ${current}` : rounds.length ? 'Between rounds' : 'Press N at the opening bell'}</span>
      </div>
      <div className="roundChips" role="tablist">
        <button type="button" role="tab" aria-selected={selected === null} className={selected === null ? 'roundChip active' : 'roundChip'} onClick={() => onSelect(null)}>
          All
        </button>
        {rounds.map(r => (
          <button
            key={r.id}
            type="button"
            role="tab"
            aria-selected={selected === r.number}
            className={`roundChip${selected === r.number ? ' active' : ''}${current === r.number ? ' live' : ''}`}
            onClick={() => onSelect(r)}
            title="Show this round and jump to its start"
          >
            R{r.number} <span>{range(r)}</span>
          </button>
        ))}
      </div>
      <div className="roundActions">
        <button type="button" disabled={disabled} onClick={onStart}>+ Start round here <kbd>N</kbd></button>
        <button type="button" disabled={disabled || !current} onClick={onEnd}>End round here <kbd>⇧N</kbd></button>
        {selectedRound && (
          <button type="button" className="danger" onClick={() => onDelete(selectedRound)}>Delete R{selectedRound.number}</button>
        )}
      </div>
    </section>
  );
}
