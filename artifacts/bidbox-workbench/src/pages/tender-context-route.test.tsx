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
});
