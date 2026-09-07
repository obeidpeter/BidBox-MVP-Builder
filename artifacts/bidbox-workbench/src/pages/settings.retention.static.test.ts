import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/pages/settings.tsx"),
  "utf8",
);

describe("retention completion activation gate", () => {
  it("loads live readiness and exact completion evidence before exposing mutations", () => {
    expect(source).toContain("useListRetentionRequests");
    expect(source).toContain("useGetRetentionCompletionReadiness");
    expect(source).toContain("useGetRetentionRequestCompletion");
    expect(source).toContain("useCompleteRetentionRequest");
    expect(source).toContain("useReconcileRetentionAction");
    expect(source).toContain("useCertifyRetentionAction");
    expect(source).toMatch(
      /activationVerified &&[\s\S]*identityVerified &&[\s\S]*criticalEvidenceCurrent &&[\s\S]*!phaseDraft/u,
    );
    expect(source).toMatch(
      /readiness\.activated === true[\s\S]*readiness\.manifestValid === true[\s\S]*readiness\.environmentOptIn === true/u,
    );
    expect(source).toContain("Retention completion is not activated");
  });

  it("fails closed on stale, failed or refetching critical evidence", () => {
    for (const phrase of [
      "readinessEvidenceCurrent",
      "listEvidenceCurrent",
      "identityEvidenceCurrent",
      "completionEvidenceCurrent",
      "!readinessQuery.isFetching",
      "!retentionQuery.isFetching",
      "!meQuery.isFetching",
      "!completionQuery.isFetching",
    ]) {
      expect(source).toContain(phrase);
    }
  });

  it("requires three versioned, idempotent human-attested phases", () => {
    for (const phrase of [
      'openPhase("detach")',
      'openPhase("reconcile")',
      'openPhase("certify")',
      "ifMatch: String(snapshot.request.version)",
      "ifMatch: String(snapshot.action.version)",
      "idempotencyKey: phaseDraft.idempotencyKey",
      "Named operator attestation",
      "Type this exact confirmation",
      "16–512 characters",
    ]) {
      expect(source).toContain(phrase);
    }
    expect(source).toMatch(/beginCriticalWorkflow\(\)/u);
    expect(source).toMatch(/releaseCriticalWorkflow\?\.\(\)/u);
  });

  it("requires owner-purge receipt proof and exact protocol versions", () => {
    for (const phrase of [
      "ownerPurgeProofVerified",
      "action.purgeReceipt !== null",
      "action.purgeReceiptSha256",
      "action.purgedAt",
      "SHA256_PATTERN.test(action.purgeReceiptSha256)",
      "Number.isFinite(Date.parse(action.purgedAt))",
      'action.status === "detached" && action.version === 3',
      'action.status === "reconciled" && action.version === 4',
      'action.status === "certified" && action.version === 5',
      "Owner purge proof is incomplete",
      "Detached status alone does not prove",
      "Owner purge receipt",
    ]) {
      expect(source).toContain(phrase);
    }
  });

  it("never equates detachment or reconciliation with certification", () => {
    expect(source).toContain(
      "Durable object evidence is still being reconciled; no certificate was issued.",
    );
    expect(source).toContain(
      "A different authorised checker must certify this exact action.",
    );
    expect(source).toContain("No deletion certificate has been issued");
    expect(source).toContain("certificateEvidenceVerified");
    expect(source).toMatch(
      /snapshot\.request\.status === "completed" &&[\s\S]*snapshot\.action\?\.status === "certified"/u,
    );
    for (const proof of [
      "result.action.preparedByUserId !== meQuery.data?.id",
      "result.action.checkedByUserId !== meQuery.data?.id",
      "result.certificate.signedByUserId !== meQuery.data?.id",
      "result.action.checkedByUserId === result.action.preparedByUserId",
      "result.certificate.retentionActionId !== result.action.id",
      "result.certificate.scopeManifestHash !==",
    ]) {
      expect(source).toContain(proof);
    }
  });

  it("explains irreversible detachment, storage failures and retained categories", () => {
    expect(source).toContain("irreversible relational detachment");
    expect(source).toContain("owner-scoped relational graph will be purged");
    expect(source).toContain("Storage dead letters require resolution");
    expect(source).toContain("Retained legal and financial categories");
    expect(source).toContain("Path-free object evidence");
    expect(source).not.toContain("objectPath");
  });
});
