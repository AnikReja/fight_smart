import { useEffect } from 'react';

const Row = ({ label, keys }: { label: string; keys: string[] }) => (
  <p>
    {label}
    <span>{keys.map(k => <kbd key={k}>{k}</kbd>)}</span>
  </p>
);

/** Keyboard reference shown as a dialog (open with ? or the header button, close with Esc). */
export function ShortcutGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modalBackdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="shortcutsTitle" onClick={e => e.stopPropagation()}>
        <div className="modalHeader">
          <h2 id="shortcutsTitle">Keyboard shortcuts</h2>
          <button type="button" className="iconButton" onClick={onClose} aria-label="Close">✕</button>
        </div>
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
            <h4>Last punch</h4>
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
          </div>
          <div>
            <h4>Video</h4>
            <Row label="Play / Pause" keys={['Space']} />
            <Row label="Back / forward 5s" keys={['←', '→']} />
            <Row label="Back / forward 1s" keys={['⇧←', '⇧→']} />
            <Row label="Frame step" keys={[',', '.']} />
            <Row label="Slower / Faster" keys={['[', ']']} />
            <h4>Rounds</h4>
            <Row label="Start round" keys={['N']} />
            <Row label="End round" keys={['⇧N']} />
            <h4>Help</h4>
            <Row label="This list" keys={['?']} />
          </div>
        </div>
        <p className="shortcutHint">Shortcuts are ignored while typing in a text field.</p>
      </div>
    </div>
  );
}
