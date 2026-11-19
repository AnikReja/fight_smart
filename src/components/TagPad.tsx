import { ACTION_GROUPS, ACTION_SHORTCUTS, OUTCOME_SHORTCUTS, PUNCHES } from '../lib/actions';
import { stampPrecise } from '../lib/format';
import type { Fighter, Outcome, Tag } from '../lib/types';

type Props = {
  fighter: Fighter;
  note: string;
  lastTag: Tag | null;
  disabled: boolean;
  onFighterChange: (fighter: Fighter) => void;
  onNoteChange: (note: string) => void;
  onTag: (action: string) => void;
  onOutcome: (outcome: Outcome) => void;
  onUndo: () => void;
};

const keyFor: Record<string, string> = Object.fromEntries(Object.entries(ACTION_SHORTCUTS).map(([k, a]) => [a, k.toUpperCase()]));
const outcomeKey: Record<Outcome, string> = Object.fromEntries(Object.entries(OUTCOME_SHORTCUTS).map(([k, o]) => [o, k.toUpperCase()])) as Record<Outcome, string>;
const OUTCOME_LABEL: Record<Outcome, string> = { landed: 'Landed', blocked: 'Blocked', missed: 'Missed' };

/** One-click tagging: every action is a button showing its keyboard shortcut. */
export function TagPad({ fighter, note, lastTag, disabled, onFighterChange, onNoteChange, onTag, onOutcome, onUndo }: Props) {
  const lastIsPunch = lastTag !== null && PUNCHES.has(lastTag.label);
  return (
    <section className={`tagPad fighter-${fighter}`} aria-label="Tag a moment">
      <div className="padHeader">
        <h2>Tag a moment</h2>
        <div className="segmented fighterSwitch" role="radiogroup" aria-label="Who performed the action">
          {(['you', 'opponent'] as const).map((f, i) => (
            <button key={f} type="button" role="radio" aria-checked={fighter === f}
              className={fighter === f ? `on ${f}` : ''} onClick={() => onFighterChange(f)}>
              {f === 'you' ? 'You' : 'Opponent'} <kbd>{i + 1}</kbd>
            </button>
          ))}
        </div>
      </div>

      <div className="padGroups">
        {Object.entries(ACTION_GROUPS).map(([group, actions]) => (
          <div key={group} className="padGroup">
            <h3>{group}</h3>
            <div className="padButtons">
              {actions.map(action => (
                <button key={action} type="button" className="padButton" disabled={disabled} onClick={() => onTag(action)}>
                  <span>{action}</span>
                  {keyFor[action] && <kbd>{keyFor[action]}</kbd>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="padFooter">
        <div className="lastTag">
          {lastTag ? (
            <>
              <span className="subtle">Last:</span>{' '}
              <strong>{lastTag.label}</strong> <span className="mono">{stampPrecise(lastTag.time)}</span>
              {lastTag.outcome && <span className={`chip outcome-${lastTag.outcome}`}>{lastTag.outcome}</span>}
            </>
          ) : <span className="subtle">Tags are added at the current video time.</span>}
        </div>
        <div className="outcomeButtons" aria-label="Outcome of the last punch">
          {(Object.keys(OUTCOME_LABEL) as Outcome[]).map(o => (
            <button key={o} type="button" className={`outcomeButton ${o}`} disabled={disabled || !lastIsPunch}
              aria-pressed={lastTag?.outcome === o} onClick={() => onOutcome(o)} title={`Mark the last punch ${o}`}>
              {OUTCOME_LABEL[o]} <kbd>{outcomeKey[o]}</kbd>
            </button>
          ))}
          <button type="button" className="outcomeButton undo" disabled={disabled || !lastTag} onClick={onUndo} title="Remove the last tag">
            Undo <kbd>Z</kbd>
          </button>
        </div>
      </div>

      <label className="noteField">
        <span>Note for the next tag</span>
        <input value={note} disabled={disabled} onChange={e => onNoteChange(e.target.value)}
          placeholder="Optional, e.g. right hand drops after jab" />
      </label>
    </section>
  );
}
