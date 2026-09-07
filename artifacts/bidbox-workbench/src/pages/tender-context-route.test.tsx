import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pages = resolve(import.meta.dirname);
const source = readFileSync(resolve(pages, "tender-context-route.tsx"), "utf8");
const projectDetails = readFileSync(
  resolve(pages, "project-details.tsx"),
  "utf8",
);
const protectedRoutes = readFileSync(
  resolve(pages, "..", "protected-routes.tsx"),
  "utf8",
);

describe("Tender Context UI integration contract", () => {
  it("mounts the exact project route before the generic project details route", () => {
    const tender = protectedRoutes.indexOf(
      '<Route path="/projects/:id/tender-context">',
    );
    const generic = protectedRoutes.indexOf('<Route path="/projects/:id">');
    expect(tender).toBeGreaterThanOrEqual(0);
    expect(generic).toBeGreaterThan(tender);
    expect(protectedRoutes).toContain('import("@/pages/tender-context-route")');
  });

  it("is discoverable from the project details surface under exact read permissions", () => {
    expect(projectDetails).toContain("canOpenTenderContext");
    expect(projectDetails).toContain(
      'useOrganisationPermission("document:read")',
    );
    expect(projectDetails).toContain(
      'useOrganisationPermission("requirement:read")',
    );
    expect(projectDetails).toContain(
      'useOrganisationPermission("evidence:read")',
    );
    expect(projectDetails).toContain(
      'useOrganisationPermission("rule_pack:read")',
    );
    expect(projectDetails).toContain(
      "Open Tender Context &amp; Eligibility Passport",
    );
    expect(projectDetails).toContain("/projects/${id}/tender-context");
  });

  it("keeps snapshot capture, maker-checker review and CAS visible in one journey", () => {
    for (const contract of [
      "Step 1 — Capture and review an exact source version",
      "Capture exact proposal",
      "Verify exact snapshot",
      "capturedByUserId",
      "A different current member with Intelligence review permission",
      "capturedRedactionStatus",
      "documentVersionSha256",
    ]) {
      expect(source).toContain(contract);
    }
    expect(source).toContain('`"${snapshot.version}"`');
    expect(source.match(/`"\$\{record\.version\}"`/gu)).toHaveLength(2);
  });

  it("shows a retryable identity failure before loading or permission gates", () => {
    const identityError = source.indexOf("if (meQuery.isError)");
    const loading = source.indexOf(
      "if (access?.isLoading || meQuery.isLoading || meQuery.isPending)",
    );
    const permissionGate = source.indexOf("if (!canRead)");
    expect(identityError).toBeGreaterThanOrEqual(0);
    expect(identityError).toBeLessThan(loading);
    expect(loading).toBeLessThan(permissionGate);
    expect(source).toContain('title="Your identity could not be checked"');
    expect(source).toContain("onRetry={() => void meQuery.refetch()}");
  });

  it("makes the context and passport actionable without overstating authority", () => {
    for (const contract of [
      "Propose Tender Context",
      "Generate this tender’s Eligibility Passport",
      "Eligibility Passport review",
      "Recorded decisions are point-in-time records",
      "do not prove current usability",
      "does not provide legal advice, compliance clearance, submission approval or an award prediction",
    ]) {
      expect(source).toContain(contract);
    }
    expect(source).toMatch(/not a\s+universal Nigeria eligibility list/u);
  });

  it("uses governed human-labelled selectors instead of raw binding IDs or JSON", () => {
    for (const contract of [
      "Primary verified tender source",
      "Derived from the Step 1 current verified version",
      "Select a currently eligible rule pack",
      "Select by description and source",
      "Select by label and issuer",
      "Evidence kind",
      "Must be current on submission date",
      "Must match the legal entity exactly",
    ]) {
      expect(source).toContain(contract);
    }
    for (const removedRawControl of [
      "parseJsonArray",
      "Primary verified document version ID",
      "Approved Nigeria rule-pack ID",
      "Exact approved rule-pack UUID",
      "JSON list of exact requirementId",
      "Optional JSON list of exact vaultItemVersionId",
    ]) {
      expect(source).not.toContain(removedRawControl);
    }
  });

  it("derives one UTF-16 citation boundary and fails closed on evidence snapshot state", () => {
    expect(source).toContain("deriveUniqueUtf16Citation");
    expect(source).toContain("canonicalText.indexOf(exactQuote)");
    expect(source).toContain(
      "canonicalText.indexOf(exactQuote, startOffset + 1)",
    );
    expect(source).toContain(
      "That quote occurs more than once. Select a longer unique passage.",
    );
    expect(source).toContain(
      "That exact quote does not occur in the verified current snapshot.",
    );
    expect(source).toContain('current.snapshot?.status === "verified"');
    expect(source).toContain('queryState !== "ready"');
    expect(source).toContain(
      "Every selected company-evidence item needs one verified, unique exact quote.",
    );
    expect(source).toContain("description={selectionOptions.freshnessNote}");
  });

  it("lets users remove stale governed selections instead of trapping the draft", () => {
    expect(source).toContain(
      'aria-label="Remove unavailable requirement selection"',
    );
    expect(source).toContain(
      'aria-label="Remove unavailable company evidence selection"',
    );
    expect(source.match(/Remove selection/gu)).toHaveLength(2);
    expect(source).toContain("delete next[id]");
    expect(source).toContain("Retry options");
    expect(source).toMatch(
      /selectionOptions\.requirements\.length === 0 &&\s+selectedRequirements\.length === 0/u,
    );
  });

  it("blocks a rule pack that does not cover the entered jurisdiction", () => {
    expect(source).toContain("isRulePackJurisdictionCompatible");
    expect(source).toContain("const jurisdictionMismatch = Boolean(");
    expect(source).toContain("selectedRulePackOption &&");
    expect(source).toContain("!jurisdictionMismatch &&");
    expect(source).toContain(
      "Choose a rule pack that applies to the entered Nigeria jurisdiction.",
    );
    expect(source).toContain('id="jurisdiction-rule-pack-error"');
  });
});
