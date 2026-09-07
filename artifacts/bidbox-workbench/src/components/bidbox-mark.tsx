import { cn } from "@/lib/utils";

/** Two stacked box forms make the BidBox B; keep public brand assets in sync. */
export function BidBoxSymbol({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={cn("size-8 shrink-0", className)}
      viewBox="0 0 32 32"
      fill="none"
    >
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="7.5"
        fill="#0D1B2F"
        stroke="#62C8B5"
        strokeOpacity="0.25"
      />
      <path
        fillRule="evenodd"
        d="M8 6H18L23 10V12L18 16H8V6ZM11.5 9.5V12.5H16.8L19 11L16.8 9.5H11.5Z"
        fill="#F7F5F0"
      />
      <path
        fillRule="evenodd"
        d="M8 17H19L24 21V23L19 27H8V17ZM11.5 20.5V23.5H17.8L20 22L17.8 20.5H11.5Z"
        fill="#62C8B5"
      />
    </svg>
  );
}

export function BidBoxMark({
  className,
  label = "BidBox",
}: {
  className?: string;
  label?: string | null;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BidBoxSymbol />
      {label ? (
        <span className="text-base font-semibold tracking-[-0.02em]">
          {label}
        </span>
      ) : null}
    </span>
  );
}
