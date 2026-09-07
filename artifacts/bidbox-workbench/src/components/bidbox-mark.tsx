import { cn } from "@/lib/utils";

export function ValoMark({
  className,
  label = "Valo",
}: {
  className?: string;
  label?: string | null;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg
        aria-hidden="true"
        className="size-8 shrink-0"
        viewBox="0 0 32 32"
        fill="none"
      >
        <rect width="32" height="32" rx="7" fill="currentColor" />
        <path
          d="M8.25 9.25 15.9 24 23.75 9.25h-4.4L15.9 17.1l-3.33-7.85H8.25Z"
          fill="white"
        />
        <path d="M22.1 7.2h3.05l-1.35 2.7h-3.05l1.35-2.7Z" fill="#74d6c4" />
      </svg>
      {label ? (
        <span className="text-base font-semibold tracking-[-0.02em]">
          {label}
        </span>
      ) : null}
    </span>
  );
}
