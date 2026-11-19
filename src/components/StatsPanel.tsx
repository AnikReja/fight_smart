import type { Count, FighterStats } from '../lib/stats';
import type { Fighter } from '../lib/types';

type Props = {
  stats: FighterStats;
  fighter: Fighter;
  scopeLabel: string;
  onFighterChange: (fighter: Fighter) => void;
};

function Breakdown({ title, counts, total, fill }: { title: string; counts: Count[]; total: number; fill: string }) {
  return (
    <div className="statsBreakdown">
      <h3>{title}</h3>
      {counts.map(item => (
        <div className="statRow" key={item.name}>
          <div className="statRowHeader"><span>{item.name}</span><strong>{item.count}</strong></div>
          <div className="statTrack">
            <div className={`statFill ${fill}`} style={{ width: `${total > 0 ? (item.count / total) * 100 : 0}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function StatsPanel({ stats, fighter, scopeLabel, onFighterChange }: Props) {
  const { outcomes } = stats;
  return (
    <section className="statsDashboard">
      <p className="hint">From your tags · <strong className="scope">{scopeLabel}</strong></p>

      <div className="statsFighterToggle">
        <button type="button" className={fighter === 'you' ? 'activeYou' : ''} onClick={() => onFighterChange('you')}>You</button>
        <button type="button" className={fighter === 'opponent' ? 'activeOpponent' : ''} onClick={() => onFighterChange('opponent')}>Opponent</button>
      </div>

      <div className="statsCards">
        <div className="statCard"><span>Punches tagged</span><strong>{stats.totalPunches}</strong></div>
        <div className="statCard"><span>Defensive actions</span><strong>{stats.totalDefense}</strong></div>
        <div className="statCard"><span>Confirmed combos</span><strong>{stats.confirmedCombos}</strong></div>
        <div className="statCard">
          <span>Accuracy</span>
          <strong>{outcomes.accuracy === null ? '—' : `${Math.round(outcomes.accuracy * 100)}%`}</strong>
          <small>{outcomes.known ? `${outcomes.landed} landed of ${outcomes.known} with outcome` : 'Mark outcomes with Q / W / E'}</small>
        </div>
      </div>

      <Breakdown title="Punch Breakdown" counts={stats.punchCounts} total={stats.totalPunches} fill="punchFill" />
      {outcomes.known > 0 && (
        <p className="statsFootnote">
          Outcomes: {outcomes.landed} landed · {outcomes.blocked} blocked · {outcomes.missed} missed · {stats.totalPunches - outcomes.known} unknown
        </p>
      )}
      <p className="statsFootnote">Feints tagged: {stats.feintCount}</p>

      <Breakdown title="Defensive Breakdown" counts={stats.defenseCounts} total={stats.totalDefense} fill="defenseFill" />

      <div className="statsBreakdown">
        <h3>Most Frequent Confirmed Combos</h3>
        {stats.comboFrequencies.length === 0 ? (
          <p className="hint">Confirm some combinations to see patterns here.</p>
        ) : (
          stats.comboFrequencies.map(([name, count]) => (
            <div className="comboStat" key={name}><span>{name}</span><strong>{count}×</strong></div>
          ))
        )}
        <p className="statsFootnote">
          {stats.pendingCombos} awaiting review · {stats.rejectedCombos} rejected
        </p>
      </div>
    </section>
  );
}
