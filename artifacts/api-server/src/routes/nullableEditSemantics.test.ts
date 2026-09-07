import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  CreateCapabilityItemBody,
  CreateDefectBody,
  CreateEvidenceBody,
  CreateRequirementBody,
  CreateVaultItemBody,
  UpdateDefectBody,
  UpdateCapabilityItemBody,
  UpdateEvidenceBody,
  UpdateRequirementBody,
  UpdateVaultItemBody,
} from "@workspace/api-zod";

function routeSource(name: string): string {
  return readFileSync(new URL(`./${name}.ts`, import.meta.url), "utf8");
}

describe("explicit optional-field clear semantics", () => {
  test("capability edits can clear an optional description", () => {
    assert.deepEqual(UpdateCapabilityItemBody.parse({ description: null }), {
      description: null,
    });
    assert.equal(
      CreateCapabilityItemBody.safeParse({
        claimType: "project",
        description: null,
      }).success,
      false,
    );
    assert.match(
      routeSource("capability"),
      /\.set\(\{[\s\S]*\.\.\.parsed\.data/u,
    );
  });

  test("evidence edits accept null while creates continue to omit absent values", () => {
    assert.deepEqual(
      UpdateEvidenceBody.parse({
        documentId: null,
        excerpt: null,
        notes: null,
      }),
      { documentId: null, excerpt: null, notes: null },
    );
    assert.equal(
      CreateEvidenceBody.safeParse({
        projectId: "project",
        requirementId: "requirement",
        evidenceStatus: "pending",
        documentId: null,
      }).success,
      false,
    );
    const route = routeSource("evidence");
    assert.match(route, /parsed\.data\.documentId !== undefined/u);
    assert.match(route, /parsed\.data\.excerpt !== undefined/u);
    assert.match(route, /\.set\(\{[\s\S]*\.\.\.parsed\.data/u);
  });

  test("requirement edits can clear reviewer notes, evidence guidance, and citation labels", () => {
    assert.deepEqual(
      UpdateRequirementBody.parse({
        pageRef: null,
        clauseRef: null,
        expectedEvidence: null,
        reviewerNotes: null,
      }),
      {
        pageRef: null,
        clauseRef: null,
        expectedEvidence: null,
        reviewerNotes: null,
      },
    );
    assert.equal(
      CreateRequirementBody.safeParse({
        text: "Requirement",
        category: "technical",
        expectedEvidence: null,
      }).success,
      false,
    );
    assert.match(
      routeSource("requirements"),
      /\.set\(\{[\s\S]*\.\.\.parsed\.data/u,
    );
  });

  test("defect edits can unlink a requirement and clear operational ownership", () => {
    assert.deepEqual(
      UpdateDefectBody.parse({
        requirementId: null,
        evidenceSnapshot: null,
        remediation: null,
        owner: null,
      }),
      {
        requirementId: null,
        evidenceSnapshot: null,
        remediation: null,
        owner: null,
      },
    );
    assert.equal(
      CreateDefectBody.safeParse({
        projectId: "project",
        type: "omission",
        severity: "cosmetic",
        description: "Description",
        requirementId: null,
      }).success,
      false,
    );
    assert.match(routeSource("defects"), /\.set\(\{[\s\S]*\.\.\.parsed\.data/u);
  });

  test("vault edits can clear metadata and unlink copied source pointers", () => {
    assert.deepEqual(
      UpdateVaultItemBody.parse({
        issuer: null,
        issueDate: null,
        expiryDate: null,
        renewalLeadDays: null,
        sourceDocumentId: null,
      }),
      {
        issuer: null,
        issueDate: null,
        expiryDate: null,
        renewalLeadDays: null,
        sourceDocumentId: null,
      },
    );
    assert.equal(
      CreateVaultItemBody.safeParse({
        artefactType: "Certificate",
        issuer: null,
      }).success,
      false,
    );
    const route = routeSource("vault");
    assert.match(route, /parsed\.data\.sourceDocumentId === null/u);
    assert.match(route, /\{ objectPath: null, sha256: null \}/u);
    assert.match(route, /\.set\(\{[\s\S]*\.\.\.parsed\.data/u);
  });
});
