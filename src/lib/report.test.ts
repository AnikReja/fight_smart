import { describe, expect, it } from 'vitest';
import { detectCombinations } from './combinations';
import { buildReport, escapeHtml, reportFileName } from './report';
import type { ReportInput } from './report';
import type { Fighter, Outcome, Tag } from './types';

let n = 0;
const tag = (time: number, label: string, fighter: Fighter = 'opponent', outcome?: Outcome, note = ''): Tag =>
  ({ id: `t${n++}`, time, label, note, fighter, ...(outcome ? { outcome } : {}) });

const input = (tags: Tag[], over: Partial<ReportInput> = {}): ReportInput => ({
  videoName: 'round3.mp4', fighter: 'opponent', scopeLabel: 'All rounds', tags, combos: detectCombinations(tags),
  reviews: {}, rounds: [], generatedAt: new Date('2026-11-20T12:00:00Z'), ...over,
});

// The opponent jabs then crosses four times, and you slip the jab each time.
const habitTags = [0, 10, 20, 30].flatMap(t => [tag(t, 'Jab', 'opponent', 'landed'), tag(t + 0.5, 'Cross', 'opponent', 'missed'), tag(t + 0.3, 'Slip', 'you')]);

describe('escapeHtml', () => {
  it('neutralises markup characters', () => {
    expect(escapeHtml(`<script>"a" & 'b'</script>`)).toBe('&lt;script&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/script&gt;');
  });
});

describe('buildReport', () => {
  it('is a complete document with no external resources', () => {
    const html = buildReport(input(habitTags));
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toMatch(/(src|href)=["']https?:/);
    expect(html).toContain('Scouting report: Opponent');
    expect(html).toContain('2026-11-20');
  });

  it('never lets a video name become markup', () => {
    const html = buildReport(input(habitTags, { videoName: '<img src=x onerror=alert(1)>.mp4' }));
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;.mp4');
  });

  it('includes stats, findings with their timestamps, and sequences', () => {
    const html = buildReport(input(habitTags));
    expect(html).toContain('<strong>8</strong>'); // punches
    expect(html).toContain('50%'); // 4 landed of 8 with an outcome
    expect(html).toContain('After a jab, they follow with a cross 4 of 4 times (100%)');
    expect(html).toContain('When they jab, you answer with a slip 4 of 4 times (100%)');
    expect(html).toContain('Jab → Cross');
    for (const t of ['00:00', '00:10', '00:20', '00:30']) expect(html).toContain(t);
  });

  it('marks small samples', () => {
    expect(buildReport(input(habitTags))).toContain('small sample'); // n = 4 < 5
    const many = [0, 10, 20, 30, 40, 50].flatMap(t => [tag(t, 'Jab'), tag(t + 0.5, 'Cross')]);
    expect(buildReport(input(many, { fighter: 'opponent' }))).not.toMatch(/Key findings[\s\S]*?small sample[\s\S]*?Repeated/);
  });

  it('writes from your side for a self-review and handles no data', () => {
    expect(buildReport(input(habitTags, { fighter: 'you' }))).toContain('Self-review: You');
    expect(buildReport(input([]))).toContain('No tagged actions for this fighter');
  });

  it('adds a per-round table only for the all-rounds scope', () => {
    const rounds = [{ id: 'a', start: 0, end: 15 }, { id: 'b', start: 15 }];
    const all = buildReport(input(habitTags, { rounds }));
    expect(all).toContain('By round');
    expect(all).toContain('<td>Round 1</td><td class="num">4</td><td class="num">2/4</td>');
    expect(buildReport(input(habitTags, { rounds, scopeLabel: 'Round 1' }))).not.toContain('By round');
  });
});

describe('reportFileName', () => {
  it('makes a safe file name', () => {
    expect(reportFileName('Anik vs Ayan (round 3).mp4', 'opponent')).toBe('Anik-vs-Ayan-round-3-opponent-report.html');
    expect(reportFileName('', 'you')).toBe('fightsmart-you-report.html');
  });
});
