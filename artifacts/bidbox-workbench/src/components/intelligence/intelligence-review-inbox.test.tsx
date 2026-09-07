import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import IntelligenceReviewInbox, {
  type IntelligenceReviewInboxItem,
} from "./intelligence-review-inbox";

const REVIEW_ITEMS: readonly IntelligenceReviewInboxItem[] = [
  {
    id: "review-unassigned",
    capabilityId: "evidence_graph",
    title: "Tax clearance citation needs review",
    summary: "A cited certificate may not cover the required assessment years.",
    status: "pending",
    priority: "critical",
    reviewType: "Evidence check",
    reviewerName: null,
    assignedToCurrentUser: false,
    dueAt: "2099-08-11T10:00:00.000Z",
    sourceCount: 2,
    staleSource: true,
    href: "/reviews/review-unassigned",
  },
  {
    id: "review-assigned",
    capabilityId: "response_studio",
    title: "Confirm project reference wording",
    summary: "The proposed wording is linked to one approved project record.",
    status: "in_review",
    priority: "high",
    reviewType: "Draft claim",
    reviewerName: "Ada Okafor",
    assignedToCurrentUser: true,
    dueAt: null,
    sourceCount: 1,
    staleSource: false,
    href: null,
  },
  {
    id: "review-approved",
    capabilityId: "boq_sanity",
    title: "Arithmetic exception resolved",
    summary: "The commercial reviewer recorded the resolution.",
    status: "approved",
    priority: "normal",
    reviewType: "BOQ exception",
    reviewerName: "Chidi Bello",
    assignedToCurrentUser: true,
    dueAt: null,
    sourceCount: 0,
    staleSource: false,
    href: null,
  },
] as const;

function renderInbox(
  props: Partial<React.ComponentProps<typeof IntelligenceReviewInbox>> = {},
) {
  return render(
    <IntelligenceReviewInbox
      items={REVIEW_ITEMS}
      environment="production"
      productionAiEnabled={false}
      {...props}
    />,
  );
}

describe("IntelligenceReviewInbox", () => {
  it("shows status counts, evidence condition and an honest runtime boundary", () => {
    renderInbox();

    expect(
      screen.getByRole("heading", { name: "Review inbox" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Production model execution is disabled",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/presence does not mean AI analysis ran/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "All: 3 review items" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Pending: 1 review item" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "In review: 1 review item" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Review accepted: 1 review item" }),
    ).toBeInTheDocument();

    const list = screen.getByRole("list", { name: "Review items" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(
      screen.getByText("At least one source is stale"),
    ).toBeInTheDocument();
    expect(screen.getByText("No source is attached")).toBeInTheDocument();
    expect(screen.getByText("Named reviewer required")).toBeInTheDocument();
    expect(
      screen.getByText(/Only a named, authorised reviewer may approve/i),
    ).toBeInTheDocument();
  });

  it("filters by status with the keyboard and by priority", async () => {
    const user = userEvent.setup();
    renderInbox();

    const inReviewFilter = screen.getByRole("button", {
      name: "In review: 1 review item",
    });
    inReviewFilter.focus();
    await user.keyboard("{Enter}");

    expect(inReviewFilter).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("heading", {
        name: "Confirm project reference wording",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "Tax clearance citation needs review",
      }),
    ).not.toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Filter by priority" }),
      "critical",
    );
    expect(
      screen.getByRole("heading", {
        name: "No review items match these filters",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Showing 0 of 3 review items")).toBeInTheDocument();
  });

  it("enforces the named-human boundary before dispatching callbacks", async () => {
    const user = userEvent.setup();
    const onClaim = vi.fn();
    const onDecision = vi.fn();
    renderInbox({
      onClaim,
      onDecision,
      authorityNote: "Only the appointed bid lead may record final decisions.",
    });

    expect(screen.getByText("Review authority:")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Only the appointed bid lead may record final decisions.",
      ),
    ).toBeInTheDocument();

    const unassignedItem = screen
      .getByRole("heading", { name: "Tax clearance citation needs review" })
      .closest("article");
    expect(unassignedItem).not.toBeNull();
    expect(
      within(unassignedItem!).queryByRole("button", {
        name: "Accept review",
      }),
    ).not.toBeInTheDocument();
    await user.click(
      within(unassignedItem!).getByRole("button", { name: "Claim review" }),
    );
    expect(onClaim).toHaveBeenCalledWith("review-unassigned");

    const assignedItem = screen
      .getByRole("heading", { name: "Confirm project reference wording" })
      .closest("article");
    expect(assignedItem).not.toBeNull();
    await user.click(
      within(assignedItem!).getByRole("button", { name: "Request changes" }),
    );
    await user.click(
      within(assignedItem!).getByRole("button", { name: "Accept review" }),
    );
    await user.click(
      within(assignedItem!).getByRole("button", { name: "Reject" }),
    );
    expect(onDecision.mock.calls).toEqual([
      ["review-assigned", "changes_requested"],
      ["review-assigned", "approved"],
      ["review-assigned", "rejected"],
    ]);

    const approvedItem = screen
      .getByRole("heading", { name: "Arithmetic exception resolved" })
      .closest("article");
    expect(approvedItem).not.toBeNull();
    expect(within(approvedItem!).queryByRole("button")).not.toBeInTheDocument();
  });

  it("does not offer decisions for a terminal changes-requested review", () => {
    renderInbox({
      items: [
        {
          ...REVIEW_ITEMS[1],
          id: "review-changes-requested",
          status: "changes_requested",
        },
      ],
      onClaim: vi.fn(),
      onDecision: vi.fn(),
    });

    const item = screen
      .getByRole("heading", { name: "Confirm project reference wording" })
      .closest("article");
    expect(item).not.toBeNull();
    expect(within(item!).queryByRole("button")).not.toBeInTheDocument();
  });

  it("disables mutation controls in read-only mode but preserves navigation", () => {
    renderInbox({
      readOnly: true,
      onClaim: vi.fn(),
      onDecision: vi.fn(),
    });

    expect(
      screen.getByRole("heading", { name: "Read-only review inbox" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claim review" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Accept review" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("link", {
        name: "Open review: Tax clearance citation needs review",
      }),
    ).toHaveAttribute("href", "/reviews/review-unassigned");
  });

  it("keeps loading, error and empty records semantically distinct", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    const view = renderInbox({ loading: true, items: [] });

    expect(
      screen.getByText("Loading review items for this organisation"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "No review items are available" }),
    ).not.toBeInTheDocument();

    view.rerender(
      <IntelligenceReviewInbox
        items={[]}
        environment="production"
        productionAiEnabled={false}
        error="Queue service unavailable."
        onRetry={retry}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Review items could not be loaded" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Do not infer that the inbox is empty/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);

    view.rerender(
      <IntelligenceReviewInbox
        items={[]}
        environment="production"
        productionAiEnabled={false}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "No review items are available" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/This is not an approval/i)).toBeInTheDocument();
  });

  it("does not turn a non-production environment into an AI-enabled claim", () => {
    renderInbox({ environment: "development", productionAiEnabled: true });

    expect(
      screen.getByRole("heading", { name: "Development review data" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/does not report production AI as active/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "Production runtime reported available",
      }),
    ).not.toBeInTheDocument();
  });

  it("gives every interactive control a 44px minimum target", () => {
    const view = renderInbox({ onClaim: vi.fn(), onDecision: vi.fn() });
    const controls = view.container.querySelectorAll<HTMLElement>(
      '[data-control-size="44"]',
    );

    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) expect(control).toHaveClass("min-h-11");
  });

  it("uses valid definition-list groups without a nested complementary landmark", () => {
    const view = renderInbox();
    const definitionList = view.container.querySelector("dl");

    expect(definitionList).not.toBeNull();
    for (const group of Array.from(definitionList!.children)) {
      expect(Array.from(group.children).map(({ tagName }) => tagName)).toEqual([
        "DT",
        "DD",
      ]);
    }
    expect(
      screen.getByRole("note", { name: "Review authority boundary" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("has no detectable accessibility violations", async () => {
    const view = renderInbox({ onClaim: vi.fn(), onDecision: vi.fn() });
    const results = await axe.run(view.container, {
      rules: { "color-contrast": { enabled: false } },
    });

    expect(
      results.violations.map(({ id, impact, nodes }) => ({
        id,
        impact,
        targets: nodes.map((node) => node.target),
      })),
    ).toEqual([]);
  }, 15_000);
});
