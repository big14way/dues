// Dues mark: a rounded tile holding a lower-case d whose bowl is a coin. Fixed colours in both themes.
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="Dues">
      <rect width="32" height="32" rx="8" fill="#0f7b5f" />
      <circle cx="14" cy="18" r="6.25" fill="none" stroke="#ffffff" strokeWidth="2.5" />
      <path d="M20.25 7.5v17" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="14" cy="18" r="1.6" fill="#a7f0d3" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2">
      <Mark size={26} />
      <span className="text-[17px] font-semibold tracking-[-0.01em] text-ink">Dues</span>
    </span>
  );
}
