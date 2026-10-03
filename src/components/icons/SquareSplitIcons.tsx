interface IconProps {
  size?: number;
  className?: string;
}

/** Phosphor square-split-horizontal (Synara's "Split Right" glyph). */
export function SplitRightIcon({ size = 12, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="currentColor" className={className} aria-hidden="true">
      <path d="M200,40H56A16,16,0,0,0,40,56V200a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V56A16,16,0,0,0,200,40ZM56,56h64V200H56ZM200,200H136V56h64V200Z" />
    </svg>
  );
}

/** Phosphor square-split-vertical (Synara's "Split Down" glyph). */
export function SplitDownIcon({ size = 12, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="currentColor" className={className} aria-hidden="true">
      <path d="M200,40H56A16,16,0,0,0,40,56V200a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V56A16,16,0,0,0,200,40Zm0,16v64H56V56Zm0,144H56V136H200v64Z" />
    </svg>
  );
}
