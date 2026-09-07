import type { ReactNode } from "react";
import { Link } from "wouter";
import {
  BadgeCheck,
  Building2,
  Check,
  CircleHelp,
  Landmark,
  LockKeyhole,
  Scale,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { PublicMeta } from "@/components/public/public-meta";
import { BidAutopsyCta } from "@/components/public/public-primary-cta";
import { PublicShell } from "@/components/public/public-shell";
import { Button } from "@/components/ui/button";

function PageIntro({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <section className="border-b border-border bg-card">
      <div className="content-shell grid gap-8 py-14 sm:py-18 lg:grid-cols-[1fr_auto] lg:items-end">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-primary">
            {eyebrow}
          </p>
          <h1 className="mt-4 text-balance text-4xl font-semibold leading-tight tracking-[-0.04em] sm:text-5xl">
            {title}
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
            {description}
          </p>
        </div>
        {children}
      </div>
    </section>
  );
}

function BidAutopsySectionCta() {
  return (
    <section className="border-t border-border bg-accent/45">
      <div className="content-shell flex flex-col gap-6 py-12 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-[-0.025em]">
            Start with a review of the tender package.
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            The public form does not accept tender files. Share sensitive
            material only after an authorised client agreement and
            non-disclosure agreement (NDA) are in place.
          </p>
        </div>
        <BidAutopsyCta className="shrink-0" />
      </div>
    </section>
  );
}

export function ProductPage() {
  const modules = [
    [
      "Bid overview",
      "See the client-agreement status, responsible reviewer, deadlines, required approvals and next actions.",
    ],
    [
      "Tender documents",
      "See every recorded document, whether it was verified, how text extraction is controlled and any failures.",
    ],
    [
      "Requirements list",
      "Keep suggested, confirmed and rejected requirements separate, with exact source references and the reviewer's name.",
    ],
    [
      "Evidence and compliance",
      "Link evidence to requirements, see expiry and renewal needs, and show which claims the evidence can support.",
    ],
    [
      "Bill of quantities (BOQ) checks",
      "Check client-supplied calculations, compare words with figures and cite every difference.",
    ],
    [
      "Issues and challenge review",
      "List issues by priority, track fixes and block the final report while a must-fix issue remains open.",
    ],
    [
      "Reports and downloads",
      "Create approved reports, record who signed them off, show their source history and prevent silent changes after approval and download.",
    ],
    [
      "Activity and audit",
      "Show activity for the selected organisation and clearly mark older records if their audit history has a known gap.",
    ],
  ] as const;

  return (
    <PublicShell>
      <PublicMeta
        title="Product"
        description="Explore Valo's tender workspace for documents, requirements linked to sources, evidence, bill of quantities checks, issues, reports and audit history."
        path="/product"
      />
      <PageIntro
        eyebrow="Product"
        title="One organised workspace for complex bids."
        description="Valo keeps the bid record in one place and clearly separates AI suggestions, rule-based checks and human decisions."
      >
        <Button asChild variant="outline" className="min-h-11">
          <Link href="/how-it-works">See the workflow</Link>
        </Button>
      </PageIntro>

      <section className="content-shell py-16 sm:py-20">
        <div className="grid gap-5 md:grid-cols-2">
          {modules.map(([title, body], index) => (
            <article
              key={title}
              className="rounded-lg border border-border bg-card p-6"
            >
              <p className="font-mono text-xs font-semibold text-primary">
                {String(index + 1).padStart(2, "0")}
              </p>
              <h2 className="mt-4 text-lg font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {body}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-border bg-card">
        <div className="content-shell grid gap-8 py-14 lg:grid-cols-3">
          <div>
            <BadgeCheck aria-hidden="true" className="size-6 text-primary" />
            <h2 className="mt-4 text-xl font-semibold">
              People make the final decisions
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              AI can suggest and explain. Only approved people can confirm
              requirements, approve evidence, sign off or download a package.
            </p>
          </div>
          <div>
            <Scale aria-hidden="true" className="size-6 text-primary" />
            <h2 className="mt-4 text-xl font-semibold">
              Calculations use fixed rules
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Valo checks money with fixed calculation rules, not AI guesses. It
              does not invent rates, pricing strategy or business assumptions.
            </p>
          </div>
          <div>
            <LockKeyhole aria-hidden="true" className="size-6 text-primary" />
            <h2 className="mt-4 text-xl font-semibold">
              Unavailable means unavailable
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              If a service, permission or required safeguard is missing, Valo
              says so. Sensitive actions stay disabled instead of appearing to
              work.
            </p>
          </div>
        </div>
      </section>
      <BidAutopsySectionCta />
    </PublicShell>
  );
}

export function SolutionsPage() {
  const solutions = [
    {
      icon: Landmark,
      title: "Bid and proposal teams",
      body: "Turn tender instructions into assigned actions linked to their sources, and keep each answer connected to current evidence.",
      items: [
        "Bid dashboard",
        "Requirements and evidence",
        "Bill of quantities checks",
        "Approved reports",
      ],
    },
    {
      icon: ShieldCheck,
      title: "Compliance and quality teams",
      body: "Review validity, must-fix issues, corrective actions and named approvals without losing the source behind a decision.",
      items: [
        "Evidence status",
        "Issues to fix",
        "Independent challenge review",
        "Audit-ready downloads",
      ],
    },
    {
      icon: Building2,
      title: "Advisory and partner teams",
      body: "Work with assigned client organisations while keeping each client's data, ownership and Valo's quality checks separate.",
      items: [
        "Assigned client workspaces",
        "Clear role limits",
        "Named partner work",
        "Approved commercial features",
      ],
    },
  ] as const;

  return (
    <PublicShell>
      <PublicMeta
        title="Solutions"
        description="Valo supports bid, compliance and advisory teams with tender work linked to sources and named human review."
        path="/solutions"
      />
      <PageIntro
        eyebrow="Solutions"
        title="One trusted record, with clear access for each role."
        description="Each role sees only what it needs and can do only what it is allowed to do. Everyone works from the same record."
      />
      <section className="content-shell grid gap-5 py-16 sm:py-20 lg:grid-cols-3">
        {solutions.map((solution) => (
          <article
            key={solution.title}
            className="rounded-lg border border-border bg-card p-6"
          >
            <solution.icon aria-hidden="true" className="size-6 text-primary" />
            <h2 className="mt-5 text-xl font-semibold">{solution.title}</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {solution.body}
            </p>
            <ul className="mt-6 space-y-3 border-t border-border pt-5 text-sm">
              {solution.items.map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <Check aria-hidden="true" className="size-4 text-success" />
                  {item}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
      <BidAutopsySectionCta />
    </PublicShell>
  );
}

export function HowItWorksPage() {
  const stages = [
    [
      "Agree the work first",
      "An approved team records the client, non-disclosure agreement (NDA), conflict check, service level and named reviewer. The public request form never accepts tender files.",
    ],
    [
      "Record documents safely",
      "Valo records the document list and enforces file-size limits. Approved checks for a file's real type and contents, malware scanning, archive inspection and quarantine are not yet connected. Production document uploads stay off until those checks are approved and working.",
    ],
    [
      "Create draft requirements",
      "Valo links every suggested requirement to its source and shows uncertainty. Instructions hidden inside a document cannot run tools or change the review.",
    ],
    [
      "Review and assign",
      "A named reviewer confirms, edits or rejects each suggestion before the team can treat it as a real requirement.",
    ],
    [
      "Map evidence",
      "Link current evidence to each requirement. Missing, weak or expired evidence stays visible and cannot silently support a claim.",
    ],
    [
      "Check calculations and challenge the bid",
      "Rule-based bill of quantities (BOQ) checks and an independent challenge review find problems the team can fix. They do not predict an award.",
    ],
    [
      "Approve before download",
      "Before a report is downloaded, Valo rechecks the required safeguards, reviewer assignment and approval. A must-fix issue cannot be overridden.",
    ],
    [
      "Keep the record",
      "After delivery, the released file, decisions and audit history still show who was responsible.",
    ],
  ] as const;

  return (
    <PublicShell>
      <PublicMeta
        title="How it works"
        description="See how Valo moves from an approved client agreement to requirements linked to sources, evidence checks, human approval and an audit-ready report."
        path="/how-it-works"
      />
      <PageIntro
        eyebrow="How it works"
        title="A clear path from first contact to final review."
        description="Each step leaves a record for the next one. If approval, evidence or a required service is missing, Valo stops the action and explains why."
      />
      <section className="content-shell py-16 sm:py-20">
        <ol className="mx-auto max-w-4xl space-y-4">
          {stages.map(([title, body], index) => (
            <li
              key={title}
              className="grid gap-4 rounded-lg border border-border bg-card p-5 sm:grid-cols-[3rem_1fr] sm:p-6"
            >
              <span className="font-mono text-sm font-semibold text-primary">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <h2 className="font-semibold">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <BidAutopsySectionCta />
    </PublicShell>
  );
}

export function SecurityPage() {
  const controls = [
    [
      "Organisation data stays separate",
      "Every request names the selected organisation, and the database limits access to that organisation. If this context is missing, access is denied.",
    ],
    [
      "People approve important actions",
      "Roles control who can contribute, review, approve quality, administer or audit. Partner access does not grant permission to approve Valo quality decisions.",
    ],
    [
      "Documents cannot control Valo",
      "Valo treats tender content as data, never as an instruction to the system, and enforces file-size limits. Approved checks for a file's real type and contents, malware scanning, archive inspection and quarantine are not yet connected to document uploads.",
    ],
    [
      "Audit records show known gaps",
      "Each new audit entry links cryptographically to the one before it. Older records are clearly marked if their historical chain has a known gap.",
    ],
    [
      "AI services need approval",
      "AI-assisted actions stay unavailable unless the relevant service is explicitly approved. An approved AI service does not mean malware scanning is active; malware inspection is not yet an approved check for uploaded documents.",
    ],
    [
      "Checks run again before download",
      "When someone requests a report or data export, Valo rechecks that required services are ready, the evidence is current, a reviewer is assigned and no blocking issue is open.",
    ],
  ] as const;

  return (
    <PublicShell>
      <PublicMeta
        title="Security"
        description="Learn how Valo separates organisation data, treats documents safely, approves AI services, records actions and keeps important decisions with people."
        path="/security"
      />
      <PageIntro
        eyebrow="Security and trust"
        title="See the safeguards that protect each step."
        description="Valo shows its security and record-protection checks as part of the work. This page describes product safeguards; it is not a certification or a promise that every deployment is approved."
      />
      <section className="content-shell py-16 sm:py-20">
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {controls.map(([title, body]) => (
            <article
              key={title}
              className="rounded-lg border border-border bg-card p-6"
            >
              <LockKeyhole aria-hidden="true" className="size-5 text-primary" />
              <h2 className="mt-5 font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {body}
              </p>
            </article>
          ))}
        </div>
        <div className="mt-8 rounded-lg border border-warning/40 bg-warning/10 p-5">
          <h2 className="font-semibold text-warning-foreground">
            Production setup matters
          </h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-muted-foreground">
            Source code alone does not prove that every live service, region,
            encryption key, recovery process or device policy is approved.
            Sensitive actions still depend on checks for the specific production
            environment and a review by the operations team.
          </p>
        </div>
      </section>
      <BidAutopsySectionCta />
    </PublicShell>
  );
}

export function AboutPage() {
  return (
    <PublicShell>
      <PublicMeta
        title="About"
        description="Valo is building a tender review workspace for Nigerian bid teams and other teams in regulated markets."
        path="/about"
      />
      <PageIntro
        eyebrow="About Valo"
        title="Better tender work starts with a clear record."
        description="Valo is being built in Abuja for teams working on Nigerian public-sector, energy and donor-funded tenders."
      />
      <section className="content-shell grid gap-10 py-16 sm:py-20 lg:grid-cols-2 lg:gap-16">
        <div>
          <h2 className="text-2xl font-semibold tracking-[-0.025em]">
            Why Valo exists
          </h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            Capable bid teams can still lose track of requirements, evidence and
            approvals across documents, messages and spreadsheets. Valo focuses
            on these preventable problems.
          </p>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            Valo combines AI-assisted extraction and explanation with rule-based
            software and named human review. AI-assisted steps stay unavailable
            until the AI service, privacy and model-evaluation approvals are in
            place. A human reviewer makes the final decision.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="font-semibold">Operating commitments</h2>
          <ul className="mt-5 space-y-4">
            {[
              "No guarantee of a contract award or an evaluator's decision.",
              "No invented evidence, experience, prices or approvals.",
              "No administrator can override an open must-fix issue.",
              "No automated submission to government portals.",
              "Client data is not approved for training shared AI models.",
            ].map((item) => (
              <li
                key={item}
                className="flex items-start gap-3 text-sm leading-6"
              >
                <Check
                  aria-hidden="true"
                  className="mt-1 size-4 shrink-0 text-success"
                />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>
      <BidAutopsySectionCta />
    </PublicShell>
  );
}

export function ContactPage() {
  return (
    <PublicShell>
      <PublicMeta
        title="Contact"
        description="Ask Valo about a Bid Autopsy without sending tender documents or sensitive commercial information through the public form."
        path="/contact"
      />
      <PageIntro
        eyebrow="Contact"
        title="Start with a Bid Autopsy request."
        description="The request form asks only for the business details Valo needs to contact you. Share tender files later, after the client agreement and secure document-sharing process are approved."
      />
      <section className="content-shell grid gap-6 py-16 sm:py-20 lg:grid-cols-[1fr_0.75fr]">
        <div className="rounded-lg border border-border bg-card p-6 sm:p-8">
          <UsersRound aria-hidden="true" className="size-6 text-primary" />
          <h2 className="mt-5 text-2xl font-semibold">New bid enquiry</h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            Use this form for a live, planned or previously submitted bid. Do
            not send confidential bid content, sign-in details or other
            credentials, or financial schedules at this stage.
          </p>
          <BidAutopsyCta className="mt-7" />
        </div>
        <aside className="rounded-lg border border-border bg-muted/45 p-6">
          <CircleHelp aria-hidden="true" className="size-6 text-primary" />
          <h2 className="mt-5 font-semibold">Already invited?</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Sign in with the email address or account that received the
            invitation. Valo checks your organisation and role after it verifies
            your identity.
          </p>
          <Button asChild variant="outline" className="mt-6 min-h-11 w-full">
            <Link href="/sign-in">Sign in to Valo</Link>
          </Button>
        </aside>
      </section>
    </PublicShell>
  );
}

function LegalPage({
  kind,
  title,
  description,
  children,
}: {
  kind: "Privacy" | "Terms";
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <PublicShell>
      <PublicMeta
        title={kind}
        description={description}
        path={`/${kind.toLowerCase()}`}
      />
      <PageIntro eyebrow={kind} title={title} description={description} />
      <article className="content-shell max-w-4xl py-14 sm:py-18">
        <div className="prose prose-slate max-w-none prose-headings:font-sans prose-headings:tracking-tight prose-a:text-primary">
          {children}
        </div>
      </article>
    </PublicShell>
  );
}

export function PrivacyPage() {
  return (
    <LegalPage
      kind="Privacy"
      title="Privacy notice"
      description="How Valo handles public requests, account identity and information in a tender workspace."
    >
      <p>
        <strong>Effective 10 August 2026.</strong> This notice describes how the
        product is currently designed. It does not mean that every optional
        service is active in every environment.
      </p>
      <h2>Public website</h2>
      <p>
        The Bid Autopsy request form records ordinary business contact details,
        a broad tender category and stage, an optional deadline, your preferred
        contact method and confirmation that you read this notice. Valo uses
        this information to assess and answer the request. The form does not
        accept tender documents, sensitive commercial information or free-text
        bid details.
      </p>
      <p>
        Form answers are stored in a separate Valo database for public requests
        and are not sent to analytics. Technical request details help Valo
        confirm that the form came from the official site, prevent abuse, limit
        repeated attempts and avoid duplicate requests. Normal application logs
        do not record the form answers.
      </p>
      <h2>How long we keep public requests</h2>
      <p>
        Valo keeps and deletes public requests under its approved public-request
        policy. This notice does not state a fixed period because one has not
        yet been approved for operations. Use a verified Valo contact to ask to
        access, correct or delete a public request.
      </p>
      <h2>Accounts and access</h2>
      <p>
        Valo uses an external sign-in service to verify identity, provide
        multi-factor authentication and recover accounts. Valo stores only the
        identity and role details it needs to decide who can access each
        organisation and to create audit records.
      </p>
      <h2>Tender workspace data</h2>
      <p>
        Tender and evidence data is kept separate for each organisation. Access,
        storage and AI processing depend on the client agreement and the
        organisation, role and service approvals. Do not send this material
        through a public request form.
      </p>
      <h2>Audit, security and retention</h2>
      <p>
        Valo may record approved actions in an audit trail. Decisions to keep,
        delete or place information on legal hold depend on the client agreement
        and applicable policy. A request is not complete until the system
        records the approved outcome.
      </p>
      <h2>Your choices</h2>
      <p>
        Use your verified Valo contact or organisation administrator to ask for
        access, correction, retention or deletion. A security-sensitive request
        may require you to sign in again and may need further approval.
      </p>
    </LegalPage>
  );
}

export function TermsPage() {
  return (
    <LegalPage
      kind="Terms"
      title="Service terms notice"
      description="Rules for using the Valo public site and its controlled tender workspace."
    >
      <p>
        <strong>Effective 9 August 2026.</strong> The agreement issued to each
        organisation sets its contract terms, data-processing terms and service
        levels.
      </p>
      <h2>Authorised use</h2>
      <p>
        The tender workspace is invitation-only. Users must act for the selected
        organisation, protect their sign-in details and use only the roles and
        client workspaces they are allowed to access.
      </p>
      <h2>Human responsibility</h2>
      <p>
        Valo supports a human-reviewed process. It cannot guarantee a contract
        award, an evaluator's decision or acceptance of a submission. Approved
        users remain responsible for conclusions, evidence, figures, approvals
        and submission.
      </p>
      <h2>Prohibited use</h2>
      <p>
        Users must not try to access another organisation's data, bypass
        required readiness, security or service checks, upload malicious files,
        treat unreviewed AI output as authoritative, use AI output to change
        records or actions before a named person reviews it, fabricate evidence,
        or use Valo to automate submission to a government portal.
      </p>
      <h2>Commercial and financial boundaries</h2>
      <p>
        Bill of quantities (BOQ) tools check client-supplied figures and
        formats. They do not create pricing strategy, invent rates or provide
        financial advice.
      </p>
      <h2>Availability and change</h2>
      <p>
        A feature may be unavailable when a required permission, system, service
        or security safeguard is not approved. Valo may change the service to
        protect security, record integrity or legal obligations. The applicable
        agreement governs any material contract change.
      </p>
    </LegalPage>
  );
}

export function PublicNotFoundPage() {
  return (
    <PublicShell>
      <PublicMeta
        title="Page not found"
        description="The requested Valo page could not be found."
        path={window.location.pathname}
        index={false}
      />
      <section className="content-shell flex min-h-[60vh] items-center py-16">
        <div className="max-w-xl">
          <p className="font-mono text-sm font-semibold text-primary">404</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em]">
            This page is not available.
          </h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            The address may be wrong or may have changed. The page may also
            require you to sign in to an organisation workspace.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/">Return home</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/sign-in">Sign in</Link>
            </Button>
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
