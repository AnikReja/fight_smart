const Row = ({ label, keys }: { label: string; keys: string[] }) => (
  <p>
    {label}
    <span>{keys.map(k => <kbd key={k}>{k}</kbd>)}</span>
  </p>
);

export function ShortcutGuide() {
  return (
    <details className="shortcutPanel" open>
      <summary>⌨ Keyboard Shortcuts</summary>
      <div className="shortcutGrid">
        <div>
          <h4>Fighter</h4>
          <Row label="You" keys={['1']} />
          <Row label="Opponent" keys={['2']} />

          <h4>Punches</h4>
          <Row label="Jab" keys={['J']} />
          <Row label="Cross" keys={['C']} />
          <Row label="Hook" keys={['H']} />
          <Row label="Uppercut" keys={['U']} />
          <Row label="Feint" keys={['F']} />

          <h4>Last punch outcome</h4>
          <Row label="Landed" keys={['Q']} />
          <Row label="Blocked" keys={['W']} />
          <Row label="Missed" keys={['E']} />
          <Row label="Undo last tag" keys={['Z']} />
        </div>
        <div>
          <h4>Defense</h4>
          <Row label="Slip" keys={['S']} />
          <Row label="Roll" keys={['R']} />
          <Row label="Block" keys={['B']} />
          <Row label="Catch" keys={['K']} />
          <Row label="Parry" keys={['P']} />
          <Row label="Pull back" keys={['L']} />
          <Row label="Step back" keys={['T']} />

          <h4>Other</h4>
          <Row label="Mistake" keys={['M']} />
          <Row label="Other" keys={['O']} />

          <h4>Video & rounds</h4>
          <Row label="Play / Pause" keys={['Space']} />
          <Row label="∓5 sec" keys={['←', '→']} />
          <Row label="∓1 sec" keys={['⇧←', '⇧→']} />
          <Row label="Frame step" keys={[',', '.']} />
          <Row label="Slower / Faster" keys={['[', ']']} />
          <Row label="Start round" keys={['N']} />
          <Row label="End round" keys={['⇧N']} />
        </div>
      </div>
      <p className="shortcutHint">Shortcuts work when you're not typing in a text field.</p>
    </details>
  );
}
