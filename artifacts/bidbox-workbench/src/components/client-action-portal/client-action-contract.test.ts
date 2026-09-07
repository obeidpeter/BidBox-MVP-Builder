import { describe, expect, it } from "vitest";
import {
  adaptClientActionAuthorities,
  adaptClientActionSnapshot,
} from "./client-action-contract";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const REQUEST = "44444444-4444-4444-8444-444444444444";
const SLOT = "55555555-5555-4555-8555-555555555555";
const RECIPIENT = "66666666-6666-4666-8666-666666666666";

describe("adaptClientActionSnapshot", () => {
  it("accepts a bounded metadata-only request", () => {
    const snapshot = adaptClientActionSnapshot(
      {
        organisationId: ORG,
        projectId: PROJECT,
        authority: {
          externalMessaging: false,
          rawUpload: false,
          packageTransfer: false,
          uploadIntentOnly: true,
        },
        records: [
          {
            id: REQUEST,
            kind: "evidence_request",
            version: 1,
            createdByUserId: USER,
            recipientUserId: USER,
            purpose: "tender_evidence",
            purposeStatement: "Provide one current certificate.",
            dueAt: null,
            status: "open",
            requestAcknowledgement: null,
            slots: [
              {
                id: SLOT,
                label: "Certificate",
                required: true,
                acceptedContentTypes: ["application/pdf"],
                attempts: [],
              },
            ],
            completionReceiptSha256: null,
            externalMessageSentByValo: false,
          },
        ],
      },
      PROJECT,
    );
    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.authority.rawUpload).toBe(false);
  });

  it("fails closed when the server implies raw upload authority", () => {
    expect(() =>
      adaptClientActionSnapshot(
        {
          organisationId: ORG,
          projectId: PROJECT,
          authority: {
            externalMessaging: false,
            rawUpload: true,
            packageTransfer: false,
            uploadIntentOnly: true,
          },
          records: [],
        },
        PROJECT,
      ),
    ).toThrow(/Invalid client-action response/u);
  });
});

describe("adaptClientActionAuthorities", () => {
  const directory = () => ({
    organisationId: ORG,
    projectId: PROJECT,
    items: [{ userId: RECIPIENT, name: "Evidence Contributor" }],
    limit: 100,
    truncated: false,
  });

  it("accepts an exact name-only, project-scoped directory", () => {
    expect(
      adaptClientActionAuthorities(directory(), ORG, PROJECT, USER),
    ).toEqual(directory());
  });

  it("rejects tenant drift, self-selection and contact enrichment", () => {
    expect(() =>
      adaptClientActionAuthorities(directory(), PROJECT, PROJECT, USER),
    ).toThrow();
    const self = directory();
    self.items[0]!.userId = USER;
    expect(() =>
      adaptClientActionAuthorities(self, ORG, PROJECT, USER),
    ).toThrow();
    const enriched = directory() as ReturnType<typeof directory> & {
      email: string;
    };
    enriched.email = "not-allowed@example.test";
    expect(() =>
      adaptClientActionAuthorities(enriched, ORG, PROJECT, USER),
    ).toThrow();
  });
});
