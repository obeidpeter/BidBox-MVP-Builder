import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import type {
  ProductionAcceptanceCategory,
  ProductionAcceptanceSnapshot,
} from "./production-acceptance-contract";
import { PRODUCTION_ACCEPTANCE_CATEGORIES } from "./production-acceptance-contract";
import { ProductionAcceptanceConsole } from "./production-acceptance-console";

const RELEASE_SHA = "a".repeat(64);

function snapshot(
  blockers: ProductionAcceptanceSnapshot["blockers"] = [],
): ProductionAcceptanceSnapshot {
  return {
    generatedAt: "2026-08-11T10:00:00.000Z",
    organisationId: "organisation-a",
    expectedReleaseSha256: RELEASE_SHA,
    recommendedDecision: blockers.length === 0 ? "go" : "no_go",
    deploymentAuthorized: false,
    requiresNamedHumanApproval: true,
    authorityNote:
      "This console records evidence only. A named human makes the final decision.",
    blockers,
    categories: PRODUCTION_ACCEPTANCE_CATEGORIES.map((category) => ({
      category,
      label: category.replaceAll("_", " "),
      state: blockers.some(({ category: blocked }) => blocked === category)
        ? "failed"
        : "passed",
      required: true,
      latestEvidence: evidence(category),
    })),
  };
}

function evidence(category: ProductionAcceptanceCategory) {
  return {
    id: "b".repeat(64),
    organisationId: "organisation-a",
    category,
    outcome: "passed" as const,
    environment: "recovery_rehearsal" as const,
    releaseSha256: RELEASE_SHA,
    ownerUserId: "evidence-owner",
    verifiedByUserId: "quality-verifier",
    observedAt: "2026-08-11T09:00:00.000Z",
    expiresAt: "2026-08-18T09:00:00.000Z",
    evidenceReference: `private/${category}/run-1`,
    artifactSha256: "c".repeat(64),
    summary: "Synthetic rehearsal evidence retained for review.",
    recordedAt: "2026-08-11T10:00:00.000Z",
    evidenceDigest: "b".repeat(64),
  };
}

describe("ProductionAcceptanceConsole", () => {
  it("shows a complete register as human-decision eligible, never authorised", () => {
    render(<ProductionAcceptanceConsole snapshot={snapshot()} />);
    expect(
      screen.getByRole("heading", { name: "Release checks" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Evidence is complete; a named person must make the go decision",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Automatic approval:/u).closest("p"),
    ).toHaveTextContent("Automatic approval: none");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getAllByText("Passed")).toHaveLength(7);
  });

  it("makes blockers explicit without offering destructive recovery actions", () => {
    render(
      <ProductionAcceptanceConsole
        snapshot={snapshot([
          {
            code: "RESTORE_FAILED",
            category: "restore",
            message: "The isolated restore rehearsal failed.",
          },
        ])}
      />,
    );
    expect(screen.getByText("RESTORE_FAILED")).toBeInTheDocument();
    expect(screen.getByText(/No-go: required evidence/iu)).toBeInTheDocument();
    expect(screen.queryByText(/run restore/iu)).not.toBeInTheDocument();
    expect(screen.queryByText(/execute rollback/iu)).not.toBeInTheDocument();
  });

  it("has no detectable axe violation in the populated state", async () => {
    const view = render(<ProductionAcceptanceConsole snapshot={snapshot()} />);
    const results = await axe.run(view.container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});
