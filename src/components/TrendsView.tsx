import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { Session, SessionKind } from '../lib/api';
import type { VideoData } from '../lib/dataFile';
import {
  METRICS, chronological, formatDelta, formatValue, latestChange, metricValue, sumCounts, videoCounts,
} from '../lib/trends';
import type { Counts, Metric, Value } from '../lib/trends';
import type { Fighter } from '../lib/types';

type LoadedSession = { session: Session; videos: { data: VideoData; duration: number | null }[] };

/** Sessions of one kind with every video's data, oldest first. Unfiled videos are not part of any trend. */
async function loadSessions(kind: SessionKind): Promise<LoadedSession[]> {
  const sessions = chronological((await api.listSessions()).filter(s => s.kind === kind));
  return Promise.all(sessions.map(async session => {
    const detail = await api.getSession(session.id);
    const videos = await Promise.all(detail.videos.map(async v => ({ data: await api.getData(v.id), duration: v.duration })));
    return { session, videos };
  }));
}

/** A tiny line of one metric across sessions. Hollow dots are small samples; gaps are sessions with no value. */
function Sparkline({ metric, values }: { metric: Metric; values: Value[] }) {
  const w = 120, h = 32, pad = 4;
  const nums = values.map(v => v?.value ?? null);
  const max = metric.kind === 'percent' ? 1 : Math.max(...nums.filter((x): x is number => x !== null), 0.1);
  const x = (i: number) => (values.length === 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (values.length - 1));
  const y = (v: number) => h - pad - (v / max) * (h - 2 * pad);
  const points = nums.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(' ');
  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <line x1={pad} x2={w - pad} y1={h - pad} y2={h - pad} className="sparkBase" />
      <polyline points={points} className="sparkLine" />
      {values.map((v, i) => v && (
        <circle key={i} cx={x(i)} cy={y(v.value)} r={i === values.length - 1 ? 3.5 : 2.5}
          className={v.reliable ? 'sparkDot' : 'sparkDot small'} />
      ))}
    </svg>
  );
}

function ValueCell({ metric, value }: { metric: Metric; value: Value }) {
  if (!value) return <td className="mono subtle">—</td>;
  const detail = metric.kind === 'percent' ? `${value.num} of ${value.den}` : `${value.num} in ${value.den.toFixed(1)} min`;
  return (
    <td className={`mono${value.reliable ? '' : ' smallSample'}`} title={value.reliable ? detail : `${detail}: small sample`}>
      {formatValue(metric, value.value)}{value.reliable ? '' : '*'}
    </td>
  );
}

/** Your (or a scouted opponent's) numbers per session, and how the latest session compares with the ones before. */
export function TrendsView() {
  const [kind, setKind] = useState<SessionKind>('sparring');
  const [fighter, setFighter] = useState<Fighter>('you');
  const [loaded, setLoaded] = useState<LoadedSession[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setLoaded(null);
    loadSessions(kind)
      .then(r => { if (live) { setLoaded(r); setError(''); } })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : 'Could not load sessions'); });
    return () => { live = false; };
  }, [kind]);

  const rows = useMemo(() => (loaded ?? []).map(({ session, videos }) => ({
    session,
    counts: sumCounts(videos.map(v => videoCounts(v.data, v.duration, fighter))) as Counts,
    tagCount: videos.reduce((sum, v) => sum + v.data.tags.length, 0),
  })).filter(r => r.tagCount > 0), [loaded, fighter]);

  function chooseKind(k: SessionKind) {
    setKind(k);
    setFighter(k === 'sparring' ? 'you' : 'opponent'); // scouting sessions are about the opponent
  }

  return (
    <div className="trends">
      <div className="trendControls">
        <div className="statsFighterToggle" role="group" aria-label="Session type">
          <button type="button" className={kind === 'sparring' ? 'activeYou' : ''} onClick={() => chooseKind('sparring')}>Sparring</button>
          <button type="button" className={kind === 'scouting' ? 'activeOpponent' : ''} onClick={() => chooseKind('scouting')}>Scouting</button>
        </div>
        <div className="statsFighterToggle" role="group" aria-label="Fighter">
          <button type="button" className={fighter === 'you' ? 'activeYou' : ''} onClick={() => setFighter('you')}>You</button>
          <button type="button" className={fighter === 'opponent' ? 'activeOpponent' : ''} onClick={() => setFighter('opponent')}>Opponent</button>
        </div>
      </div>

      {error && <p className="formError" role="alert">{error}</p>}
      {!loaded && !error && <div className="empty">Loading sessions…</div>}
      {loaded && rows.length === 0 && (
        <div className="empty">No tagged {kind} sessions yet. File tagged videos into sessions to see trends.</div>
      )}

      {rows.length > 0 && (
        <>
          <p className="hint">
            Latest session vs. all earlier {kind} sessions pooled. <span className="smallSample">*</span> marks small samples
            (under 5 punches, or under a minute); read those as anecdotes, not trends.
          </p>
          <div className="trendCards">
            {METRICS.map(metric => {
              const values = rows.map(r => metricValue(metric, r.counts));
              const change = latestChange(metric, rows.map(r => r.counts));
              return (
                <div className="trendCard" key={metric.id} title={metric.help}>
                  <span className="trendLabel">{metric.label}</span>
                  <strong className="mono">{change.latest ? formatValue(metric, change.latest.value) : '—'}</strong>
                  <Sparkline metric={metric} values={values} />
                  <span className={`trendDelta${change.reliable ? '' : ' smallSample'}`}>
                    {change.delta === null
                      ? rows.length < 2 ? 'Needs 2+ sessions' : 'Not enough data'
                      : `${formatDelta(metric, change.delta)} vs ${formatValue(metric, change.baseline!.value)} before${change.reliable ? '' : ' *'}`}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="trendTableWrap">
            <table className="trendTable">
              <thead>
                <tr>
                  <th>Session</th>
                  <th title="Round time, or whole video if no rounds are marked">Min</th>
                  <th>Punches</th>
                  {METRICS.map(m => <th key={m.id} title={m.help}>{m.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ session, counts }) => (
                  <tr key={session.id}>
                    <td>
                      <strong>{session.name}</strong>
                      <span className="subtle">{[session.date, session.opponent && `vs ${session.opponent}`].filter(Boolean).join(' · ')}</span>
                    </td>
                    <td className="mono">{counts.seconds === null ? '—' : (counts.seconds / 60).toFixed(1)}</td>
                    <td className="mono">{counts.punches}</td>
                    {METRICS.map(m => <ValueCell key={m.id} metric={m} value={metricValue(m, counts)} />)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="subtle">
            Minutes are unknown ("—") for a video until it has been opened once with the library running, which records its
            length; per-minute rates need them.
          </p>
        </>
      )}
    </div>
  );
}
