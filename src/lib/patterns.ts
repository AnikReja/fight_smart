import type { Fighter, Tag } from './types';

/**
 * Pattern mining over manually tagged actions. Everything here is counting, not machine learning:
 * each finding is backed by the exact moments it came from, so it can be checked on video.
 */

/** Labels that describe an action. "Mistake" and "Other" are notes about moments, not moves, so they are left out. */
const IGNORED = new Set(['Mistake', 'Other']);

/** Below this many examples, a percentage is shown but flagged as a small sample. */
export const MIN_RELIABLE = 5;

export type Evidence = number[]; // start times (seconds) of each example

export type Sequence = { actions: string[]; count: number; evidence: Evidence };

export type Outcome = { action: string | null; count: number; share: number; evidence: Evidence };

/** What followed a trigger action: `action: null` means "nothing within the window". */
export type Distribution = { trigger: string; total: number; outcomes: Outcome[] };

export type PatternOptions = { maxGap?: number; followWindow?: number; responseWindow?: number };
const DEFAULTS = { maxGap: 1.5, followWindow: 1.5, responseWindow: 1.0 };

const other = (f: Fighter): Fighter => (f === 'you' ? 'opponent' : 'you');

function actionsOf(tags: Tag[], fighter: Fighter): Tag[] {
  return tags.filter(t => t.fighter === fighter && !IGNORED.has(t.label)).sort((a, b) => a.time - b.time);
}

/**
 * Splits a fighter's actions into chains where consecutive actions are at most `maxGap` seconds apart,
 * then counts every run of `length` consecutive actions inside a chain (an n-gram).
 * Example: Jab, Cross, Hook (all close together) contains Jab→Cross, Cross→Hook, and Jab→Cross→Hook.
 */
export function sequences(tags: Tag[], fighter: Fighter, length: number, options: PatternOptions = {}): Sequence[] {
  const { maxGap } = { ...DEFAULTS, ...options };
  const events = actionsOf(tags, fighter);
  const found = new Map<string, Sequence>();
  let chain: Tag[] = [];

  const flush = () => {
    for (let i = 0; i + length <= chain.length; i++) {
      const run = chain.slice(i, i + length);
      const key = run.map(t => t.label).join('→');
      const entry = found.get(key) ?? { actions: run.map(t => t.label), count: 0, evidence: [] };
      entry.count++;
      entry.evidence.push(run[0].time);
      found.set(key, entry);
    }
    chain = [];
  };

  for (const e of events) {
    const prev = chain[chain.length - 1];
    if (prev && e.time - prev.time > maxGap) flush();
    chain.push(e);
  }
  flush();
  return [...found.values()].sort((a, b) => b.count - a.count || a.actions.join().localeCompare(b.actions.join()));
}

function distribution(trigger: string, results: { action: string | null; time: number }[]): Distribution {
  const byAction = new Map<string | null, Outcome>();
  for (const r of results) {
    const o = byAction.get(r.action) ?? { action: r.action, count: 0, share: 0, evidence: [] };
    o.count++;
    o.evidence.push(r.time);
    byAction.set(r.action, o);
  }
  const total = results.length;
  const outcomes = [...byAction.values()]
    .map(o => ({ ...o, share: total ? o.count / total : 0 }))
    .sort((a, b) => b.count - a.count || (a.action === null ? 1 : b.action === null ? -1 : a.action.localeCompare(b.action)));
  return { trigger, total, outcomes };
}

/** After `fighter` does `trigger`, what is their own next action within `followWindow` seconds? */
export function followUps(tags: Tag[], fighter: Fighter, trigger: string, options: PatternOptions = {}): Distribution {
  const { followWindow } = { ...DEFAULTS, ...options };
  const events = actionsOf(tags, fighter);
  const results = events.flatMap((e, i) => {
    if (e.label !== trigger) return [];
    const next = events[i + 1];
    return [{ action: next && next.time - e.time <= followWindow ? next.label : null, time: e.time }];
  });
  return distribution(trigger, results);
}

/**
 * After `fighter` does `trigger`, what is the *other* fighter's first action within `responseWindow` seconds?
 * Shows counters and defensive reactions, e.g. "when he jabs, you slip 40% of the time".
 */
export function responses(tags: Tag[], fighter: Fighter, trigger: string, options: PatternOptions = {}): Distribution {
  const { responseWindow } = { ...DEFAULTS, ...options };
  const theirs = actionsOf(tags, fighter);
  const replies = actionsOf(tags, other(fighter));
  const results = theirs
    .filter(e => e.label === trigger)
    .map(e => {
      // Same-instant tags (pressed together) count as a response too; strictly earlier ones do not.
      const reply = replies.find(r => r.time >= e.time && r.time - e.time <= responseWindow);
      return { action: reply ? reply.label : null, time: e.time };
    });
  return distribution(trigger, results);
}

/** A fighter's most frequent actions, most common first. */
export function topActions(tags: Tag[], fighter: Fighter, limit = 3): { action: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of actionsOf(tags, fighter)) counts.set(t.label, (counts.get(t.label) ?? 0) + 1);
  return [...counts.entries()]
    .map(([action, count]) => ({ action, count }))
    .sort((a, b) => b.count - a.count || a.action.localeCompare(b.action))
    .slice(0, limit);
}

export type Insight = { text: string; total: number; count: number; evidence: Evidence; reliable: boolean };

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * Short, evidence-backed statements for a scouting summary. Only patterns seen at least `minCount` times
 * and making up at least `minShare` of their situations are reported, strongest first.
 * Wording is from the viewer's side: fighter "you" → "You", "opponent" → "They".
 */
export function insights(tags: Tag[], fighter: Fighter, options: PatternOptions & { minCount?: number; minShare?: number } = {}): Insight[] {
  const minCount = options.minCount ?? 3;
  const minShare = options.minShare ?? 0.4;
  const who = fighter === 'you' ? 'You' : 'They';
  const whom = fighter === 'you' ? 'they' : 'you';
  const out: Insight[] = [];

  for (const { action } of topActions(tags, fighter, 6)) {
    const follow = followUps(tags, fighter, action, options);
    const best = follow.outcomes[0];
    if (best && best.count >= minCount && best.share >= minShare) {
      out.push({
        text: best.action === null
          ? `${who} usually stop after a ${action.toLowerCase()}: no follow-up in ${best.count} of ${follow.total} (${pct(best.share)})`
          : `After a ${action.toLowerCase()}, ${who.toLowerCase()} follow with a ${best.action.toLowerCase()} ${best.count} of ${follow.total} times (${pct(best.share)})`,
        total: follow.total, count: best.count, evidence: best.evidence, reliable: follow.total >= MIN_RELIABLE,
      });
    }
    const reply = responses(tags, fighter, action, options);
    const top = reply.outcomes[0];
    if (top && top.count >= minCount && top.share >= minShare) {
      out.push({
        text: top.action === null
          ? `When ${who.toLowerCase()} ${action.toLowerCase()}, ${whom} don't respond within 1s: ${top.count} of ${reply.total} (${pct(top.share)})`
          : `When ${who.toLowerCase()} ${action.toLowerCase()}, ${whom} answer with a ${top.action.toLowerCase()} ${top.count} of ${reply.total} times (${pct(top.share)})`,
        total: reply.total, count: top.count, evidence: top.evidence, reliable: reply.total >= MIN_RELIABLE,
      });
    }
  }
  // Strongest first: share weighted toward larger samples (a 4/5 is weaker evidence than 16/20).
  const strength = (i: Insight) => (i.count / i.total) * Math.min(1, i.total / 10);
  return out.sort((a, b) => strength(b) - strength(a));
}
