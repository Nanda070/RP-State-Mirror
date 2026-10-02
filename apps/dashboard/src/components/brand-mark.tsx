export function BrandMark({ className }: { className?: string }) {
  return (
    <div className={className ? `brand-mark ${className}` : "brand-mark"} aria-hidden>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path
          d="M12 3.5 19 8v8l-7 4.5L5 16V8l7-4.5Z"
          strokeLinejoin="round"
        />
        <path d="M12 8v8M8.5 10.5 12 12.5l3.5-2" strokeLinecap="round" />
      </svg>
    </div>
  );
}
