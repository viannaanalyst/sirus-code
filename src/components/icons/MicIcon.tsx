export function MicIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12.0009 19C15.0764 19 17.7195 17.1489 18.8769 14.5M12.0009 19C8.92546 19 6.28233 17.1489 5.125 14.5M12.0009 19V21.25M12.0009 15.75C9.65372 15.75 7.75093 13.8472 7.75093 11.5V7C7.75093 4.65279 9.65372 2.75 12.0009 2.75C14.3481 2.75 16.2509 4.65279 16.2509 7V11.5C16.2509 13.8472 14.3481 15.75 12.0009 15.75Z"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
