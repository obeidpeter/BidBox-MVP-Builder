import {
  BadgeCheck,
  Calculator,
  FileSearch,
  Link2,
  UserRoundCheck,
} from "lucide-react";

const reviewTrail = [
  {
    label: "Tender source",
    value: "Sample invitation to tender (ITT) / clause 4.2 / page 18",
    note: "Source page recorded",
  },
  {
    label: "Draft requirement",
    value: "Provide a valid tax clearance certificate for the stated period.",
    note: "Confirmed by a reviewer",
  },
  {
    label: "Evidence match",
    value: "Certificate found, but it does not cover one required year.",
    note: "Partial match",
  },
  {
    label: "Finding and action",
    value:
      "Missing compliance evidence: obtain and verify the missing year before the final report.",
    note: "Owner: Compliance lead",
  },
] as const;

export function BidAutopsySample() {
  return (
    <figure className="overflow-hidden rounded-[2rem] border border-sidebar-border bg-sidebar-accent/65 text-sidebar-foreground shadow-[0_34px_110px_-58px_hsl(var(--sidebar-primary)/0.85)]">
      <div className="flex flex-col gap-3 border-b border-sidebar-border bg-sidebar/55 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sidebar-primary">
            Example report
          </p>
          <p className="mt-1 text-sm text-sidebar-foreground/65">
            Sample content - not a client record
          </p>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-sidebar-border bg-sidebar px-3 py-1.5 text-xs text-sidebar-foreground/80">
          <UserRoundCheck
            aria-hidden="true"
            className="size-4 text-sidebar-primary"
          />
          Human review recorded
        </span>
      </div>

      <div className="grid bg-sidebar/35 lg:grid-cols-[1fr_18rem]">
        <div className="p-5 sm:p-7">
          <div className="border-y border-sidebar-border">
            {reviewTrail.map((item, index) => (
              <div
                key={item.label}
                className="grid gap-4 border-b border-sidebar-border py-5 last:border-b-0 sm:grid-cols-[2.5rem_9rem_1fr] sm:items-start"
              >
                <span className="font-mono text-xs text-sidebar-foreground/55">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-sidebar-primary">
                  {index === 0 ? (
                    <FileSearch aria-hidden="true" className="size-4" />
                  ) : index === 1 ? (
                    <Link2 aria-hidden="true" className="size-4" />
                  ) : index === 2 ? (
                    <BadgeCheck aria-hidden="true" className="size-4" />
                  ) : (
                    <UserRoundCheck aria-hidden="true" className="size-4" />
                  )}
                  {item.label}
                </div>
                <div>
                  <p className="text-sm font-medium leading-6 text-sidebar-foreground">
                    {item.value}
                  </p>
                  <p className="mt-1 text-xs text-sidebar-foreground/60">
                    {item.note}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-sidebar-border bg-sidebar-accent/55 p-6 lg:border-l lg:border-t-0 lg:p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/60">
            Review snapshot
          </p>
          <dl className="mt-8 space-y-6">
            <div className="border-t border-sidebar-border pt-4">
              <dt className="text-xs text-sidebar-foreground/60">
                Classification
              </dt>
              <dd className="mt-1 font-semibold text-amber-300">
                Missing compliance evidence
              </dd>
            </div>
            <div className="border-t border-sidebar-border pt-4">
              <dt className="text-xs text-sidebar-foreground/60">Status</dt>
              <dd className="mt-1 font-semibold">Open</dd>
            </div>
            <div className="border-t border-sidebar-border pt-4">
              <dt className="text-xs text-sidebar-foreground/60">
                Evidence status
              </dt>
              <dd className="mt-1 font-semibold">Partial</dd>
            </div>
            <div className="border-t border-sidebar-border pt-4">
              <dt className="flex items-center gap-2 text-xs text-sidebar-foreground/60">
                <Calculator aria-hidden="true" className="size-4" />
                Bill of quantities check
              </dt>
              <dd className="mt-1 text-sm leading-6 text-sidebar-foreground/75">
                One line total differs from the quantity multiplied by the
                client-supplied rate.
              </dd>
            </div>
          </dl>
        </div>
      </div>
      <figcaption className="border-t border-sidebar-border bg-sidebar-accent px-5 py-3 text-xs leading-5 text-sidebar-foreground/60">
        This example shows how Valo reviews a bid. Valo confirms what it can
        check for each piece of work.
      </figcaption>
    </figure>
  );
}
