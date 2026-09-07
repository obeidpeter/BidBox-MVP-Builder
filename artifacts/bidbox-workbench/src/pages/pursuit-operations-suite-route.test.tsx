import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import {
  OperationsSuitePayloadError,
  adaptOperationsMobileQueuePayload,
  adaptOperationsSuitePayload,
  adaptPackageVersionListPayload,
  adaptProjectDocumentOptions,
  adaptVaultItemOptions,
} from "./operations-suite-codec";
import PursuitOperationsSuiteRoute from "./pursuit-operations-suite-route";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const NOW = "2026-08-11T08:00:00.000Z";
const PACKAGE_ID = "11111111-1111-4111-8111-111111111111";
const PACKAGE_VERSION_ID = "22222222-2222-4222-8222-222222222222";

interface VisualQaFixture {
  id: string;
  kind: string;
  updatedAt: string;
  manifestSha256: string;
  result: {
    algorithmVersion: string;
    status: string;
    inputSha256: string;
    findings: Array<{
      code: string;
      severity: string;
      message: string;
      pageNumber: number | null;
    }>;
  };
  [key: string]: unknown;
}

const apiState = {
  projectsQuery: {} as Record<string, unknown>,
  meQuery: {} as Record<string, unknown>,
  documentsQuery: {} as Record<string, unknown>,
  vaultItemsQuery: {} as Record<string, unknown>,
  customFetch: vi.fn(),
  permissions: [
    "project:read",
    "project:update",
    "evidence:read",
    "package:read",
  ],
  online: true,
};
const toast = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => apiState.customFetch(...args),
  getListProjectsQueryKey: () => ["/api/projects"],
  getListDocumentsQueryKey: (projectId: string) => [
    `/api/projects/${projectId}/documents`,
  ],
  getListVaultItemsQueryKey: (clientId: string) => [
    `/api/clients/${clientId}/vault`,
  ],
  useListProjects: () => apiState.projectsQuery,
  useGetMe: () => apiState.meQuery,
  useListDocuments: () => apiState.documentsQuery,
  useListVaultItems: () => apiState.vaultItemsQuery,
}));

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationAccess: () => ({
    activeOrganisation: { id: "org-1" },
    effectivePermissions: apiState.permissions,
    beginCriticalWorkflow: () => () => {},
  }),
}));

vi.mock("@/hooks/use-online-status", () => ({
  useOnlineStatus: () => apiState.online,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

function base(id: string, kind: string, projectId = "project-1") {
  return {
    id,
    kind,
    organisationId: "org-1",
    projectId,
    version: 3,
    createdByUserId: "user-2",
    updatedByUserId: "user-2",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function operationsPayload(projectId = "project-1") {
  const records = [
    {
      ...base("opportunity-1", "opportunity_intake", projectId),
      title: "Network operations framework",
      issuer: "Infrastructure Agency",
      reference: "IA/2026/14",
      lot: null,
      source: {
        type: "manual_url",
        locator: "https://procurement.example.test/notices/14",
        receivedAt: NOW,
        authorisationBasis: null,
        contentSha256: null,
      },
      dedupeKey: HASH_A,
      provenanceSha256: HASH_B,
      deadline: "2099-09-04T11:00:00.000Z",
      deadlineStatus: "unconfirmed",
      deadlineConfirmedByUserId: null,
      deadlineConfirmedAt: null,
      status: "recorded",
    },
    {
      ...base("work-1", "work_item", projectId),
      title: "Map mandatory tax evidence",
      description: null,
      ownerUserId: "user-1",
      dueAt: "2099-08-15T16:00:00.000Z",
      priority: "high",
      status: "in_progress",
      links: {
        requirementIds: ["requirement-1"],
        evidenceItemIds: ["evidence-1"],
        packageIds: [],
      },
      dependsOnIds: [],
      comments: [],
      statusReasonHistory: [
        {
          id: "reason-work-1",
          fromStatus: "in_progress",
          toStatus: "cancelled",
          reason: "A prior cancellation reason that must not look current.",
          recordedByUserId: "user-2",
          recordedAt: NOW,
        },
      ],
      approval: {
        status: "not_required",
        decidedByUserId: null,
        decidedAt: null,
        reason: null,
      },
    },
    {
      ...base("evidence-request-1", "evidence_request", projectId),
      recipientLabel: "Client finance lead",
      dueAt: "2099-08-14T16:00:00.000Z",
      requestMessage: "Supply current tax evidence.",
      deliveryMode: "manual_out_of_band",
      status: "response_recorded",
      sharedByUserId: "user-2",
      sharedAt: NOW,
      slots: [
        {
          id: "slot-1",
          label: "Tax clearance certificate",
          required: true,
          acceptedContentTypes: ["application/pdf"],
          response: {
            documentId: "document-1",
            sha256: HASH_A,
            attestation: "Uploaded by the authorised client operator.",
            recordedByUserId: "user-2",
            recordedAt: NOW,
          },
          acceptance: null,
          responseHistory: [
            {
              response: {
                documentId: "document-prior",
                sha256: HASH_B,
                attestation: "Prior response supplied by the client operator.",
                recordedByUserId: "user-2",
                recordedAt: "2026-08-10T08:00:00.000Z",
              },
              acceptance: {
                decision: "rejected",
                reason: "The prior certificate had expired.",
                decidedByUserId: "user-1",
                decidedAt: "2026-08-10T09:00:00.000Z",
              },
            },
          ],
        },
      ],
      receiptSha256: null,
    },
    {
      ...base("submission-1", "submission_war_room", projectId),
      packageId: "package-1",
      packageVersionId: "package-version-1",
      manifestSha256: HASH_A,
      copyCount: 2,
      sealIdentifiers: ["seal-1"],
      status: "dispatched",
      externalActionPolicy: "record_only",
      frozenByUserId: "user-2",
      frozenAt: NOW,
      dispatchedByUserId: "user-2",
      dispatchedAt: NOW,
      dispatchMethod: "Courier service",
      receiptSha256: null,
      receiptRecordedByUserId: null,
      receiptRecordedAt: null,
      statusReasonHistory: [],
    },
    {
      ...base("visual-qa-1", "visual_qa_report", projectId),
      packageVersionId: "package-version-1",
      manifestSha256: HASH_A,
      expectedManifestSha256: HASH_A,
      result: {
        algorithmVersion: "visual-qa-v1",
        status: "pass",
        inputSha256: HASH_B,
        findings: [],
      },
    },
    {
      ...base("credential-1", "credential_verification", projectId),
      vaultItemId: "vault-item-1",
      vaultItemVersion: 6,
      documentSha256: HASH_B,
      authorityName: "Revenue authority",
      officialSourceLocator: "https://verify.example.test",
      checkedAt: NOW,
      checkedByUserId: "user-2",
      outcome: "inconclusive",
      receiptSha256: HASH_A,
      notes: null,
      verificationMode: "human_recorded",
    },
    {
      ...base("mission-1", "mission", projectId),
      missionType: "site_visit",
      title: "Mandatory network site visit",
      location: "Abuja data centre",
      startsAt: "2099-08-20T09:00:00.000Z",
      attendanceRequired: true,
      delegateUserId: "user-2",
      delegateAuthorityNote: "Delegation letter held by the named operator.",
      checklist: [
        {
          id: "checklist-1",
          label: "Carry delegation letter",
          required: true,
          completedByUserId: null,
          completedAt: null,
        },
      ],
      proofs: [],
      followUpWorkItemIds: [],
      status: "planned",
      statusReasonHistory: [],
    },
    {
      ...base("post-award-1", "post_award_item", projectId),
      category: "completion_record",
      title: "Submit mobilisation plan",
      description: null,
      dueAt: "2099-09-10T16:00:00.000Z",
      ownerUserId: null,
      sourceDocumentId: null,
      evidenceDocumentIds: ["document-1"],
      valueMinorUnits: null,
      currency: null,
      status: "cancelled",
      completionReceiptSha256: null,
      completedByUserId: null,
      completedAt: null,
      statusReasonHistory: [
        {
          id: "reason-award-1",
          fromStatus: "open",
          toStatus: "cancelled",
          reason: "Contracting authority withdrew this recorded obligation.",
          recordedByUserId: "user-2",
          recordedAt: NOW,
        },
      ],
    },
  ];
  return {
    organisationId: "org-1",
    projectId,
    records,
    counts: Object.fromEntries(
      [
        "opportunity_intake",
        "work_item",
        "evidence_request",
        "submission_war_room",
        "visual_qa_report",
        "credential_verification",
        "mission",
        "post_award_item",
      ].map((kind) => [
        kind,
        records.filter((record) => record.kind === kind).length,
      ]),
    ),
    authority: {
      opportunityAcquisition: "record_only",
      clientDelivery: "manual_out_of_band",
      credentialVerification: "human_recorded",
      submission: "record_only",
    },
    visibility: {
      visibleKinds: [
        "opportunity_intake",
        "work_item",
        "evidence_request",
        "submission_war_room",
        "visual_qa_report",
        "credential_verification",
        "mission",
        "post_award_item",
      ],
      filtered: false,
    },
  };
}

function resetApiState() {
  apiState.projectsQuery = {
    data: [
      {
        id: "project-1",
        clientId: "client-1",
        tenderTitle: "Network operations framework",
      },
      {
        id: "project-2",
        clientId: "client-2",
        tenderTitle: "Data centre framework",
      },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
  apiState.meQuery = {
    data: { id: "user-1" },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
  apiState.documentsQuery = {
    data: [],
    isLoading: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  };
  apiState.vaultItemsQuery = {
    data: [],
    isLoading: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  };
  apiState.permissions = [
    "project:read",
    "project:update",
    "evidence:read",
    "package:read",
  ];
  apiState.online = true;
  apiState.customFetch = vi.fn(async (path: string) => {
    if (path.includes("project-2")) return operationsPayload("project-2");
    return operationsPayload();
  });
  toast.mockReset();
}

function mobileQueuePayload() {
  return {
    restrictedContent: true,
    maxItems: 250,
    items: [
      {
        id: "work-1",
        recordId: "work-1",
        subresourceId: null,
        kind: "work_item",
        status: "in_progress",
        label: "Map mandatory tax evidence",
        dueAt: "2099-08-15T16:00:00.000Z",
        priority: "high",
        action: "continue_work",
        restrictedContent: true,
      },
      {
        id: "evidence-request-1:slot-1",
        recordId: "evidence-request-1",
        subresourceId: "slot-1",
        kind: "evidence_request",
        status: "awaiting_decision",
        label: "Tax clearance certificate",
        dueAt: null,
        priority: null,
        action: "review_evidence_response",
        restrictedContent: true,
      },
    ],
  };
}

function packageVersionsPayload() {
  return {
    items: [
      {
        packageId: PACKAGE_ID,
        packageVersionId: PACKAGE_VERSION_ID,
        packageType: "project_export",
        versionNumber: 2,
        manifestSha256: HASH_A,
        renderQaStatus: "pending",
        createdAt: NOW,
      },
    ],
    limit: 100,
    truncated: false,
  };
}

function renderRoute(path = "/pursuit-operations?project=project-1") {
  const location = memoryLocation({ path, record: true });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PursuitOperationsSuiteRoute />
        </Router>
      </QueryClientProvider>,
    ),
    location,
  };
}

describe("operations-suite response adapter", () => {
  it("validates and maps all eight record kinds without persisting mobile data", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const adapted = adaptOperationsSuitePayload(operationsPayload(), {
      organisationId: "org-1",
      projectId: "project-1",
      projectTitle: "Network operations framework",
      currentUserId: "user-1",
    });

    expect(adapted.snapshot.generatedAt).toBeNull();
    expect(adapted.snapshot.opportunities).toHaveLength(1);
    expect(adapted.snapshot.workItems[0]).toMatchObject({
      status: "in_progress",
      assignedToCurrentUser: true,
      statusReason: null,
    });
    expect(adapted.snapshot.evidenceRequests[0]).toMatchObject({
      status: "response_recorded",
      uploadCount: 1,
      priorRejectedResponseCount: 1,
    });
    expect(adapted.recorderRecords.evidenceRequests[0]?.slots[0]).toMatchObject(
      {
        acceptanceDecision: null,
        priorResponseCount: 1,
      },
    );
    expect(adapted.snapshot.submissionPackages[0]).toMatchObject({
      status: "dispatched",
      deliveryMethod: "other",
      deliveryMethodLabel: "Courier service",
    });
    expect(adapted.snapshot.submissionPackages[0].qaChecks).toHaveLength(1);
    expect(adapted.snapshot.credentialChecks[0].status).toBe("inconclusive");
    expect(adapted.snapshot.credentialChecks[0]).toMatchObject({
      vaultItemVersion: 6,
      documentHash: HASH_B,
    });
    expect(adapted.snapshot.missionEvents[0].status).toBe("planned");
    expect(adapted.snapshot.obligations[0]).toMatchObject({
      category: "completion_record",
      status: "cancelled",
      statusReason: expect.stringContaining(
        "Contracting authority withdrew this recorded obligation.",
      ),
    });
    expect(adapted.snapshot.mobileReviewItems.map(({ kind }) => kind)).toEqual([
      "work",
      "evidence",
      "receipt",
      "event",
    ]);
    expect(
      adapted.snapshot.mobileReviewItems.every(
        ({ restrictedContent }) => restrictedContent,
      ),
    ).toBe(true);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("uses only the latest QA report matching the current package manifest", () => {
    const payload = operationsPayload();
    const records = payload.records as unknown[];
    const original = records.find(
      (record) =>
        typeof record === "object" &&
        record !== null &&
        "kind" in record &&
        record.kind === "visual_qa_report",
    ) as VisualQaFixture | undefined;
    if (!original) throw new Error("Visual QA fixture is missing");
    original.result = {
      ...original.result,
      status: "fail",
      findings: [
        {
          code: "clipped_content",
          severity: "blocker",
          message: "Old clipped-content result.",
          pageNumber: 2,
        },
      ],
    };
    const newerMatching = {
      ...original,
      id: "visual-qa-2",
      updatedAt: "2026-08-11T09:00:00.000Z",
      result: {
        ...original.result,
        status: "pass",
        findings: [],
      },
    };
    const newestMismatched = {
      ...original,
      id: "visual-qa-3",
      updatedAt: "2026-08-11T10:00:00.000Z",
      manifestSha256: HASH_B,
      result: {
        ...original.result,
        status: "fail",
      },
    };
    records.push(newerMatching, newestMismatched);
    payload.counts.visual_qa_report = 3;

    const adapted = adaptOperationsSuitePayload(payload, {
      organisationId: "org-1",
      projectId: "project-1",
      projectTitle: "Network operations framework",
      currentUserId: "user-1",
    });
    const checks = adapted.snapshot.submissionPackages[0].qaChecks;
    expect(checks.map(({ id }) => id)).toEqual(["visual-qa-2:summary"]);
    expect(checks[0]).toMatchObject({ status: "pass" });

    const mismatchOnly = operationsPayload();
    const mismatchReport = (mismatchOnly.records as unknown[]).find(
      (record) =>
        typeof record === "object" &&
        record !== null &&
        "kind" in record &&
        record.kind === "visual_qa_report",
    ) as VisualQaFixture | undefined;
    if (!mismatchReport) throw new Error("Visual QA fixture is missing");
    mismatchReport.manifestSha256 = HASH_B;
    const mismatched = adaptOperationsSuitePayload(mismatchOnly, {
      organisationId: "org-1",
      projectId: "project-1",
      projectTitle: "Network operations framework",
      currentUserId: "user-1",
    });
    expect(mismatched.snapshot.submissionPackages[0].qaChecks).toEqual([
      expect.objectContaining({
        label: "Visual QA is not current",
        status: "warning",
      }),
    ]);
  });

  it("accepts a truthful permission-filtered projection and preserves visible domains", () => {
    const payload = operationsPayload();
    const visibleKinds = [
      "opportunity_intake",
      "work_item",
      "mission",
      "post_award_item",
    ];
    payload.records = payload.records.filter((record) =>
      visibleKinds.includes(record.kind),
    );
    payload.counts = Object.fromEntries(
      Object.keys(payload.counts).map((kind) => [
        kind,
        payload.records.filter((record) => record.kind === kind).length,
      ]),
    ) as typeof payload.counts;
    payload.visibility = { visibleKinds, filtered: true };

    const adapted = adaptOperationsSuitePayload(payload, {
      organisationId: "org-1",
      projectId: "project-1",
      projectTitle: "Network operations framework",
      currentUserId: "user-1",
    });
    expect(adapted.visibleKinds).toEqual(visibleKinds);
    expect(adapted.snapshot.evidenceRequests).toEqual([]);
    expect(adapted.snapshot.submissionPackages).toEqual([]);
    expect(adapted.snapshot.credentialChecks).toEqual([]);
  });

  it.each([
    [
      "scope mismatch",
      () => ({ ...operationsPayload(), projectId: "project-2" }),
    ],
    [
      "count mismatch",
      () => ({
        ...operationsPayload(),
        counts: { ...operationsPayload().counts, work_item: 9 },
      }),
    ],
    [
      "unknown kind",
      () => {
        const payload = operationsPayload();
        payload.records[0] = { ...payload.records[0], kind: "unknown_kind" };
        return payload;
      },
    ],
    [
      "visibility mismatch",
      () => ({
        ...operationsPayload(),
        visibility: {
          visibleKinds: ["opportunity_intake"],
          filtered: false,
        },
      }),
    ],
  ])("fails closed on %s", (_label, payload) => {
    expect(() =>
      adaptOperationsSuitePayload(payload(), {
        organisationId: "org-1",
        projectId: "project-1",
        projectTitle: "Network operations framework",
        currentUserId: "user-1",
      }),
    ).toThrow(OperationsSuitePayloadError);
  });
});

describe("operations mobile-queue response adapter", () => {
  it("maps the bounded summary without record bodies or browser persistence", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    expect(
      adaptOperationsMobileQueuePayload(mobileQueuePayload(), "project-1"),
    ).toEqual([
      expect.objectContaining({
        id: "work:work-1",
        kind: "work",
        title: "Map mandatory tax evidence",
        statusLabel: "high priority · in progress",
      }),
      expect.objectContaining({
        id: "evidence:evidence-request-1:slot-1",
        kind: "evidence",
        title: "Tax clearance certificate",
      }),
    ]);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("fails closed on mismatched action, identity or queue bounds", () => {
    expect(() =>
      adaptOperationsMobileQueuePayload(
        {
          ...mobileQueuePayload(),
          items: [
            {
              ...mobileQueuePayload().items[0],
              action: "prepare_mission",
            },
          ],
        },
        "project-1",
      ),
    ).toThrow(OperationsSuitePayloadError);
    expect(() =>
      adaptOperationsMobileQueuePayload(
        { ...mobileQueuePayload(), maxItems: 251 },
        "project-1",
      ),
    ).toThrow(OperationsSuitePayloadError);
  });
});

describe("canonical package-version response adapter", () => {
  it("accepts only the bounded, content-free project-export list", () => {
    expect(adaptPackageVersionListPayload(packageVersionsPayload())).toEqual({
      items: [
        {
          packageId: PACKAGE_ID,
          packageVersionId: PACKAGE_VERSION_ID,
          versionNumber: 2,
          manifestSha256: HASH_A,
          renderQaStatus: "pending",
          createdAt: NOW,
        },
      ],
      truncated: false,
    });
  });

  it.each([
    { ...packageVersionsPayload(), limit: 101 },
    {
      ...packageVersionsPayload(),
      items: [
        {
          ...packageVersionsPayload().items[0],
          packageId: "not-a-uuid",
        },
      ],
    },
    {
      ...packageVersionsPayload(),
      items: [
        {
          ...packageVersionsPayload().items[0],
          packageType: "submission_bundle",
        },
      ],
    },
    {
      ...packageVersionsPayload(),
      items: [
        packageVersionsPayload().items[0],
        packageVersionsPayload().items[0],
      ],
    },
  ])("fails closed on an invalid list contract", (payload) => {
    expect(() => adaptPackageVersionListPayload(payload)).toThrow(
      OperationsSuitePayloadError,
    );
  });
});

describe("canonical operations reference adapters", () => {
  it("projects non-quarantined documents and matching active Vault snapshots", () => {
    const documents = adaptProjectDocumentOptions(
      [
        {
          id: "document-1",
          projectId: "project-1",
          filename: "tax-clearance.pdf",
          contentType: "application/pdf",
          sha256: HASH_A,
          extractionStatus: "complete",
          redactionStatus: "included",
        },
        {
          id: "document-2",
          projectId: "project-1",
          filename: "quarantined.pdf",
          contentType: "application/pdf",
          sha256: HASH_B,
          extractionStatus: "quarantined",
          redactionStatus: "excluded",
        },
      ],
      "project-1",
    );
    expect(documents).toEqual([
      {
        id: "document-1",
        filename: "tax-clearance.pdf",
        contentType: "application/pdf",
        sha256: HASH_A,
        status: "extraction complete; redaction included",
      },
    ]);
    expect(
      adaptVaultItemOptions(
        [
          {
            id: "vault-1",
            clientId: "client-1",
            artefactType: "Tax clearance",
            issuer: "Revenue authority",
            status: "active",
            version: 6,
            sha256: HASH_A,
            sourceDocumentId: "document-1",
          },
          {
            id: "vault-2",
            clientId: "client-1",
            artefactType: "Unbound certificate",
            issuer: null,
            status: "active",
            version: 1,
            sha256: HASH_B,
            sourceDocumentId: "document-2",
          },
        ],
        "client-1",
        documents,
      ),
    ).toEqual([
      {
        id: "vault-1",
        label: "Tax clearance — Revenue authority",
        version: 6,
        documentSha256: HASH_A,
        status: "active",
      },
    ]);
  });

  it("fails closed on cross-project document and cross-client Vault rows", () => {
    expect(() =>
      adaptProjectDocumentOptions(
        [
          {
            id: "document-1",
            projectId: "project-2",
            filename: "wrong-project.pdf",
            contentType: "application/pdf",
            sha256: HASH_A,
            extractionStatus: "complete",
            redactionStatus: "included",
          },
        ],
        "project-1",
      ),
    ).toThrow(OperationsSuitePayloadError);
    expect(() =>
      adaptVaultItemOptions(
        [
          {
            id: "vault-1",
            clientId: "client-2",
            artefactType: "Tax clearance",
            issuer: null,
            status: "active",
            version: 6,
            sha256: HASH_A,
            sourceDocumentId: "document-1",
          },
        ],
        "client-1",
        [],
      ),
    ).toThrow(OperationsSuitePayloadError);
  });
});

describe("PursuitOperationsSuiteRoute", () => {
  beforeEach(resetApiState);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the selected project and sends only exact CAS mutation bodies", async () => {
    const user = userEvent.setup();
    renderRoute();

    expect(
      await screen.findByRole("heading", {
        name: "Pursuit workflows",
      }),
    ).toBeInTheDocument();
    await screen.findByRole("heading", { name: "Record operations" });
    expect(screen.getByLabelText("Pursuit")).toHaveValue("project-1");
    expect(apiState.customFetch).toHaveBeenCalledWith(
      "/api/projects/project-1/operations-suite",
      { responseType: "json", cache: "no-store" },
    );

    await user.click(
      screen.getByRole("button", { name: "Confirm source and deadline" }),
    );
    await waitFor(() =>
      expect(apiState.customFetch).toHaveBeenCalledWith(
        "/api/projects/project-1/operations-suite/opportunities/opportunity-1/confirm-deadline",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            expectedVersion: 3,
            deadline: "2099-09-04T11:00:00.000Z",
          }),
        }),
      ),
    );

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Recorded work status" }),
      "in_review",
    );
    await waitFor(() =>
      expect(apiState.customFetch).toHaveBeenCalledWith(
        "/api/projects/project-1/operations-suite/work-items/work-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ expectedVersion: 3, status: "in_review" }),
        }),
      ),
    );

    expect(
      screen.queryByRole("button", { name: "Record acceptance" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Record human check" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Record human-obtained receipt" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Add completion evidence" }),
    ).toBeDisabled();
  }, 15_000);

  it("changes project without retaining the prior snapshot or recorder text", async () => {
    const { location } = renderRoute();
    await screen.findByRole("heading", { name: "Pursuit workflows" });
    await screen.findByRole("heading", { name: "Record operations" });
    fireEvent.click(screen.getByText("1. Opportunity intake"));
    fireEvent.change(screen.getByLabelText("Opportunity title"), {
      target: { value: "Sensitive former-project title" },
    });
    fireEvent.click(screen.getByText("2. Pursuit work"));
    fireEvent.change(screen.getByLabelText("Work owner"), {
      target: { value: "user-1" },
    });
    expect(screen.getByLabelText("Opportunity title")).toHaveValue(
      "Sensitive former-project title",
    );
    expect(screen.getByLabelText("Work owner")).toHaveValue("user-1");
    fireEvent.change(screen.getByLabelText("Pursuit"), {
      target: { value: "project-2" },
    });

    await waitFor(() =>
      expect(location.history.at(-1)).toContain("project=project-2"),
    );
    await waitFor(() =>
      expect(apiState.customFetch).toHaveBeenCalledWith(
        "/api/projects/project-2/operations-suite",
        { responseType: "json", cache: "no-store" },
      ),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Opportunity title")).toHaveValue(""),
    );
    expect(screen.getByLabelText("Work owner")).toHaveValue("");
    expect(
      apiState.customFetch.mock.calls.some(
        ([path, options]) =>
          String(path).endsWith("/operations-suite/opportunities") &&
          (options as { method?: string } | undefined)?.method === "POST",
      ),
    ).toBe(false);
  }, 15_000);

  it("uses the summary endpoint exclusively in URL-driven mobile mode", async () => {
    const user = userEvent.setup();
    apiState.customFetch = vi.fn(async (path: string) => {
      if (path.endsWith("/operations-suite/mobile-queue")) {
        return mobileQueuePayload();
      }
      return operationsPayload();
    });
    renderRoute("/pursuit-operations?project=project-1&view=mobile");

    expect(
      await screen.findByRole("heading", {
        name: "Mobile summary for slow connections",
      }),
    ).toBeInTheDocument();
    expect(apiState.customFetch).toHaveBeenCalledWith(
      "/api/projects/project-1/operations-suite/mobile-queue",
      { responseType: "json", cache: "no-store" },
    );
    expect(apiState.customFetch).not.toHaveBeenCalledWith(
      "/api/projects/project-1/operations-suite",
      expect.anything(),
    );
    expect(
      screen.queryByRole("heading", { name: "Pursuit workflows" }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("link", { name: "Back to full pursuit operations" }),
    );
    await waitFor(() =>
      expect(apiState.customFetch).toHaveBeenCalledWith(
        "/api/projects/project-1/operations-suite",
        { responseType: "json", cache: "no-store" },
      ),
    );
  });

  it("loads canonical package choices only for authorised package recorders", async () => {
    apiState.permissions = [
      "project:read",
      "package:read",
      "package:export",
      "package:generate",
    ];
    apiState.customFetch = vi.fn(async (path: string) => {
      if (path.endsWith("/package-versions")) return packageVersionsPayload();
      return operationsPayload();
    });
    renderRoute();

    expect(
      await screen.findByRole("heading", { name: "Pursuit workflows" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(apiState.customFetch).toHaveBeenCalledWith(
        "/api/projects/project-1/package-versions",
        { responseType: "json", cache: "no-store" },
      ),
    );
    const user = userEvent.setup();
    const panelTitle = screen.getByText("4. Submission tracking");
    const details = panelTitle.closest("details");
    if (!details) throw new Error("Submission recorder panel is missing");
    await user.click(panelTitle);
    expect(
      screen.getByLabelText("Approved package version", {
        selector: "#submissionPackageVersion",
      }),
    ).toHaveTextContent("11111111-1");
  });

  it("hides evidence and package sections without their exact read permissions", async () => {
    apiState.permissions = ["project:read", "project:update"];
    const { container } = renderRoute();
    await screen.findByRole("heading", { name: "Pursuit workflows" });
    await screen.findByRole("heading", { name: "Record operations" });

    expect(container.querySelector("#opportunity-intake")).not.toBeNull();
    expect(container.querySelector("#pursuit-board")).not.toBeNull();
    expect(container.querySelector("#event-mission-control")).not.toBeNull();
    expect(container.querySelector("#post-award-control")).not.toBeNull();
    expect(container.querySelector("#evidence-request-room")).toBeNull();
    expect(container.querySelector("#credential-verification")).toBeNull();
    expect(container.querySelector("#submission-war-room")).toBeNull();
    expect(container.querySelector("#mobile-reviewer")).toBeNull();
  });

  it("distinguishes loading, no-project, read-only and invalid-response states", async () => {
    apiState.projectsQuery = {
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    };
    const loading = renderRoute();
    expect(
      screen.getByText("Loading pursuit operations records"),
    ).toBeInTheDocument();
    loading.unmount();

    apiState.projectsQuery = {
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    const empty = renderRoute();
    expect(
      screen.getByRole("heading", {
        name: "No accessible pursuits are available",
      }),
    ).toBeInTheDocument();
    empty.unmount();

    resetApiState();
    apiState.permissions = ["project:read"];
    const readOnly = renderRoute();
    expect(
      await screen.findByRole("heading", { name: "Read-only operations view" }),
    ).toBeInTheDocument();
    await screen.findByRole("heading", { name: "Record operations" });
    expect(
      screen.getByRole("button", { name: "Confirm source and deadline" }),
    ).toBeDisabled();
    readOnly.unmount();

    resetApiState();
    apiState.customFetch = vi.fn(async () => ({
      ...operationsPayload(),
      projectId: "wrong-project",
    }));
    renderRoute();
    expect(
      await screen.findByRole("heading", {
        name: "Pursuit operations could not be loaded",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /summary for this organisation was unavailable or invalid/i,
      ),
    ).toBeInTheDocument();
  });
});
