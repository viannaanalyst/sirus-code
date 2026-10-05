/** Quill marking a session whose composer holds unsent text. Original drawing. */
export function DraftIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M5.5 20.5c.2-7.4 4.6-14.2 14-16.5-.6 3-1.7 5-3.4 6.4l2.1.4c-1.9 4.3-6.1 7.2-11.6 7.6" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 20.5 12 12" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
