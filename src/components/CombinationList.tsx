import { resolveReview } from '../lib/combinations';
import { stampPrecise } from '../lib/format';
import type { Combination, ReviewStatus, Reviews } from '../lib/types';

type Props = {
  combinations: Combination[];
  reviews: Reviews;
  onSeek: (time: number) => void;
  onReview: (combo: Combination, decision: ReviewStatus | null) => void;
};

const BADGE = { confirmed: '✓ Confirmed', rejected: '✕ Rejected', changed: '⟳ Tags changed', pending: 'Needs review' };

export function CombinationList({ combinations, reviews, onSeek, onReview }: Props) {
  return (
    <div className="combinationSection">
      <p className="hint">Punches by the same fighter less than 1.5s apart. Confirm the real combinations.</p>
      {combinations.length === 0 ? (
        <p className="hint">Tag consecutive punches to discover combinations.</p>
      ) : (
        <div className="combinationList">
          {combinations.map(combo => {
            const review = resolveReview(combo, reviews);
            return (
              <div key={combo.id} className={`combinationCard fighter-${combo.fighter}`}>
                <div className="comboHeader">
                  <span className="comboFighter">{combo.fighter === 'you' ? 'You' : 'Opponent'}</span>
                  <span className={`reviewBadge ${review.state}`}>{BADGE[review.state]}</span>
                </div>
                <strong className="comboPunches" title={combo.punches.join(' → ')}>
                  {combo.punches.slice(0, 5).join(' → ')}
                  {combo.punches.length > 5 && <span className="more"> +{combo.punches.length - 5} more</span>}
                </strong>
                {review.state === 'changed' && (
                  <p className="comboChanged">
                    {review.previous === 'mixed'
                      ? 'Punches changed since you reviewed this. Please re-review.'
                      : `Previously ${review.previous}, but the punches changed. Please re-review.`}
                  </p>
                )}
                <button type="button" className="comboTime" onClick={() => onSeek(combo.start)}>
                  ▶ Review at {stampPrecise(combo.start)}
                </button>
                <div className="reviewButtons">
                  <button type="button" className="confirmButton" aria-pressed={review.state === 'confirmed'} onClick={() => onReview(combo, 'confirmed')}>✓ Confirm</button>
                  <button type="button" className="rejectButton" aria-pressed={review.state === 'rejected'} onClick={() => onReview(combo, 'rejected')}>✕ Reject</button>
                </div>
                {review.state !== 'pending' && (
                  <button type="button" className="undoReview" onClick={() => onReview(combo, null)}>
                    {review.state === 'changed' ? 'Clear old decision' : 'Undo decision'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
