import { PUNCH_ACTIONS } from './actions';
import { stamp } from './format';
import { MIN_RELIABLE, followUps, insights, responses, sequences, topActions } from './patterns';
import type { Distribution } from './patterns';
import { numberRounds } from './rounds';
import { computeFighterStats } from './stats';
import type { Combination, Fighter, Reviews, Round, Tag } from './types';

/**
 * A one-page report of one fighter's habits, as a self-contained HTML file: no scripts from anywhere, no
 * external fonts or images, so it opens offline, prints to PDF from any browser, and can be sent to a coach.
 * Everything in it is computed by the same functions as the app's panels; each finding lists the timestamps it
 * came from so it can be checked against the footage.
 */

export type ReportInput = {
  videoName: string;
  fighter: Fighter;
  /** e.g. "All rounds" or "Round 2", matching the app's round filter. */
  scopeLabel: string;
  /** Tags already filtered to the scope. */
  tags: Tag[];
  combos: Combination[];
  reviews: Reviews;
  /** All rounds of the video, used for the per-round table (only when the scope is all rounds). */
  rounds: Round[];
  generatedAt: Date;
};

const MAX_TIMES = 8;

/** Escapes text for HTML. Video names, labels, and notes are user input and must never become markup. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const e = escapeHtml;
const pct = (x: number) => `${Math.round(x * 100)}%`;

function times(evidence: number[]): string {
  const shown = evidence.slice(0, MAX_TIMES).map(t => `<span class="t">${stamp(t)}</span>`).join(' ');
  return evidence.length > MAX_TIMES ? `${shown} <span class="more">+${evidence.length - MAX_TIMES} more</span>` : shown;
}

const SMALL = ' <span class="small">small sample</span>';
const small = (n: number) => (n < MIN_RELIABLE ? SMALL : '');

function distributionTable(title: string, d: Distribution): string {
  if (d.total === 0) return '';
  const rows = d.outcomes.slice(0, 4).map(o => `
        <tr><td>${o.action ? e(o.action) : '<em>Nothing</em>'}</td><td class="num">${o.count}</td><td class="num">${pct(o.share)}</td>
          <td class="times">${times(o.evidence)}</td></tr>`).join('');
  return `
    <table class="dist">
      <caption>${e(title)} <span class="n">n = ${d.total}</span>${small(d.total)}</caption>
      ${rows}
    </table>`;
}

export function buildReport(input: ReportInput): string {
  const { fighter, tags, scopeLabel } = input;
  const subject = fighter === 'you' ? 'You' : 'Opponent';
  const title = fighter === 'you' ? 'Self-review' : 'Scouting report';
  const stats = computeFighterStats(tags, input.combos, input.reviews, fighter);
  const top = topActions(tags, fighter, 3);
  const findings = insights(tags, fighter).slice(0, 6);
  const habits = [
    ...sequences(tags, fighter, 3).filter(s => s.count >= 2).slice(0, 3),
    ...sequences(tags, fighter, 2).filter(s => s.count >= 2).slice(0, 5),
  ];
  const { outcomes } = stats;
  const punchMix = stats.punchCounts.filter(c => c.count > 0).sort((a, b) => b.count - a.count);

  const roundRows = scopeLabel === 'All rounds' ? numberRounds(input.rounds).map(r => {
    const inside = tags.filter(t => t.fighter === fighter && t.time >= r.start && t.time < r.effectiveEnd);
    const punches = inside.filter(t => (PUNCH_ACTIONS as readonly string[]).includes(t.label));
    const landed = punches.filter(t => t.outcome === 'landed').length;
    const known = punches.filter(t => t.outcome).length;
    return `<tr><td>Round ${r.number}</td><td class="num">${punches.length}</td><td class="num">${known ? `${landed}/${known}` : '—'}</td><td class="num">${inside.length - punches.length}</td></tr>`;
  }).join('') : '';

  const body = top.length === 0 ? '<p class="empty">No tagged actions for this fighter in this scope.</p>' : `
  <section class="glance">
    <div><span>Punches</span><strong>${stats.totalPunches}</strong></div>
    <div><span>Accuracy</span><strong>${outcomes.accuracy === null ? '—' : pct(outcomes.accuracy)}</strong>
      <em>${outcomes.known ? `${outcomes.landed} landed of ${outcomes.known} with an outcome` : 'no outcomes tagged'}</em></div>
    <div><span>Defensive actions</span><strong>${stats.totalDefense}</strong></div>
    <div><span>Feints</span><strong>${stats.feintCount}</strong></div>
    <div><span>Confirmed combos</span><strong>${stats.confirmedCombos}</strong>
      ${stats.pendingCombos ? `<em>${stats.pendingCombos} not reviewed</em>` : ''}</div>
  </section>

  ${punchMix.length ? `<p class="mix"><b>Punch mix:</b> ${punchMix.map(c => `${e(c.name)} ${c.count} (${pct(c.count / stats.totalPunches)})`).join(' · ')}</p>` : ''}

  <h2>Key findings</h2>
  ${findings.length === 0
    ? '<p class="muted">Nothing repeats strongly yet (needs 3+ examples making up 40%+ of a situation).</p>'
    : `<ol class="findings">${findings.map(f => `<li><p>${e(f.text)}${f.reliable ? '' : SMALL}</p><p class="times">${times(f.evidence)}</p></li>`).join('')}</ol>`}

  ${habits.length ? `<h2>Repeated sequences</h2>
  <table class="habits">${habits.map(h => `<tr><td>${h.actions.map(e).join(' → ')}</td><td class="num">${h.count}×</td><td class="times">${times(h.evidence)}</td></tr>`).join('')}</table>` : ''}

  ${stats.comboFrequencies.length ? `<h2>Confirmed combinations</h2>
  <table class="habits">${stats.comboFrequencies.slice(0, 6).map(([name, n]) => `<tr><td>${e(name)}</td><td class="num">${n}×</td></tr>`).join('')}</table>` : ''}

  <div class="cols">
    <div>
      <h2>What ${fighter === 'you' ? 'you' : 'they'} do next <small>(within 1.5 s)</small></h2>
      ${top.map(({ action }) => distributionTable(`After a ${action.toLowerCase()}`, followUps(tags, fighter, action))).join('')}
    </div>
    <div>
      <h2>How ${fighter === 'you' ? 'they' : 'you'} respond <small>(within 1 s)</small></h2>
      ${top.map(({ action }) => distributionTable(`${fighter === 'you' ? 'Your' : 'Their'} ${action.toLowerCase()}`, responses(tags, fighter, action))).join('')}
    </div>
  </div>

  ${roundRows ? `<h2>By round</h2>
  <table class="rounds"><tr><th></th><th class="num">Punches</th><th class="num">Landed</th><th class="num">Other actions</th></tr>${roundRows}</table>` : ''}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)}: ${e(subject)} · ${e(input.videoName)}</title>
<style>
  :root { --ink: #112250; --muted: #5a6585; --line: #d9cbc2; --accent: #3c507d; --warn: #8a6a1f; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f5f0e9; color: var(--ink); font: 13px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; }
  main { max-width: 860px; margin: 0 auto; padding: 32px 24px; background: #fff; min-height: 100vh; }
  header { border-bottom: 3px solid var(--ink); padding-bottom: 12px; margin-bottom: 18px; }
  header p { margin: 2px 0; color: var(--muted); }
  h1 { margin: 0 0 4px; font: 600 24px Georgia, serif; }
  h2 { font: 600 15px Georgia, serif; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 1px solid var(--line); }
  h2 small { font: 12px system-ui, sans-serif; color: var(--muted); }
  .glance { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; }
  .glance div { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; }
  .glance span { color: var(--muted); font-size: 12px; }
  .glance strong { font-size: 22px; }
  .glance em { color: var(--muted); font-size: 11px; font-style: normal; }
  .mix { margin: 10px 0 0; }
  .findings { padding-left: 20px; margin: 0; }
  .findings li { margin-bottom: 8px; }
  .findings p { margin: 0; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  td, th { padding: 4px 6px; border-bottom: 1px solid #eee6dd; text-align: left; vertical-align: top; }
  th { color: var(--muted); font-weight: 600; font-size: 12px; }
  caption { text-align: left; font-weight: 600; padding: 4px 0; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .n { color: var(--muted); font-weight: 400; font-size: 12px; }
  .times { color: var(--muted); }
  .t { font-family: ui-monospace, Consolas, monospace; font-size: 11px; white-space: nowrap; }
  .more { font-size: 11px; }
  .small { color: var(--warn); border: 1px solid currentColor; border-radius: 99px; padding: 0 6px; font-size: 10px; white-space: nowrap; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .muted, .empty { color: var(--muted); }
  footer { margin-top: 24px; padding-top: 10px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11px; }
  .print { float: right; padding: 6px 12px; border: 1px solid var(--ink); background: var(--ink); color: #fff; border-radius: 6px; cursor: pointer; }
  @media (max-width: 640px) { .cols { grid-template-columns: 1fr; } main { padding: 20px 16px; } }
  @media print {
    body { background: #fff; } main { padding: 0; max-width: none; } .print { display: none; }
    h2, table, li { break-inside: avoid; }
  }
</style>
</head>
<body>
<main>
  <header>
    <button class="print" onclick="print()">Print / PDF</button>
    <h1>${e(title)}: ${e(subject)}</h1>
    <p>${e(input.videoName)} · ${e(scopeLabel)}</p>
    <p>${input.generatedAt.toISOString().slice(0, 10)} · from ${tags.filter(t => t.fighter === fighter).length} tagged actions</p>
  </header>
  ${body}
  <footer>
    Made with FightSmart from manually tagged footage. Every number is a count of tagged moments, not a model
    prediction; untagged actions don't appear (an untagged slip shows up as "Nothing"). Findings need 3+ examples making
    up 40%+ of a situation; anything under ${MIN_RELIABLE} examples is marked "small sample". Times are mm:ss in the video.
  </footer>
</main>
</body>
</html>
`;
}

/** Download file name, e.g. "round3-opponent-report.html". */
export function reportFileName(videoName: string, fighter: Fighter): string {
  const base = videoName.replace(/\.[^/.]+$/, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'fightsmart';
  return `${base}-${fighter}-report.html`;
}
