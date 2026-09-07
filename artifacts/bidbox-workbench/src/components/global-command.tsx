import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  getListProjectsQueryKey,
  useListProjects,
} from "@workspace/api-client-react";
import { ArrowRight, BriefcaseBusiness, Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { PlatformNavItem } from "@/lib/platform-access";

type AvailableNavigation = PlatformNavItem & {
  state: "active" | "pending_activation" | "denied";
};

export function GlobalCommand({
  navigation,
}: {
  navigation: AvailableNavigation[];
}) {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const canSearchPursuits = navigation.some(
    (item) => item.href === "/projects",
  );
  const projectsQuery = useListProjects(undefined, {
    query: {
      enabled: open && canSearchPursuits,
      queryKey: getListProjectsQueryKey(),
      staleTime: 30_000,
    },
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const normalized = query.trim().toLowerCase();
  const navigationResults = navigation.filter((item) =>
    `${item.label} ${item.group}`.toLowerCase().includes(normalized),
  );
  const projectResults = useMemo(
    () =>
      (projectsQuery.data ?? [])
        .filter((project) =>
          [project.tenderTitle, project.clientName, project.tenderRef]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(normalized),
        )
        .slice(0, 8),
    [normalized, projectsQuery.data],
  );

  const choose = (href: string) => {
    setOpen(false);
    navigate(href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-10 w-full max-w-xs items-center gap-2 rounded-md border border-border bg-card px-3 text-sm text-muted-foreground transition-colors hover:border-input hover:text-foreground sm:min-w-56"
        aria-label="Search pages and pursuits"
      >
        <Search aria-hidden="true" className="size-4" />
        <span className="min-w-0 flex-1 truncate text-left">Search</span>
        <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs sm:inline">
          Ctrl K
        </kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[80dvh] max-w-2xl overflow-hidden p-0">
          <DialogTitle className="sr-only">Search Valo</DialogTitle>
          <div className="border-b border-border p-4">
            <div className="relative">
              <Search
                aria-hidden="true"
                className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search pages or a pursuit"
                className="h-11 pl-10"
              />
            </div>
          </div>
          <div className="max-h-[60dvh] overflow-y-auto p-3">
            <section aria-labelledby="search-navigation-heading">
              <h2
                id="search-navigation-heading"
                className="px-2 pb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground"
              >
                Pages
              </h2>
              <div className="space-y-1">
                {navigationResults.map((item) => (
                  <button
                    key={item.href}
                    type="button"
                    onClick={() => choose(item.href)}
                    className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span>
                      <span className="font-medium">{item.label}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {item.group}
                      </span>
                    </span>
                    <ArrowRight
                      aria-hidden="true"
                      className="size-4 text-muted-foreground"
                    />
                  </button>
                ))}
              </div>
            </section>
            {canSearchPursuits ? (
              <section
                aria-labelledby="search-pursuits-heading"
                className="mt-5 border-t border-border pt-4"
              >
                <h2
                  id="search-pursuits-heading"
                  className="px-2 pb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground"
                >
                  Pursuits
                </h2>
                {projectsQuery.isLoading ? (
                  <p
                    className="px-3 py-4 text-sm text-muted-foreground"
                    role="status"
                  >
                    Loading pursuits…
                  </p>
                ) : projectsQuery.isError ? (
                  <p className="px-3 py-4 text-sm text-destructive">
                    Pursuit search is unavailable. You can still search pages.
                  </p>
                ) : projectResults.length > 0 ? (
                  <div className="space-y-1">
                    {projectResults.map((project) => (
                      <button
                        key={project.id}
                        type="button"
                        onClick={() => choose(`/projects/${project.id}`)}
                        className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <BriefcaseBusiness
                          aria-hidden="true"
                          className="size-4 shrink-0 text-primary"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {project.tenderTitle}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {project.clientName ?? "Client not named"}
                            {project.tenderRef ? ` · ${project.tenderRef}` : ""}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : normalized ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground">
                    No pursuit you can access matches this search.
                  </p>
                ) : null}
              </section>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
