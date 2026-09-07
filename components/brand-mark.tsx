export function BrandMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="6" className="fill-navy-900" />
      <rect x="1.2" y="1.2" width="29.6" height="29.6" rx="5" className="fill-none stroke-amber-400" strokeWidth="1.4" />
      <path
        d="M21.2 10.2c-1-1.4-2.8-2.3-5.1-2.3-4 0-6.8 2.8-6.8 8.1s2.8 8.1 6.8 8.1c2.4 0 4.2-.9 5.2-2.4"
        className="fill-none stroke-white"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
