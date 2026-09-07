import { describe, expect, it } from "vitest";
import {
  adaptCanonicalEvidenceOptions,
  evidenceBindingsFromOptions,
} from "./canonical-evidence-options";

const ORG = "10000000-0000-4000-8000-000000000001";
const PROJECT = "20000000-0000-4000-8000-000000000002";
const DOCUMENT = "30000000-0000-4000-8000-000000000003";
const SHA = "a".repeat(64);

function payload() {
  return {
    organisationId: ORG,
    projectId: PROJECT,
    limit: 10,
    truncated: false,
    items: [
      {
        documentId: DOCUMENT,
        projectId: PROJECT,
        filename: "evidence.pdf",
        projectTitle: "Pursuit Alpha",
        sha256: SHA,
        versionNumber: 3,
        detectedMime: "application/pdf",
        sizeBytes: 256,
        privacyEligible: true,
      },
    ],
  };
}

describe("canonical evidence option adapter", () => {
  it("adapts exact scope and derives server-bound document/hash pairs", () => {
    const options = adaptCanonicalEvidenceOptions(payload(), ORG, PROJECT);
    expect(evidenceBindingsFromOptions(options.items, [DOCUMENT])).toEqual([
      { documentId: DOCUMENT, sha256: SHA },
    ]);
    expect(options.truncated).toBe(false);
  });

  it("rejects scope changes, duplicate documents and unknown fields", () => {
    expect(() => adaptCanonicalEvidenceOptions(payload(), ORG, null)).toThrow(
      /scope/u,
    );
    const duplicate = payload();
    duplicate.items.push({ ...duplicate.items[0]! });
    expect(() =>
      adaptCanonicalEvidenceOptions(duplicate, ORG, PROJECT),
    ).toThrow(/canonical validation/u);
    const unknown = payload() as ReturnType<typeof payload> & {
      objectPath?: string;
    };
    unknown.objectPath = "/private/path";
    expect(() => adaptCanonicalEvidenceOptions(unknown, ORG, PROJECT)).toThrow(
      /contract/u,
    );
  });

  it("fails closed if a selected option is no longer available", () => {
    expect(() => evidenceBindingsFromOptions([], [DOCUMENT])).toThrow(
      /no longer available/u,
    );
  });
});
