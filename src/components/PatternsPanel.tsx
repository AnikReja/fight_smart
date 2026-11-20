import { stamp } from '../lib/format';
import { MIN_RELIABLE, followUps, insights, responses, sequences, topActions } from '../lib/patterns';
import type { Distribution, Evidence } from '../lib/patterns';
import type { Fighter, Tag } from '../lib/types';

type Props = {
  tags: Tag[];
  fighter: Fighter;
  scopeLabel: string;
  onFighterChange: (fighter: Fighter) => void;
  onSeek: (time: number) => void;
  /** Downloads a printable report of this fighter's patterns for the current scope. */
  onReport: () => void;
};

/** Jump a moment early so the lead-up to the action is visible. */
const LEAD_IN = 0.75;
const MAX_CHIPS = 6;

function EvidenceChips({ evidence, onSeek }: { evidence: Evidence; onSeek: (t: number) => void }) {
  return (
    <div className="evidence">
      {evidence.slice(0, MAX_CHIPS).map((t, i) => (
        <button key={`${t}-${i}`} type="button" className="evidenceChip" onClick={() => onSeek(Math.max(0, t - LEAD_IN))}
          title={`Watch from ${stamp(Math.max(0, t - LEAD_IN))}`}>
          {stamp(t)}
        </button>
      ))}
      {evidence.length > MAX_CHIPS && <span className="subtle">+{evidence.length - MAX_CHIPS}</span>}
    </div>
  );
}

function SampleNote({ total }: { total: number }) {
  return total < MIN_RELIABLE ? <span className="chip sample" title={`Fewer than ${MIN_RELIABLE} examples: treat as a hint, not a habit`}>small sample</span> : null;
}

function DistributionCard({ title, d, onSeek }: { title: string; d: Distribution; onSeek: (t: number) => void }) {
  if (d.total === 0) return null;
  return (
    <div className="distCard">
      <div className="distHeader">
        <strong>{title}</strong>
        <span className="subtle">n = {d.total}</span>
        <SampleNote total={d.total} />
      </div>
      {d.outcomes.slice(0, 4).map(o => (
        <details key={o.action ?? 'none'} className="distRow">
          <summary>
            <span className={o.action ? '' : 'none'}>{o.action ?? 'Nothing'}</span>
            <span className="distBar"><span style={{ width: `${o.share * 100}%` }} /></span>
            <span className="mono">{o.count}<span className="subtle"> · {Math.round(o.share * 100)}%</span></span>
          </summary>
          <EvidenceChips evidence={o.evidence} onSeek={onSeek} />
        </details>
      ))}
    </div>
  );
}

export function PatternsPanel({ tags, fighter, scopeLabel, onFighterChange, onSeek, onReport }: Props) {
  const them = fighter === 'you' ? 'you' : 'they';
  const otherSide = fighter === 'you' ? 'Opponent' : 'You';
  const findings = insights(tags, fighter);
  const pairs = sequences(tags, fighter, 2).filter(s => s.count >= 2).slice(0, 5);
  const triples = sequences(tags, fighter, 3).filter(s => s.count >= 2).slice(0, 3);
  const top = topActions(tags, fighter, 3);
  const hasData = top.length > 0;

  return (
    <section className="patterns">
      <p className="hint">Repeated sequences and reactions in your tags · <strong className="scope">{scopeLabel}</strong>. Click a time to watch it.</p>
      <div className="statsFighterToggle">
        <button type="button" className={fighter === 'you' ? 'activeYou' : ''} onClick={() => onFighterChange('you')}>You</button>
        <button type="button" className={fighter === 'opponent' ? 'activeOpponent' : ''} onClick={() => onFighterChange('opponent')}>Opponent</button>
      </div>
      {hasData && (
        <button type="button" className="ghostButton reportButton" onClick={onReport}
          title="Download a one-page HTML report (prints to PDF) to share with a coach">
          {fighter === 'opponent' ? 'Download scouting report' : 'Download self-review'}
        </button>
      )}

      {!hasData ? (
        <div className="empty">No tagged actions for this fighter yet.<br />Tag a few exchanges to see patterns.</div>
      ) : (
        <>
          <h3 className="sectionTitle">Key findings</h3>
          {findings.length === 0 ? (
            <p className="hint">Nothing repeats strongly yet (needs 3+ examples making up 40%+ of a situation).</p>
          ) : (
            <ul className="findings">
              {findings.slice(0, 5).map(f => (
                <li key={f.text} className="finding">
                  <p>{f.text} {!f.reliable && <SampleNote total={f.total} />}</p>
                  <EvidenceChips evidence={f.evidence} onSeek={onSeek} />
                </li>
              ))}
            </ul>
          )}

          <h3 className="sectionTitle">Habits</h3>
          {pairs.length === 0 ? (
            <p className="hint">No sequence repeats yet. Actions count as a sequence when they're under 1.5s apart.</p>
          ) : (
            <div className="habitList">
              {[...triples, ...pairs].map(s => (
                <div key={s.actions.join('>')} className="habit">
                  <div className="habitHeader">
                    <strong>{s.actions.join(' → ')}</strong>
                    <span className="mono">{s.count}×</span>
                  </div>
                  <EvidenceChips evidence={s.evidence} onSeek={onSeek} />
                </div>
              ))}
            </div>
          )}

          <h3 className="sectionTitle">What {them} do next</h3>
          {top.map(({ action }) => (
            <DistributionCard key={`f-${action}`} title={`After a ${action.toLowerCase()}`} d={followUps(tags, fighter, action)} onSeek={onSeek} />
          ))}

          <h3 className="sectionTitle">How {otherSide === 'You' ? 'you' : 'they'} respond (within 1s)</h3>
          <p className="hint">Only tagged actions count: an untagged slip or block shows up as "Nothing".</p>
          {top.map(({ action }) => (
            <DistributionCard key={`r-${action}`} title={`${fighter === 'you' ? 'Your' : 'Their'} ${action.toLowerCase()}`} d={responses(tags, fighter, action)} onSeek={onSeek} />
          ))}
        </>
      )}
    </section>
  );
}
