import {
  Calculator,
  Check,
  ChevronDown,
  ClipboardCheck,
  FileSearch,
  Fingerprint,
  Landmark,
  ListChecks,
  ShieldCheck,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";
import { BidAutopsyCta } from "@/components/public/public-primary-cta";
import { BidAutopsySample } from "@/components/public/bid-autopsy-sample";

const complianceDefects = [
  "Missing or expired compliance documents",
  "Omitted signatures, declarations or schedules",
  "Mandatory requirements left unanswered",
  "Bill of quantities (BOQ) arithmetic inconsistencies",
  "Page-limit or formatting failures",
  "Incorrect package order or labelling",
  "Evidence that does not support the stated claim",
  "Technical responses that miss the published criterion",
] as const;

const autopsyDeliverables = [
  ["Requirements list", "Each requirement links back to its tender source."],
  ["Issues list", "A clear list of gaps, inconsistencies and risks."],
  [
    "Issue priority",
    "Shows what could disqualify the bid and what could reduce its score.",
  ],
  ["Evidence review", "Shows missing, expired or insufficient evidence."],
  ["BOQ findings", "Rule-based checks of client-supplied figures."],
  ["Answer review", "Shows whether answers address the published criteria."],
  ["Action plan", "Priorities, recommended actions, owners and progress."],
  [
    "Human review record",
    "Names the reviewer and explains what the review did and did not cover.",
  ],
] as const;

const process = [
  {
    number: "01",
    title: "Agree the review and safeguards",
    body: "Use the public form only for business contact details. Share tender material later, after the client agreement and required privacy, conflict and secure-sharing approvals are in place.",
  },
  {
    number: "02",
    title: "List and verify the requirements",
    body: "Valo turns tender instructions into a structured list with page and clause references. A named person must confirm every suggested item.",
  },
  {
    number: "03",
    title: "Check evidence, figures and answers",
    body: "Rule-based calculations and human review check the evidence, client-supplied bill of quantities (BOQ), answers and submission package.",
  },
  {
    number: "04",
    title: "Receive clear findings and priorities",
    body: "The customer receives each finding, its source, how serious it is and the recommended next action for the agreed review.",
  },
] as const;

const services = [
  {
    title: "Help addressing findings",
    body: "Support to fix identified requirement, evidence and answer gaps. The client remains responsible for its bid decisions.",
  },
  {
    title: "Reusable supplier-qualification packs",
    body: "Reviewed material that shows a supplier is eligible to bid, organised by the requirements it can genuinely support.",
  },
  {
    title: "Certificate records",
    body: "Certificate and evidence records kept within one organisation, with expiry and renewal details for approved users.",
  },
  {
    title: "Evidence expiry monitoring",
    body: "Shows which evidence is ready and which items need renewal when the required services and safeguards are approved.",
  },
  {
    title: "Support for consultancy partners",
    body: "Independent review and separate client workspaces for approved bid consultancies.",
  },
] as const;

const differentiators = [
  [
    Landmark,
    "Nigerian tender focus",
    "Designed around public, energy-sector and donor-funded procurement workflows.",
  ],
  [
    FileSearch,
    "Requirements linked to sources",
    "A reviewer can trace a requirement back to the clause that created it.",
  ],
  [
    Fingerprint,
    "Evidence-linked work",
    "Claims and actions remain connected to the records intended to support them.",
  ],
  [
    Calculator,
    "Rule-based calculations",
    "Valo calculates figures with fixed rules instead of asking an AI model.",
  ],
  [
    UserRoundCheck,
    "Human accountability",
    "Every conclusion shown to a client and every final report names the person responsible.",
  ],
  [
    ListChecks,
    "Transparent findings",
    "Priority, status, source, owner and next action stay visible in the review record.",
  ],
] as const;

const audiences = [
  [
    "Federal contractors",
    "Check eligibility, mandatory forms, evidence and submission requirements before a public-sector bid.",
  ],
  [
    "Nigerian oil-and-gas suppliers",
    "Trace tender requirements and qualification evidence for the Nigerian Petroleum Exchange (NipeX) and Nigerian Content Development and Monitoring Board (NCDMB). Registration on either platform does not prove that a bid meets the tender rules.",
  ],
  [
    "Donor-funded bidders and NGOs",
    "Map technical responses and compliance evidence to the published evaluation and submission rules.",
  ],
  [
    "Bid and commercial teams",
    "Coordinate requirements, owners, evidence and client-supplied figures on one review trail.",
  ],
  [
    "Consultancy partners",
    "Add an independent quality layer while preserving client ownership and clear role boundaries.",
  ],
] as const;

const integrityPrinciples = [
  "No award promises or evaluator-influence claims",
  "No fabricated credentials, experience or supporting evidence",
  "No facilitation, relationship brokering, evaluator intelligence, collusion or portal submission",
  "Commercial figures and pricing decisions remain client-supplied",
  "Each tender workspace is limited to one organisation",
  "Client data is not approved for training shared AI models",
  "Conflicts involving the same tender must be recorded and managed",
  "A named person reviews every finding shown to a client",
] as const;

const faqs = [
  [
    "What is a Bid Autopsy?",
    "It is a structured review of a tender package against the published requirements. The agreed report can include a requirements list linked to source clauses, an issues list, evidence and bill of quantities (BOQ) findings, issue priorities and an action plan.",
  ],
  [
    "Does Valo guarantee an award?",
    "No. Valo helps a team find and fix problems within its control. It cannot guarantee an evaluator’s decision, acceptance of a package or contract award.",
  ],
  [
    "Can Valo review a live bid?",
    "Yes, if Valo can agree what the review will cover and how long it will take, clear any conflicts and approve a secure document-sharing process. The public request form does not accept tender documents.",
  ],
  [
    "Can Valo review a previously unsuccessful bid?",
    "Yes. An after-the-event review can compare the submitted package, available feedback and published criteria. It clearly separates documented facts from conclusions.",
  ],
  [
    "Must financial pages be shared?",
    "Not for the first contact. If the review includes a bill of quantities (BOQ), share only the necessary commercial pages later through the approved secure process. Valo does not set prices.",
  ],
  [
    "What documents are required?",
    "That depends on the agreed review. Valo may later need the tender, clarifications, the draft or submitted response and selected evidence. Do not send any of these through the public form.",
  ],
  [
    "Does Valo create commercial pricing?",
    "No. Valo can check the calculations and consistency of client-supplied figures. The client remains responsible for rates, assumptions and pricing strategy.",
  ],
  [
    "How is information protected?",
    "The first request form accepts only ordinary business details. Tender material is handled only after the client agreement, secure sharing, user access and service approvals have been checked.",
  ],
  [
    "How long does the process take?",
    "Valo confirms timing after it understands what the review will cover, the number of documents, the deadline and the level of review. It does not promise a fixed turnaround before that assessment.",
  ],
  [
    "What happens after the Autopsy?",
    "Your team receives the agreed findings and priorities, then decides what to fix. Any further Valo support is agreed separately, and the client remains responsible for its bid decisions.",
  ],
  [
    "Can Valo help correct the identified problems?",
    "Yes, when Valo has the right capability and enough time, and the agreed work allows it. The review remains useful even if the client fixes the problems without further help.",
  ],
] as const;

export function LandingSections() {
  return (
    <>
      <nav
        aria-label="Landing page sections"
        className="relative z-20 border-b border-border bg-background/88 backdrop-blur-xl"
      >
        <div className="content-shell overflow-x-auto">
          <ul className="flex min-w-max items-center gap-1 py-3">
            {[
              ["#what-we-check", "What we check"],
              ["#how-it-works", "How it works"],
              ["#services", "Services"],
              ["#trust", "Trust"],
              ["#faq", "FAQ"],
            ].map(([href, label]) => (
              <li key={href}>
                <a
                  href={href}
                  className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <section className="relative z-10" aria-label="Operating boundaries">
        <div className="border-b border-sidebar-border bg-sidebar text-sidebar-foreground">
          <ul className="content-shell grid grid-cols-2 divide-x divide-y divide-sidebar-border sm:grid-cols-4 sm:divide-y-0">
            {[
              "No award promises",
              "Named human review",
              "Client-supplied pricing",
              "Source-linked findings",
            ].map((item) => (
              <li
                key={item}
                className="flex min-h-18 items-center gap-3 px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/70 sm:justify-center"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-sidebar-primary/25 bg-sidebar-accent">
                  <Check
                    aria-hidden="true"
                    className="size-4 text-sidebar-primary"
                  />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="relative overflow-hidden py-20 sm:py-24 lg:py-32">
        <div
          aria-hidden="true"
          className="absolute -right-32 top-12 size-80 rounded-full bg-sidebar-primary/8 blur-3xl"
        />
        <div className="content-shell relative grid gap-12 lg:grid-cols-[0.82fr_1.18fr] lg:gap-24">
          <div className="lg:sticky lg:top-36 lg:self-start">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
              Find preventable submission risks
            </p>
            <h2 className="public-display mt-5 text-balance text-4xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-5xl lg:text-6xl">
              A good bid can be rejected before anyone considers its strengths.
            </h2>
            <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground">
              Valo focuses on problems a team can prevent: a missing record, an
              unanswered instruction or an inconsistency that breaks a published
              rule.
            </p>
          </div>
          <ul className="border-t border-border">
            {complianceDefects.map((item, index) => (
              <li
                key={item}
                className="grid min-h-20 grid-cols-[2.5rem_1fr_auto] items-center gap-4 border-b border-border py-5 text-sm leading-6"
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="font-medium text-foreground/90">{item}</span>
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full bg-warning"
                />
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section
        id="what-we-check"
        className="scroll-mt-20 border-y border-border bg-card/35"
      >
        <div className="content-shell py-20 sm:py-24 lg:py-32">
          <div className="grid gap-12 lg:grid-cols-[0.72fr_1.28fr] lg:gap-20">
            <div className="lg:sticky lg:top-36 lg:self-start">
              <p className="inline-flex rounded-full border border-primary/20 bg-accent/50 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                The Bid Autopsy
              </p>
              <h2 className="public-display mt-6 text-balance text-4xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-5xl lg:text-6xl">
                A practical report, not a generic proposal review.
              </h2>
              <p className="mt-5 text-base leading-7 text-muted-foreground">
                The agreed report shows what Valo checked, where each
                requirement came from, what evidence was found, what remains at
                risk and what to do next. It also states what the review did and
                did not cover.
              </p>
              <BidAutopsyCta className="mt-8 rounded-full px-6 shadow-sm" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {autopsyDeliverables.map(([title, body], index) => (
                <article
                  key={title}
                  className="min-h-52 rounded-3xl border border-primary/15 bg-background/55 p-6"
                >
                  <span className="font-mono text-xs font-semibold text-primary/70">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="mt-10 text-xl font-medium tracking-[-0.02em]">
                    {title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {body}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section
        id="how-it-works"
        className="content-shell scroll-mt-20 py-20 sm:py-24 lg:py-32"
      >
        <div className="max-w-4xl">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
            How it works
          </p>
          <h2 className="public-display mt-5 text-balance text-4xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-5xl lg:text-6xl">
            From first contact to a review your team can act on.
          </h2>
        </div>
        <ol className="mt-14 grid border-t border-border lg:grid-cols-2">
          {process.map((step) => (
            <li
              key={step.number}
              className="relative border-b border-border py-8 lg:min-h-72 lg:px-8 lg:py-10 lg:odd:border-r"
            >
              <span className="public-display text-5xl font-medium tracking-[-0.06em] text-primary/55">
                {step.number}
              </span>
              <h3 className="mt-8 text-xl font-medium tracking-[-0.02em]">
                {step.title}
              </h3>
              <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="relative isolate overflow-hidden border-y border-sidebar-border bg-sidebar">
        <div
          aria-hidden="true"
          className="public-dark-glow pointer-events-none absolute inset-0"
        />
        <div
          aria-hidden="true"
          className="public-document-grid pointer-events-none absolute inset-0 opacity-20"
        />
        <div className="content-shell relative py-20 sm:py-24 lg:py-32">
          <div className="mb-12 max-w-5xl text-sidebar-foreground">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-sidebar-primary">
              Show the work
            </p>
            <h2 className="public-display mt-5 text-balance text-4xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-5xl lg:text-6xl">
              Follow each tender rule through to the next action.
            </h2>
            <p className="mt-6 max-w-3xl text-base leading-7 text-sidebar-foreground/70">
              Valo separates the source, requirement, evidence, finding and
              action. A reviewer can question a conclusion and still see what
              supports it.
            </p>
          </div>
          <BidAutopsySample />
        </div>
      </section>

      <section
        id="services"
        className="content-shell scroll-mt-20 py-20 sm:py-24 lg:py-32"
      >
        <div className="grid gap-12 lg:grid-cols-[0.72fr_1.28fr] lg:gap-20">
          <div className="lg:sticky lg:top-36 lg:self-start">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
              Optional follow-on support
            </p>
            <h2 className="public-display mt-5 text-balance text-4xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-5xl lg:text-6xl">
              Start with the review. Continue only where Valo can help.
            </h2>
            <p className="mt-5 text-sm leading-6 text-muted-foreground">
              Valo confirms the available service, work and price for each
              client agreement. A Bid Autopsy is the starting point.
            </p>
          </div>
          <div className="border-t border-border">
            {services.map((service, index) => (
              <article
                key={service.title}
                className="grid gap-4 border-b border-border py-7 sm:grid-cols-[3rem_0.75fr_1.25fr] sm:items-start sm:gap-6"
              >
                <span className="font-mono text-xs font-semibold text-primary/70">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="text-lg font-medium tracking-[-0.02em]">
                  {service.title}
                </h3>
                <p className="text-sm leading-6 text-muted-foreground">
                  {service.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-card/35">
        <div className="content-shell py-20 sm:py-24 lg:py-32">
          <div className="max-w-5xl">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
              Why Valo
            </p>
            <h2 className="public-display mt-5 text-balance text-4xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-5xl lg:text-6xl">
              Built around evidence a reviewer can trace.
            </h2>
          </div>
          <div className="mt-14 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {differentiators.map(([Icon, title, body]) => (
              <article
                key={title}
                className="min-h-64 rounded-3xl border border-primary/15 bg-background/55 p-7"
              >
                <span className="flex size-11 items-center justify-center rounded-full border border-primary/20 bg-accent/60 text-primary">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <h3 className="mt-10 text-xl font-medium tracking-[-0.02em]">
                  {title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="content-shell py-20 sm:py-24 lg:py-32">
        <div className="max-w-5xl">
          <span className="flex size-11 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-primary">
            <UsersRound aria-hidden="true" className="size-6" />
          </span>
          <h2 className="public-display mt-6 text-balance text-4xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-5xl lg:text-6xl">
            For teams managing complex bids under deadline.
          </h2>
        </div>
        <div className="mt-14 border-t border-border">
          {audiences.map(([title, body], index) => (
            <article
              key={title}
              className="grid gap-4 border-b border-border py-7 sm:grid-cols-[3rem_0.8fr_1.2fr] sm:items-start sm:gap-6"
            >
              <span className="font-mono text-xs font-semibold text-primary/70">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="text-lg font-medium tracking-[-0.02em] text-foreground">
                {title}
              </h3>
              <p className="text-sm leading-6 text-muted-foreground">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section
        id="trust"
        className="relative isolate scroll-mt-20 overflow-hidden border-y border-sidebar-border bg-sidebar text-sidebar-foreground"
      >
        <div
          aria-hidden="true"
          className="public-dark-glow pointer-events-none absolute inset-0"
        />
        <span
          aria-hidden="true"
          className="public-display pointer-events-none absolute -bottom-32 -left-8 text-[24rem] leading-none text-sidebar-primary/5"
        >
          V
        </span>
        <div className="content-shell relative grid gap-14 py-20 sm:py-24 lg:grid-cols-[0.82fr_1.18fr] lg:gap-20 lg:py-32">
          <div>
            <span className="flex size-12 items-center justify-center rounded-full border border-sidebar-primary/25 bg-sidebar-accent text-sidebar-primary">
              <ShieldCheck aria-hidden="true" className="size-7" />
            </span>
            <p className="mt-6 text-sm font-semibold uppercase tracking-[0.14em] text-sidebar-primary">
              Clear limits and data protection
            </p>
            <h2 className="public-display mt-5 text-balance text-4xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-5xl lg:text-6xl">
              Trust begins with clear limits.
            </h2>
            <p className="mt-5 text-base leading-7 text-sidebar-foreground/70">
              AI-assisted features run only after the service and production
              environment are approved. They cannot replace human approval or
              turn an unsupported claim into evidence.
            </p>
            <BidAutopsyCta className="mt-8 rounded-full border-sidebar-primary bg-sidebar-primary px-6 text-sidebar-primary-foreground shadow-md" />
          </div>
          <ul className="grid gap-x-8 sm:grid-cols-2">
            {integrityPrinciples.map((item, index) => (
              <li
                key={item}
                className="grid grid-cols-[2rem_1fr] gap-3 border-b border-sidebar-border py-5 text-sm leading-6 text-sidebar-foreground/80"
              >
                <span className="font-mono text-xs text-sidebar-primary/70">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section
        id="faq"
        className="content-shell scroll-mt-20 py-20 sm:py-24 lg:py-32"
      >
        <div className="grid gap-12 lg:grid-cols-[0.72fr_1.28fr] lg:gap-24">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
              FAQ
            </p>
            <h2 className="public-display mt-5 text-balance text-4xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-5xl lg:text-6xl">
              Common questions before a review.
            </h2>
          </div>
          <div className="border-t border-border">
            {faqs.map(([question, answer]) => (
              <details
                key={question}
                className="group border-b border-border px-1 open:border-primary/35"
              >
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-lg py-3 text-base font-medium leading-7 marker:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 [&::-webkit-details-marker]:hidden">
                  <span>{question}</span>
                  <ChevronDown
                    aria-hidden="true"
                    className="size-5 shrink-0 text-primary transition-transform group-open:rotate-180"
                  />
                </summary>
                <p className="max-w-3xl pb-6 pr-10 text-sm leading-6 text-muted-foreground">
                  {answer}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-sidebar-border bg-sidebar py-8 text-sidebar-foreground sm:py-12">
        <div className="content-shell">
          <div className="relative isolate flex min-h-[28rem] flex-col justify-between gap-12 overflow-hidden rounded-[2rem] border border-sidebar-border bg-sidebar-accent/50 px-6 py-10 sm:px-10 sm:py-12 lg:flex-row lg:items-end">
            <div
              aria-hidden="true"
              className="public-dark-glow pointer-events-none absolute inset-0"
            />
            <div className="relative max-w-5xl">
              <span className="flex size-11 items-center justify-center rounded-full border border-sidebar-primary/25 bg-sidebar text-sidebar-primary">
                <ClipboardCheck aria-hidden="true" className="size-6" />
              </span>
              <h2 className="public-display mt-8 text-balance text-4xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-6xl lg:text-7xl">
                Review the package before it reaches an evaluator.
              </h2>
              <p className="mt-3 text-sm leading-6 text-sidebar-foreground/70">
                Start with ordinary business contact details. No tender
                documents or sensitive commercial information are requested
                here.
              </p>
            </div>
            <BidAutopsyCta className="relative shrink-0 rounded-full border-sidebar-primary bg-sidebar-primary px-6 text-sidebar-primary-foreground shadow-md" />
          </div>
        </div>
      </section>
    </>
  );
}
