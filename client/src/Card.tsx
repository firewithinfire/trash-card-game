import { Card as C, RANK_LABEL, SUIT_SYMBOL } from '../../shared/game';

interface Props {
  card?: C | null; // null/undefined = face-down back
  size?: 'xs' | 'sm' | 'md' | 'lg';
  selected?: boolean;
  playable?: boolean;
  dim?: boolean;
  onClick?: () => void;
  label?: string;
  className?: string;
}

export function CardView({ card, size = 'md', selected, playable, dim, onClick, label, className = '' }: Props) {
  const cls = ['card', size, card ? (card.suit === 'H' || card.suit === 'D' ? 'red' : 'black') : 'back', selected && 'selected', playable && 'playable', dim && 'dim', onClick && 'tappable', className]
    .filter(Boolean)
    .join(' ');
  const inner = card ? (
    <>
      <span className="corner tl">{RANK_LABEL[card.rank]}<br />{SUIT_SYMBOL[card.suit]}</span>
      <span className="pip">{card.rank === 10 ? '🗑️' : SUIT_SYMBOL[card.suit]}</span>
      <span className="corner br">{RANK_LABEL[card.rank]}<br />{SUIT_SYMBOL[card.suit]}</span>
    </>
  ) : (
    <span className="back-pattern" />
  );
  const aria = label ?? (card ? `${RANK_LABEL[card.rank]} of ${({ S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' } as const)[card.suit]}` : 'face-down card');
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} aria-label={aria} aria-pressed={!!selected}>{inner}</button>
  ) : (
    <div className={cls} aria-label={aria}>{inner}</div>
  );
}
