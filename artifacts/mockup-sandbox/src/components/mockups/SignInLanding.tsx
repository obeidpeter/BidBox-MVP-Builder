/**
 * MOCKUP of the BidBox sign-in landing ("The Sealed Dossier" — synthesized).
 * Mirror of artifacts/bidbox-workbench/src/pages/sign-in.tsx with the Clerk
 * widget replaced by a static stand-in card so it renders in the sandbox.
 */

/** Faint engineering-ledger grid over the whole page (both themes via currentColor). */
function LedgerGrid() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 h-full w-full text-foreground"
    >
      <defs>
        <pattern
          id="bidbox-page-grid"
          width="48"
          height="48"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M48 0H0V48"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.5"
          />
        </pattern>
      </defs>
      <rect
        width="100%"
        height="100%"
        fill="url(#bidbox-page-grid)"
        opacity="0.05"
      />
    </svg>
  );
}

/** Registrar's seal — inline SVG, currentColor only, one near-static rotation. */
function RegistrarSeal() {
  return (
    <svg
      viewBox="0 0 120 120"
      className="h-24 w-24 text-primary sm:h-28 sm:w-28"
      role="img"
      aria-label="BidBox Workbench registrar's seal"
    >
      <circle
        cx="60"
        cy="60"
        r="58"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.55"
      />
      <circle
        cx="60"
        cy="60"
        r="55.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.5"
        opacity="0.3"
      />
      <circle
        cx="60"
        cy="60"
        r="41"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.75"
        opacity="0.45"
      />
      <circle
        cx="60"
        cy="60"
        r="37.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeDasharray="0.5 3.5"
        strokeLinecap="round"
        opacity="0.35"
      />

      {/* Circumferential legend — rotates once every two minutes; textLength pins
          the legend to the exact circumference so the ring closes cleanly. */}
      <g className="origin-center animate-[spin_120s_linear_infinite] motion-reduce:animate-none">
        <defs>
          <path
            id="bidbox-seal-path"
            d="M 60,60 m -48,0 a 48,48 0 1,1 96,0 a 48,48 0 1,1 -96,0"
            fill="none"
          />
        </defs>
        <text
          className="font-mono uppercase"
          fontSize="6.4"
          fill="currentColor"
          opacity="0.75"
        >
          <textPath
            href="#bidbox-seal-path"
            startOffset="0"
            textLength="301"
            lengthAdjust="spacingAndGlyphs"
          >
            BidBox Bid Autopsy Workbench · Forensic Review · Chain of Custody
            ·&#160;
          </textPath>
        </text>
      </g>

      <g transform="translate(44 37)">
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
      </g>
      <line
        x1="47"
        y1="70.5"
        x2="73"
        y2="70.5"
        stroke="currentColor"
        strokeWidth="0.5"
        opacity="0.5"
      />
      <text
        x="60"
        y="78"
        textAnchor="middle"
        dominantBaseline="central"
        className="font-mono uppercase"
        fontSize="5.2"
        letterSpacing="1.6"
        fill="currentColor"
        opacity="0.7"
      >
        Gate 0 · NG
      </text>
    </svg>
  );
}

/** Legal-stationery hairline double rule. */
function DoubleRule({ className = "" }: { className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      <div className="border-t border-border" />
      <div className="mt-[3px] border-t border-border/60" />
    </div>
  );
}

/** Static stand-in for the Clerk <SignIn /> card (sandbox only). */
function ClerkCardStandIn() {
  return (
    <div className="w-full max-w-[400px] rounded-lg bg-card p-8">
      <h2 className="text-center font-serif text-xl text-foreground">
        Sign in to BidBox Workbench
      </h2>
      <p className="mt-1 text-center text-sm text-muted-foreground">
        Welcome back! Please sign in to continue
      </p>
      <div className="mt-6 space-y-3">
        <div className="flex h-9 items-center justify-center rounded-md border border-border text-sm text-foreground">
          Continue with Google
        </div>
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">or</span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <div>
          <p className="mb-1 text-sm text-foreground">Email address</p>
          <div className="h-9 rounded-md border border-border bg-background" />
        </div>
        <div className="flex h-9 items-center justify-center rounded-md bg-primary text-sm text-primary-foreground">
          Continue
        </div>
      </div>
    </div>
  );
}

export default function SignInLanding() {
  return (
    <div className="relative flex min-h-screen flex-col bg-background text-foreground">
      <LedgerGrid />

      {/* ── Classification strip ─────────────────────────────────────────── */}
      <header className="relative border-b border-border">
        <p className="mx-auto max-w-3xl truncate px-4 py-2.5 text-center font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground sm:text-[10px] sm:tracking-[0.3em]">
          Confidential&nbsp;&nbsp;//&nbsp;&nbsp;Authorized personnel only
        </p>
      </header>

      {/* ── Dossier cover ────────────────────────────────────────────────── */}
      <main className="relative mx-auto flex w-full max-w-md flex-1 flex-col items-center px-4 py-10 sm:max-w-lg sm:py-12">
        {/* Seal + masthead */}
        <section className="flex w-full flex-col items-center text-center animate-in fade-in slide-in-from-bottom-4 fill-mode-both duration-700">
          <RegistrarSeal />

          <DoubleRule className="mt-8 w-full" />

          <h1 className="mt-6 font-serif text-3xl leading-tight tracking-tight text-foreground sm:text-4xl">
            Bid Autopsy Workbench
          </h1>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
            BidBox &middot; Forensic tender review &middot; Nigeria
          </p>

          <DoubleRule className="mt-6 w-full" />

          <p className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/80">
            <span className="whitespace-nowrap">Deterministic core</span>
            <span aria-hidden="true">&middot;</span>
            <span className="whitespace-nowrap">LLM shell</span>
            <span aria-hidden="true">&middot;</span>
            <span className="whitespace-nowrap">Named-human sign-off</span>
          </p>
        </section>

        {/* Mounted exhibit: the sign-in card */}
        <section
          className="mt-10 w-full animate-in fade-in slide-in-from-bottom-4 fill-mode-both duration-700"
          style={{ animationDelay: "200ms" }}
        >
          <p className="mb-4 text-center font-serif text-lg italic text-muted-foreground">
            State your identity for the record.
          </p>

          <div className="relative border border-border bg-card shadow-sm">
            {/* Registration corner marks */}
            <span
              aria-hidden="true"
              className="absolute -left-px -top-px h-3 w-3 border-l-2 border-t-2 border-primary"
            />
            <span
              aria-hidden="true"
              className="absolute -right-px -top-px h-3 w-3 border-r-2 border-t-2 border-primary"
            />
            <span
              aria-hidden="true"
              className="absolute -bottom-px -left-px h-3 w-3 border-b-2 border-l-2 border-primary"
            />
            <span
              aria-hidden="true"
              className="absolute -bottom-px -right-px h-3 w-3 border-b-2 border-r-2 border-primary"
            />

            {/* Exhibit tab set into the top rule */}
            <p className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap bg-background px-3 font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
              Exhibit A &middot; Access
            </p>

            <div className="flex justify-center px-4 py-8 sm:px-6">
              <ClerkCardStandIn />
            </div>
          </div>

          <p className="mt-5 text-center font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground/70">
            Access is logged to the audit chain
          </p>
        </section>
      </main>

      {/* ── Provenance strip ─────────────────────────────────────────────── */}
      <footer className="relative border-t border-border bg-background">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-6 py-3 font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground sm:px-10 sm:text-[10px]">
          <span>Engine bidbox-autopsy-engine/gate0-v1</span>
          <span className="hidden items-center gap-1.5 md:flex">
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-600"
            />
            SHA-256 audit chain &middot; Named-reviewer sign-off
          </span>
          <span>Confidential</span>
        </div>
      </footer>
    </div>
  );
}
