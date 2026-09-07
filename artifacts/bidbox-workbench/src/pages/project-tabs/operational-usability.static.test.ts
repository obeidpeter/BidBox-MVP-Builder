import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const REGISTER_SURFACES = [
  "./documents-tab.tsx",
  "./requirements-tab.tsx",
  "./evidence-tab.tsx",
  "./defects-tab.tsx",
  "../../components/client-vault.tsx",
  "../../components/client-capability.tsx",
];

describe("operational register usability contracts", () => {
  it.each(REGISTER_SURFACES)(
    "%s distinguishes loading, failed and verified-empty records",
    (path) => {
      const content = source(path);
      expect(content).toContain("LoadingPanel");
      expect(content).toContain("DataErrorPanel");
      expect(content).toMatch(/\bisError\b/u);
      expect(content).toMatch(/\bisSuccess\b/u);
      expect(content).toMatch(/\bisPending\b/u);
      expect(content).toContain("onRetry");
    },
  );

  it.each([
    "./requirements-tab.tsx",
    "./evidence-tab.tsx",
    "./defects-tab.tsx",
    "../../components/client-vault.tsx",
    "../../components/client-capability.tsx",
  ])("%s protects nontrivial edits and retains form feedback", (path) => {
    const content = source(path);
    expect(content).toContain("UnsavedChangesAlert");
    expect(content).toContain("FormErrorSummary");
    expect(content).toMatch(/requestCloseDialog/u);
    expect(content).toMatch(/htmlFor=/u);
  });

  it.each([
    "./documents-tab.tsx",
    "./evidence-tab.tsx",
    "../../components/client-vault.tsx",
    "../../components/client-capability.tsx",
  ])(
    "%s confirms named destructive actions through the server result",
    (path) => {
      const content = source(path);
      expect(content).toContain("DestructiveConfirmation");
      expect(content).toMatch(/pending=/u);
      expect(content).toMatch(/error=/u);
      expect(content).toMatch(/cannot be undone|stop being claimable/u);
    },
  );

  it("sends explicit clears for optional edit fields while create paths keep omission semantics", () => {
    const evidence = source("./evidence-tab.tsx");
    expect(evidence).toContain(
      "documentId: form.documentId === NONE ? null : form.documentId",
    );
    expect(evidence).toContain("excerpt: form.excerpt.trim() || null");
    expect(evidence).toContain("notes: form.notes.trim() || null");
    expect(evidence).toContain(
      "documentId: form.documentId === NONE ? undefined : form.documentId",
    );

    const defects = source("./defects-tab.tsx");
    expect(defects).toContain("const optionalFields = editingId");
    expect(defects).toContain("remediation: form.remediation.trim() || null");
    expect(defects).toContain("owner: form.owner.trim() || null");
    expect(defects).toContain("form.requirementId === NONE ? null");

    const requirements = source("./requirements-tab.tsx");
    expect(requirements).toContain(
      "expectedEvidence: form.expectedEvidence.trim() || null",
    );
    expect(requirements).toContain(
      "reviewerNotes: form.reviewerNotes.trim() || null",
    );

    const vault = source("../../components/client-vault.tsx");
    expect(vault).toContain("const updatePayload = {");
    expect(vault).toContain("issuer: form.issuer.trim() || null");
    expect(vault).toContain("issueDate: form.issueDate || null");
    expect(vault).toContain("expiryDate: form.expiryDate || null");
    expect(vault).toMatch(/renewalLeadDays:[\s\S]*?: null,/u);
    expect(vault).toContain("sourceDocumentId: sourceDocumentId ?? null");

    const capability = source("../../components/client-capability.tsx");
    expect(capability).toContain("if (!editingId && !form.description.trim())");
    expect(capability).toContain(
      "description: form.description.trim() || null",
    );
    expect(capability).toContain(
      "description: form.description.trim() || undefined",
    );
  });
});
