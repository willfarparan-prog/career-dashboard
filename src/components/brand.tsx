/** The app mark: a brand-blue cloud with a briefcase, in the spirit of Lightning's logo slot. */
export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round(size * 0.7)} viewBox="0 0 60 42" aria-hidden className="shrink-0">
      <path
        d="M25 4c4.1 0 7.7 2.2 9.7 5.5A10.5 10.5 0 0 1 49.5 15a9 9 0 0 1 3.5 17.3A9.5 9.5 0 0 1 40 38.4a10 10 0 0 1-15.6 1.4A10.5 10.5 0 0 1 9.6 34 8.9 8.9 0 0 1 6.4 18 11 11 0 0 1 25 4z"
        fill="#0176d3"
      />
      <rect x="21" y="18" width="18" height="12" rx="2" fill="#fff" />
      <path d="M26 18v-2.2a1.8 1.8 0 0 1 1.8-1.8h4.4a1.8 1.8 0 0 1 1.8 1.8V18" stroke="#fff" strokeWidth="2" fill="none" />
      <rect x="21" y="22.5" width="18" height="1.6" fill="#0176d3" />
    </svg>
  );
}
