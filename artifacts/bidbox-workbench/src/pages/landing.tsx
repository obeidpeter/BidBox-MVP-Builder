import { ArrowDown, Check, FileSearch, UserRoundCheck } from "lucide-react";
import { LandingSections } from "@/components/public/landing-sections";
import { PublicMeta } from "@/components/public/public-meta";
import { BidAutopsyCta } from "@/components/public/public-primary-cta";
import { PublicShell } from "@/components/public/public-shell";

const sampleFindings = [
  {
    title: "Signed declaration is absent",
    source: "Submission instructions / clause 7.1",
    label: "Must fix",
    tone: "border-destructive/35 bg-destructive/10 text-sidebar-foreground",
  },
  {
    title: "Certificate period is incomplete",
    source: "Eligibility criteria / clause 4.2",
    label: "Missing evidence",
    tone: "border-warning/45 bg-warning/10 text-sidebar-foreground",
  },
  {
    title: "Method statement misses one scored criterion",
    source: "Technical evaluation / criterion T-05",
    label: "Scoring risk",
    tone: "border-info/35 bg-info/10 text-sidebar-foreground",
  },
] as const;

function HeroReviewPreview() {
  return (
    <figure
      className="relative overflow-hidden rounded-[1.75rem] border border-sidebar-border bg-sidebar-accent/75 text-sidebar-foreground shadow-[0_32px_100px_-48px_hsl(var(--sidebar-primary)/0.8)] backdrop-blur-sm"
      aria-label="Example Bid Autopsy issues list"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sidebar-border bg-sidebar/70 px-5 py-4 sm:px-6">
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-sidebar-primary">
          <span aria-hidden="true" className="size-2 rounded-full bg-success" />
          Example review / fictional data
        </p>
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-sidebar-foreground/60">
          VA-042 / pre-submission
        </p>
      </div>
      <div className="grid lg:grid-cols-[15rem_1fr]">
        <div className="border-b border-sidebar-border bg-sidebar/45 p-6 lg:border-b-0 lg:border-r">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/55">
            Requirements checked
          </p>
          <p className="public-display mt-2 text-7xl font-medium tracking-[-0.07em] text-sidebar-foreground">
            42
          </p>
          <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-sidebar">
            <div className="h-full w-[83%] rounded-full bg-sidebar-primary" />
          </div>
          <p className="mt-2 text-xs leading-5 text-sidebar-foreground/55">
            35 supported / 7 need attention
          </p>
          <dl className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-1">
            <div className="border-t border-sidebar-border pt-3">
              <dt className="text-xs text-sidebar-foreground/55">Shown</dt>
              <dd className="mt-1 text-2xl font-medium text-warning">03</dd>
            </div>
            <div className="border-t border-sidebar-border pt-3">
              <dt className="text-xs text-sidebar-foreground/55">Must fix</dt>
              <dd className="mt-1 text-2xl font-medium text-destructive">01</dd>
            </div>
          </dl>
        </div>

        <div className="p-5 sm:p-6">
          <div className="flex flex-col gap-3 border-b border-sidebar-border pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sidebar-primary">
                Issues to fix
              </p>
              <p className="mt-2 text-xl font-medium tracking-[-0.02em]">
                What needs attention before submission
              </p>
            </div>
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-sidebar-border bg-sidebar px-3 py-1.5 text-xs text-sidebar-foreground/75">
              <UserRoundCheck
                aria-hidden="true"
                className="size-4 text-sidebar-primary"
              />
              Reviewer assigned
            </span>
          </div>
          <div>
            {sampleFindings.map((finding, index) => (
              <article
                key={finding.title}
                className="grid gap-3 border-b border-sidebar-border py-5 sm:grid-cols-[2rem_1fr_auto] sm:items-start"
              >
                <span className="font-mono text-xs text-sidebar-foreground/55">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <p className="text-sm font-semibold">{finding.title}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs leading-5 text-sidebar-foreground/55">
                    <FileSearch
                      aria-hidden="true"
                      className="size-3.5 shrink-0"
                    />
                    {finding.source}
                  </p>
                </div>
                <span
                  className={`w-fit shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${finding.tone}`}
                >
                  {finding.label}
                </span>
              </article>
            ))}
          </div>
          <div className="mt-5 flex items-start gap-3 text-xs leading-5 text-sidebar-foreground/60">
            <Check
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-sidebar-primary"
            />
            The full review records each issue&apos;s source, evidence status,
            owner, next action and human-review history.
          </div>
        </div>
      </div>
      <figcaption className="border-t border-sidebar-border bg-sidebar/60 px-5 py-3 text-xs text-sidebar-foreground/55 sm:px-6">
        Illustrative Valo review using fictional tender data.
      </figcaption>
    </figure>
  );
}

export default function LandingPage() {
  return (
    <PublicShell>
      <PublicMeta
        title="Bid Autopsy for Nigerian Tenders"
        description="Find missing requirements, weak evidence, bill of quantities (BOQ) errors and answers that may not meet the tender criteria before submission."
        path="/"
      />

      <section className="relative isolate overflow-hidden border-b border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div
          aria-hidden="true"
          className="public-document-grid pointer-events-none absolute inset-0 opacity-25"
        />
        <div
          aria-hidden="true"
          className="public-dark-glow pointer-events-none absolute inset-0"
        />
        <div className="landing-hero-grid content-shell relative py-14 sm:py-20 lg:py-24">
          <div className="landing-hero-copy">
            <h1 className="public-display max-w-7xl text-balance text-5xl font-medium leading-[0.94] tracking-[-0.045em] sm:text-7xl sm:tracking-[-0.065em] lg:text-[7rem] xl:text-[7.75rem]">
              <span className="block">Find the problems</span>{" "}
              <span className="block text-sidebar-primary">
                before submission.
              </span>
            </h1>
            <div className="landing-hero-details mt-10 grid gap-x-8 gap-y-6 border-t border-sidebar-border pt-7 md:grid-cols-[1.2fr_0.8fr] lg:gap-x-20">
              <p className="landing-hero-summary max-w-2xl text-xl leading-8 text-sidebar-foreground/85 sm:text-2xl sm:leading-9">
                Valo helps Nigerian public-sector, oil-and-gas and donor-funded
                bid teams find requirement gaps, weak evidence and BOQ issues
                before submission.
              </p>
              <div className="landing-hero-actions flex w-full flex-col items-start gap-4 md:col-start-2 md:row-span-2 md:row-start-1 md:w-auto md:items-end md:justify-end">
                <BidAutopsyCta className="w-full justify-center rounded-full border-sidebar-primary bg-sidebar-primary px-6 text-sidebar-primary-foreground shadow-md transition-transform hover:-translate-y-0.5 hover:bg-sidebar-primary/90 sm:w-auto" />
                <a
                  href="#what-we-check"
                  className="inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                >
                  Explore the review
                  <ArrowDown aria-hidden="true" className="size-4" />
                </a>
              </div>
              <p className="landing-hero-secondary max-w-xl text-sm leading-6 text-sidebar-foreground/70 md:col-start-1">
                Where approved, AI assists a named human reviewer. Valo links
                each requirement to its source, checks evidence and
                client-supplied bill of quantities (BOQ) calculations, and
                records what needs attention before submission.
              </p>
            </div>
          </div>
          <div className="landing-hero-preview relative mt-14 w-full lg:mt-18">
            <div
              aria-hidden="true"
              className="absolute -inset-8 bg-sidebar-primary/10 blur-3xl"
            />
            <HeroReviewPreview />
          </div>
          <p className="landing-hero-trust mt-7 max-w-4xl border-l-2 border-sidebar-primary/35 pl-4 text-xs leading-5 text-sidebar-foreground/65">
            Valo supports the review process. It cannot guarantee an award or
            that an evaluator will accept the bid. AI-assisted steps run only
            after the required AI service, privacy and model-evaluation
            approvals. A named human reviewer makes the final decision.
          </p>
        </div>
      </section>

      <LandingSections />
    </PublicShell>
  );
}
