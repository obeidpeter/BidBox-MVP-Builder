import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "wouter";
import { ArrowUp, BookOpenText, Search, ShieldCheck, X } from "lucide-react";

import userManualMarkdown from "../../../../docs/USER_MANUAL.md?raw";
import { PageHeader } from "@/components/platform-states";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import {
  navigationForRole,
  normalizePlatformRoles,
  platformFeatureFlags,
} from "@/lib/platform-access";
import {
  normaliseManualSearchQuery,
  parseUserManualMarkdown,
  type UserManualBlock,
  type UserManualListBlock,
} from "@/lib/user-manual";

const manual = parseUserManualMarkdown(userManualMarkdown);

const START_HERE_TOPICS = [
  {
    id: "signing-in-and-choosing-your-organisation",
    label: "Set up access",
    description:
      "Sign in, select an organisation, and understand pending access.",
  },
  {
    id: "pursuits-the-register-and-the-workspace",
    label: "Work a pursuit",
    description:
      "Follow the governed path from intake through release controls.",
  },
  {
    id: "why-is-this-blocked-the-cheat-sheet",
    label: "Explain a blocker",
    description:
      "Translate common disabled states into the exact rule you hit.",
  },
  {
    id: "quick-reference-statuses-and-badges",
    label: "Decode a status",
    description:
      "Check the meaning of workflow states, badges, and integrity labels.",
  },
] as const;

function topicHref(id: string) {
  return `/help?topic=${encodeURIComponent(id)}#${id}`;
}

function InlineManualText({ text }: { text: string }) {
  const pieces = text.split(/(`[^`]+`|\*\*[^*]+\*\*|_[^_]+_)/g);

  return pieces.map((piece, index): ReactNode => {
    if (piece.startsWith("`") && piece.endsWith("`")) {
      return (
        <code
          key={`${piece}-${index}`}
          className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em] text-foreground"
        >
          {piece.slice(1, -1)}
        </code>
      );
    }
    if (piece.startsWith("**") && piece.endsWith("**")) {
      return <strong key={`${piece}-${index}`}>{piece.slice(2, -2)}</strong>;
    }
    if (piece.startsWith("_") && piece.endsWith("_")) {
      return <em key={`${piece}-${index}`}>{piece.slice(1, -1)}</em>;
    }
    return piece;
  });
}

function ManualList({ block }: { block: UserManualListBlock }) {
  const items = block.items.map((item, index) => (
    <li key={`${item.text}-${index}`}>
      <InlineManualText text={item.text} />
      {item.children.map((child, childIndex) => (
        <ManualList key={`${item.text}-child-${childIndex}`} block={child} />
      ))}
    </li>
  ));

  return block.ordered ? (
    <ol
      start={block.start}
      className="my-4 space-y-2 pl-6 marker:font-semibold"
    >
      {items}
    </ol>
  ) : (
    <ul className="my-4 list-disc space-y-2 pl-6 marker:text-primary">
      {items}
    </ul>
  );
}

function ManualBlock({
  block,
  sectionTitle,
}: {
  block: UserManualBlock;
  sectionTitle: string;
}) {
  switch (block.type) {
    case "paragraph":
      return (
        <p className="my-4 leading-7 text-muted-foreground">
          <InlineManualText text={block.text} />
        </p>
      );
    case "subheading":
      return (
        <h3
          id={block.id}
          className="scroll-mt-24 pt-3 text-lg font-semibold tracking-tight"
        >
          <InlineManualText text={block.title} />
        </h3>
      );
    case "list":
      return <ManualList block={block} />;
    case "table":
      return (
        <div className="my-5 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
            <caption className="sr-only">
              Reference table for {sectionTitle}
            </caption>
            <thead className="bg-muted/70">
              <tr>
                {block.headers.map((header) => (
                  <th
                    key={header}
                    scope="col"
                    className="border-b border-border px-4 py-3 font-semibold"
                  >
                    <InlineManualText text={header} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  className="border-b border-border last:border-0"
                >
                  {row.map((cell, cellIndex) =>
                    cellIndex === 0 ? (
                      <th
                        key={`${cellIndex}-${cell}`}
                        scope="row"
                        className="px-4 py-3 align-top font-medium leading-6 text-foreground"
                      >
                        <InlineManualText text={cell} />
                      </th>
                    ) : (
                      <td
                        key={`${cellIndex}-${cell}`}
                        className="px-4 py-3 align-top leading-6 text-muted-foreground"
                      >
                        <InlineManualText text={cell} />
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "rule":
      return <hr className="my-6 border-border" />;
  }
}

function ContentsLinks({
  sections,
  onNavigate,
}: {
  sections: typeof manual.sections;
  onNavigate?: () => void;
}) {
  return (
    <ol className="space-y-1.5">
      {sections.map((section) => (
        <li key={section.id}>
          <Link
            href={topicHref(section.id)}
            onClick={onNavigate}
            className="group flex min-h-9 gap-2 rounded-md px-2 py-1.5 text-sm leading-5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="w-6 shrink-0 font-mono text-xs text-primary">
              {section.number}.
            </span>
            <span className="group-hover:underline">{section.title}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

export function HelpManualContent({
  accessibleRoutes,
}: {
  accessibleRoutes: ReadonlySet<string>;
}) {
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [mobileContentsOpen, setMobileContentsOpen] = useState(false);
  const activeTopic = searchParams.get("topic");
  const normalizedQuery = normaliseManualSearchQuery(query);
  const queryTerms = normalizedQuery.split(" ").filter(Boolean);

  const visibleSections = useMemo(
    () =>
      queryTerms.length === 0
        ? manual.sections
        : manual.sections.filter((section) =>
            queryTerms.every((term) => section.searchText.includes(term)),
          ),
    [normalizedQuery],
  );

  const handleTopicNavigate = () => {
    setQuery("");
    setMobileContentsOpen(false);
  };

  useEffect(() => {
    if (!activeTopic || normalizedQuery) return;
    const section = manual.sections.find(({ id }) => id === activeTopic);
    if (!section) return;
    window.requestAnimationFrame(() => {
      document.getElementById(section.id)?.scrollIntoView?.({ block: "start" });
    });
  }, [activeTopic, normalizedQuery]);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7 p-5 sm:p-8">
      <PageHeader
        eyebrow="Built-in guidance"
        title="Help & user manual"
        description="Search release-matched guidance for BidBox workflows, access rules, blockers, statuses, and safety boundaries."
        state="active"
      />

      <section aria-labelledby="about-manual-title" className="max-w-4xl">
        <h2 id="about-manual-title" className="sr-only">
          About this manual
        </h2>
        <div className="text-sm sm:text-[0.95rem]">
          {manual.intro
            .filter((block) => block.type !== "rule")
            .map((block, index) => (
              <ManualBlock
                key={`${block.type}-${index}`}
                block={block}
                sectionTitle="About this manual"
              />
            ))}
        </div>
      </section>

      <section
        aria-labelledby="manual-privacy-title"
        className="flex gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4 text-brand-950"
      >
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <div>
          <h2 id="manual-privacy-title" className="text-sm font-semibold">
            Private, release-matched guidance
          </h2>
          <p className="mt-1 text-sm leading-6 text-brand-950/80">
            Search runs only in this browser against guidance bundled with this
            release. It does not search customer records, call a tenant API,
            persist your query, or change your permissions.
          </p>
        </div>
      </section>

      <section aria-labelledby="start-here-title">
        <div className="mb-3 flex items-center gap-2">
          <BookOpenText aria-hidden="true" className="size-5 text-primary" />
          <h2 id="start-here-title" className="text-lg font-semibold">
            Start here
          </h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {START_HERE_TOPICS.map((topic) => (
            <Link
              key={topic.id}
              href={topicHref(topic.id)}
              onClick={handleTopicNavigate}
              className="rounded-xl border border-border bg-card p-4 shadow-xs transition-colors hover:border-primary/40 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="text-sm font-semibold text-foreground">
                {topic.label}
              </span>
              <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                {topic.description}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section
        id="manual-contents"
        aria-labelledby="manual-search-title"
        className="scroll-mt-24 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5"
      >
        <div className="max-w-3xl">
          <h2 id="manual-search-title" className="text-base font-semibold">
            Search the manual
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Try a task, page, status, permission, or exact message such as
            “sign-off”, “NDA”, “offline”, or “changed in another session”.
          </p>
          <div className="relative mt-3">
            <Search
              aria-hidden="true"
              className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <label htmlFor="manual-search" className="sr-only">
              Search help and user manual
            </label>
            <input
              id="manual-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search help topics"
              aria-controls="manual-results"
              className="min-h-11 w-full rounded-md border border-input bg-background py-2 pl-10 pr-12 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear manual search"
                className="absolute right-1.5 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            ) : null}
          </div>
          <p
            className="mt-2 text-sm text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {normalizedQuery
              ? `${visibleSections.length} ${visibleSections.length === 1 ? "topic" : "topics"} found`
              : `${manual.sections.length} topics in this manual`}
          </p>
        </div>
      </section>

      <details
        open={mobileContentsOpen}
        onToggle={(event) => setMobileContentsOpen(event.currentTarget.open)}
        className="rounded-xl border border-border bg-card p-4 lg:hidden"
      >
        <summary className="cursor-pointer text-sm font-semibold">
          Table of contents
        </summary>
        <nav
          aria-label="Manual contents"
          className="mt-3 border-t border-border pt-3"
        >
          <ContentsLinks
            sections={visibleSections}
            onNavigate={handleTopicNavigate}
          />
        </nav>
      </details>

      <div className="grid items-start gap-7 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="sticky top-24 hidden max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-xl border border-border bg-card p-4 lg:block">
          <nav aria-label="Manual contents">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Table of contents
            </p>
            <ContentsLinks
              sections={visibleSections}
              onNavigate={handleTopicNavigate}
            />
          </nav>
        </aside>

        <div id="manual-results" className="min-w-0 space-y-5">
          {normalizedQuery && visibleSections.length === 0 ? (
            <section
              aria-labelledby="no-help-results-title"
              className="rounded-xl border border-border bg-card p-6 text-center"
            >
              <Search
                aria-hidden="true"
                className="mx-auto size-6 text-muted-foreground"
              />
              <h2
                id="no-help-results-title"
                className="mt-3 text-lg font-semibold"
              >
                No help topic matched
              </h2>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
                Try a shorter task or status name. Search checks every heading,
                instruction, table, and route in this release's manual.
              </p>
              <button
                type="button"
                onClick={() => setQuery("")}
                className="mt-4 min-h-10 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Clear search
              </button>
            </section>
          ) : (
            visibleSections.map((section) => {
              const relatedRoutes = section.routes.filter((route) =>
                accessibleRoutes.has(route),
              );
              return (
                <article
                  key={section.id}
                  id={section.id}
                  aria-labelledby={`${section.id}-title`}
                  className="scroll-mt-24 rounded-xl border border-border bg-card p-5 shadow-xs sm:p-7"
                >
                  <div className="flex items-start gap-3 border-b border-border pb-4">
                    <span className="mt-1 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-accent font-mono text-xs font-semibold text-accent-foreground">
                      {section.number}
                    </span>
                    <h2
                      id={`${section.id}-title`}
                      className="text-xl font-semibold tracking-tight sm:text-2xl"
                    >
                      <InlineManualText text={section.title} />
                    </h2>
                  </div>
                  <div className="text-sm sm:text-[0.95rem]">
                    {section.blocks.map((block, index) => (
                      <ManualBlock
                        key={`${block.type}-${index}`}
                        block={block}
                        sectionTitle={section.title}
                      />
                    ))}
                  </div>
                  {relatedRoutes.length > 0 ? (
                    <nav
                      aria-label={`Pages related to ${section.title}`}
                      className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4"
                    >
                      <span className="mr-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Open available page
                      </span>
                      {relatedRoutes.map((route) => (
                        <Link
                          key={route}
                          href={route}
                          className="inline-flex min-h-9 items-center rounded-full border border-border bg-background px-3 font-mono text-xs font-semibold text-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {route}
                        </Link>
                      ))}
                    </nav>
                  ) : null}
                  <a
                    href="#manual-contents"
                    className="mt-5 inline-flex min-h-9 items-center gap-1.5 rounded-md text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ArrowUp aria-hidden="true" className="size-4" />
                    Back to search and contents
                  </a>
                </article>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default function HelpPage() {
  const organisationAccess = useOrganisationAccess();
  const accessibleRoutes = useMemo(() => {
    const routes = new Set(["/account", "/help"]);
    const normalizedRoles = normalizePlatformRoles(
      organisationAccess?.effectiveRoles ?? [],
    );
    const organisation = organisationAccess?.activeOrganisation;
    if (organisation && normalizedRoles.length > 0) {
      for (const item of navigationForRole(
        normalizedRoles,
        platformFeatureFlags(),
        organisationAccess.effectivePermissions,
        organisation.accessSource,
      )) {
        if (item.state === "active") routes.add(item.href);
      }
    }
    return routes;
  }, [organisationAccess]);

  return <HelpManualContent accessibleRoutes={accessibleRoutes} />;
}
