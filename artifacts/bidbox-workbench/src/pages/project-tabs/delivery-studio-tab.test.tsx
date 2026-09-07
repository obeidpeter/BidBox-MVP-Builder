import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryStudioTab } from "./delivery-studio-tab";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "99999999-9999-4999-8999-999999999999";
const mutate = vi.fn();
const refetch = vi.fn();
const getStudio = vi.fn();
const toast = vi.fn();

const READ_PERMISSIONS = [
  "project:read",
  "draft:read",
  "defect:read",
  "package:read",
];

type TestFinding = {
  id: string;
  category: string;
  severity: string;
  finding: string;
  status: string;
  resolution: string | null;
  resolvedByUserId: string | null;
  resolvedAt: string | null;
  version: number;
};

type TestRehearsalReceipt = {
  id: string;
  packageVersionId: string;
  status: string;
  rehearsalId: string;
  readyForOperatorRehearsal: boolean;
  reviewerUserId: string;
  completedAt: string;
  issues: Array<{
    code: string;
    severity: "blocker" | "warning";
    message: string;
  }>;
};

const state = {
  permissions: [
    ...READ_PERMISSIONS,
    "draft:write",
    "document:read",
    "evidence:read",
    "draft:review",
    "defect:write",
    "defect:review",
    "intelligence:review",
    "package:generate",
    "package:sign_off",
  ],
  accessSource: "membership" as "membership" | "partner",
  actorName: "Delivery Reviewer",
  meLoading: false,
  loading: false,
  pending: false,
  error: false,
  data: snapshot(),
};

vi.mock("@workspace/api-client-react", () => ({
  getGetDeliveryStudioQueryKey: (projectId: string) => [
    "/api/projects/delivery-studio",
    projectId,
  ],
  useGetDeliveryStudio: (...args: unknown[]) => {
    getStudio(...args);
    return {
      data: state.data,
      isLoading: state.loading,
      isPending: state.pending,
      isError: state.error,
      isFetching: false,
      refetch,
    };
  },
  useRunDeliveryStudioAction: () => ({
    mutate,
    isPending: false,
  }),
  useGetMe: () => ({
    data: { id: ACTOR_ID, name: state.actorName },
    isLoading: state.meLoading,
    isPending: state.meLoading,
  }),
}));

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationAccess: () => ({
    activeOrganisation: {
      id: "organisation-1",
      membershipOrganisationId: "organisation-1",
      accessSource: state.accessSource,
    },
    effectivePermissions: state.permissions,
    isLoading: false,
  }),
  useOrganisationPermission: (permission: string) =>
    state.permissions.includes(permission),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

function snapshot() {
  return {
    authorityNote:
      "Delivery Studio organises cited response work for named-human review.",
    generatedAt: "2026-08-22T12:00:00.000Z",
    version: 7,
    project: {
      id: PROJECT_ID,
      title: "Hospital equipment",
      status: "reporting",
      deadline: "2026-08-30T12:00:00.000Z",
    },
    sourceSnapshotHash: "a".repeat(64),
    responseStudio: {
      status: "ready",
      sectionCount: 1,
      claimCount: 1,
      groundedClaimCount: 1,
      placeholderCount: 0,
      sections: [
        {
          id: "section-1",
          sectionKey: "technical-approach",
          title: "Technical approach",
          status: "ready",
          currentVersionNumber: 2,
          version: {
            id: "response-version-1",
            content: "We will deliver the validated mobilisation plan.",
            contentHash: "b".repeat(64),
            authorUserId: "author-1",
            claims: [
              {
                id: "claim-1",
                claimKey: "technical-approach-claim-1",
                text: "The mobilisation plan is validated.",
                kind: "factual",
                supportMode: "exact_quote",
                groundingStatus: "approved",
                reviewerUserId: "reviewer-1",
                citations: [
                  {
                    id: "citation-1",
                    documentVersionId: "document-version-1",
                    evidenceCitation: "Tender, page 12",
                    evidenceHash: "c".repeat(64),
                  },
                ],
              },
            ],
          },
        },
      ],
    },
    redTeamReview: {
      status: "approved",
      dueAt: "2026-08-27T12:00:00.000Z",
      run: {
        id: "run-1",
        status: "approved",
        sourceSnapshotHash: "a".repeat(64),
        policyVersion: "approved-rubric-v1",
        initiatedByUserId: "reviewer-1",
        approvedByUserId: "reviewer-2" as string | null,
        approvedAt: "2026-08-22T11:00:00.000Z" as string | null,
        approvalAttestation:
          "I independently reviewed the current source-bound response and confirmed the review is complete." as
            | string
            | null,
        createdAt: "2026-08-22T09:00:00.000Z",
        findings: [] as TestFinding[],
      },
    },
    packageAssembly: {
      status: "not_started",
      package: null as ReturnType<typeof assembledPackage> | null,
    },
    submissionRehearsal: {
      status: "not_started",
      receipt: null as TestRehearsalReceipt | null,
    },
    safety: {
      automaticMutation: false,
      externalPortalAction: false,
      namedHumanAuthority: true,
    },
  };
}

function assembledPackage() {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    status: "ready",
    versionId: "33333333-3333-4333-8333-333333333333",
    versionNumber: 3,
    sourceSnapshotHash: "a".repeat(64),
    manifestHash: "d".repeat(64),
    renderQaStatus: "passed",
    manifestItems: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        ordinal: 1,
        itemType: "response_section",
        sourceObjectId: "section-1",
        sourceVersion: 2,
        filename: "technical-response.pdf",
        sha256: "e".repeat(64),
        sizeBytes: 1200,
      },
    ],
  };
}

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DeliveryStudioTab projectId={PROJECT_ID} />
    </QueryClientProvider>,
  );
}

describe("DeliveryStudioTab", () => {
  beforeEach(() => {
    state.permissions = [
      ...READ_PERMISSIONS,
      "draft:write",
      "document:read",
      "evidence:read",
      "draft:review",
      "defect:write",
      "defect:review",
      "intelligence:review",
      "package:generate",
      "package:sign_off",
    ];
    state.accessSource = "membership";
    state.actorName = "Delivery Reviewer";
    state.meLoading = false;
    state.loading = false;
    state.pending = false;
    state.error = false;
    state.data = snapshot();
    mutate.mockReset();
    refetch.mockReset();
    getStudio.mockReset();
    toast.mockReset();
  });

  it("shows all governed stages and the human/no-portal boundary", () => {
    renderTab();

    for (const name of [
      "Response Studio",
      "Red-team review",
      "Package assembly",
      "Submission rehearsal",
    ]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(
      screen.getByRole("heading", {
        name: "Named-human authority is mandatory",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Valo never uses credentials, accepts declarations, uploads files or clicks submit/i,
      ),
    ).toBeInTheDocument();
    expect(getStudio).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({
        query: expect.objectContaining({
          enabled: true,
          queryKey: ["/api/projects/delivery-studio", PROJECT_ID],
        }),
      }),
    );
  });

  it("keeps every mutation unavailable when the matching grants are absent", () => {
    state.permissions = [...READ_PERMISSIONS];
    renderTab();

    expect(
      screen.queryByRole("button", { name: "Add response section" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Review claim" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Assemble package" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/does not include draft:write, document:read/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/required red-team action permissions/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/does not include package:generate/i),
    ).toBeInTheDocument();
  });

  it.each([
    {
      label: "partner access",
      accessSource: "partner" as const,
      permissions: [...READ_PERMISSIONS],
    },
    {
      label: "narrow direct grants",
      accessSource: "membership" as const,
      permissions: READ_PERMISSIONS.filter(
        (permission) => permission !== "package:read",
      ),
    },
  ])(
    "shows an access-required state without enabling the request for $label",
    ({ accessSource, permissions }) => {
      state.accessSource = accessSource;
      state.permissions = permissions;
      renderTab();

      expect(
        screen.getByRole("heading", {
          name: "Delivery Studio access required",
        }),
      ).toBeInTheDocument();
      expect(getStudio).toHaveBeenCalledWith(
        PROJECT_ID,
        expect.objectContaining({
          query: expect.objectContaining({ enabled: false }),
        }),
      );
      expect(
        screen.queryByRole("button", { name: "Add response section" }),
      ).not.toBeInTheDocument();
    },
  );

  it.each(["", " ", "A", "A".repeat(201)])(
    "does not request Delivery Studio for an invalid actor name %#",
    (actorName) => {
      state.actorName = actorName;
      renderTab();

      expect(
        screen.getByRole("heading", { name: "Named profile required" }),
      ).toBeInTheDocument();
      expect(getStudio).toHaveBeenCalledWith(
        PROJECT_ID,
        expect.objectContaining({
          query: expect.objectContaining({ enabled: false }),
        }),
      );
    },
  );

  it("requires an explicit classified claim before saving a response version", async () => {
    renderTab();
    await userEvent.click(
      screen.getByRole("button", { name: "Add response section" }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Section key" }), {
      target: { value: "delivery-plan" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Delivery plan" },
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: "Response content" }),
      {
        target: {
          value: "Our team will follow the reviewed delivery plan.",
        },
      },
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Save response version" }),
    );
    expect(
      screen.getByText(
        "Record at least one explicit claim for this response section.",
      ),
    ).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();

    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Claims, one per line (maximum 20)",
      }),
      {
        target: {
          value: "The reviewed delivery plan is suitable for this response.",
        },
      },
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Save response version" }),
    );
    expect(mutate).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      data: {
        action: "save_response",
        sectionKey: "delivery-plan",
        title: "Delivery plan",
        content: "Our team will follow the reviewed delivery plan.",
        claims: [
          {
            claimKey: "delivery-plan-claim-1",
            text: "The reviewed delivery plan is suitable for this response.",
            kind: "opinion",
            citations: [],
          },
        ],
      },
      ifMatch: "7",
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/iu),
    });
  });

  it("blocks destructive editing when an existing section contains mixed claim evidence", async () => {
    const current = snapshot();
    const section = current.responseStudio.sections[0]!;
    section.version!.claims = [
      section.version!.claims[0]!,
      {
        id: "claim-2",
        claimKey: "technical-approach-claim-2",
        text: "The operator should retain control of submission.",
        kind: "instructional",
        supportMode: "paraphrase",
        groundingStatus: "review_required",
        reviewerUserId: "reviewer-2",
        citations: [
          {
            id: "citation-2",
            documentVersionId: "document-version-2",
            evidenceCitation: "Submission guide, page 4",
            evidenceHash: "f".repeat(64),
          },
        ],
      },
    ];
    current.responseStudio.claimCount = 2;
    current.responseStudio.groundedClaimCount = 2;
    state.data = current;
    renderTab();

    await userEvent.click(
      screen.getByRole("button", { name: "Edit response" }),
    );

    expect(
      screen.getByRole("heading", {
        name: "Existing response version is read-only",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /silently replace mixed claim kinds, support modes or citations/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /preserve all 2 recorded claims and their evidence exactly/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save response version" }),
    ).not.toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole("button", { name: "Close without changes" }),
    );
    expect(mutate).not.toHaveBeenCalled();
  });

  it("binds package assembly to the current snapshot version and a fresh idempotency key", async () => {
    renderTab();
    await userEvent.click(
      screen.getByRole("button", { name: "Assemble package" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Assemble governed manifest" }),
    );

    expect(mutate).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      data: { action: "assemble_package", packageType: "submission" },
      ifMatch: "7",
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/iu),
    });
  });

  it("records a bounded cited rehearsal for one assembled manifest file without portal actions", async () => {
    const current = snapshot();
    const stableRehearsalId = "portalrun_1234567890abcdef12345678";
    current.packageAssembly = {
      status: "ready",
      package: assembledPackage(),
    };
    current.submissionRehearsal = {
      status: "review_required",
      receipt: {
        id: "55555555-5555-4555-8555-555555555555",
        packageVersionId: "33333333-3333-4333-8333-333333333333",
        status: "review_required",
        rehearsalId: stableRehearsalId,
        readyForOperatorRehearsal: false,
        reviewerUserId: ACTOR_ID,
        completedAt: "2026-08-22T12:30:00.000Z",
        issues: [],
      },
    };
    state.data = current;
    renderTab();

    await userEvent.click(
      screen.getByRole("button", { name: "Prepare submission rehearsal" }),
    );
    expect(
      screen.getByText(
        /has no credential, declaration acceptance, upload, delivery or submit control/i,
      ),
    ).toBeInTheDocument();

    const documentId = "66666666-6666-4666-8666-666666666666";
    const documentVersionId = "77777777-7777-4777-8777-777777777777";
    fireEvent.change(
      screen.getByRole("textbox", { name: "Project document ID" }),
      { target: { value: documentId } },
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Project document version ID" }),
      { target: { value: documentVersionId } },
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Portal field label" }),
      { target: { value: "Technical response" } },
    );
    const portalRule =
      "Required file field Technical response, upload order 1. Upload the final reviewed response PDF.";
    fireEvent.change(
      screen.getByRole("textbox", { name: "Exact portal rule quote" }),
      { target: { value: portalRule } },
    );
    const rationale = "Matches the reviewed portal field exactly.";
    fireEvent.change(
      screen.getByRole("textbox", { name: "Mapping rationale" }),
      { target: { value: rationale } },
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Review note" }), {
      target: {
        value:
          "I checked the captured portal rule, assembled file and exact mapping.",
      },
    });
    await userEvent.click(
      screen.getByRole("checkbox", {
        name: /I accept this exact portal field, assembled file and mapping/i,
      }),
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Record bounded rehearsal" }),
    );
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));

    const manifestContent = `Valo Delivery Studio package manifest\nPackage ID: 22222222-2222-4222-8222-222222222222\nPackage version ID: 33333333-3333-4333-8333-333333333333\n\nFile: technical-response.pdf\nSize: 1200 bytes\nSHA-256: ${"e".repeat(64)}\nMapping: technical-response.pdf assigned to Technical response. ${rationale}\n`;
    const request = mutate.mock.calls[0]![0];
    expect(request).toMatchObject({
      projectId: PROJECT_ID,
      ifMatch: "7",
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/iu),
      data: {
        action: "rehearse_submission",
        packageVersionId: "33333333-3333-4333-8333-333333333333",
        rehearsal: {
          sources: [
            {
              sourceId: documentId,
              versionId: documentVersionId,
              kind: "other",
              title: "Verified project portal source",
              content: portalRule,
              authority: "authoritative",
              origin: `document:${documentId}:version:${documentVersionId}`,
            },
            {
              sourceId: "22222222-2222-4222-8222-222222222222",
              versionId: "33333333-3333-4333-8333-333333333333",
              kind: "company_evidence",
              title:
                "Valo Delivery Studio package manifest 33333333-3333-4333-8333-333333333333",
              content: manifestContent,
              authority: "authoritative",
              origin:
                "valo://delivery-studio/packages/22222222-2222-4222-8222-222222222222/versions/33333333-3333-4333-8333-333333333333/manifest",
            },
          ],
          fields: [
            {
              externalId: "portal-file-1",
              label: "Technical response",
              fieldType: "file",
              required: true,
              uploadOrder: 1,
              ruleText: portalRule,
              review: {
                state: "accepted",
                reviewerId: ACTOR_ID,
              },
            },
          ],
          files: [
            {
              externalId: "44444444-4444-4444-8444-444444444444",
              filename: "technical-response.pdf",
              sizeBytes: 1200,
              sizeText: "1200 bytes",
              sha256: "e".repeat(64),
            },
          ],
          mappings: [
            {
              externalId: "portal-mapping-1",
              fieldExternalId: "portal-file-1",
              fileExternalId: "44444444-4444-4444-8444-444444444444",
              rationale,
            },
          ],
          rehearsalReview: {
            subjectId: stableRehearsalId,
            review: {
              state: "accepted",
              reviewerId: ACTOR_ID,
            },
          },
        },
      },
    });
    expect(
      request.data.rehearsal.sources.every(
        (source: { contentSha256: string }) =>
          /^[a-f0-9]{64}$/u.test(source.contentSha256),
      ),
    ).toBe(true);
    expect(request.data.rehearsal).not.toHaveProperty("credentials");
    expect(request.data.rehearsal).not.toHaveProperty("upload");
    expect(request.data.rehearsal).not.toHaveProperty("submit");
  });

  it("keeps multi-file packages out of the bounded browser rehearsal", () => {
    const current = snapshot();
    const assembled = assembledPackage();
    assembled.manifestItems.push({
      id: "88888888-8888-4888-8888-888888888888",
      ordinal: 2,
      itemType: "response_section",
      sourceObjectId: "section-2",
      sourceVersion: 1,
      filename: "commercial-response.pdf",
      sha256: "f".repeat(64),
      sizeBytes: 900,
    });
    current.packageAssembly = {
      status: "ready",
      package: assembled,
    };
    state.data = current;
    renderTab();

    expect(
      screen.getByRole("button", { name: "Prepare submission rehearsal" }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        /Browser rehearsal is unavailable because this package does not contain exactly one manifest file/i,
      ),
    ).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("distinguishes stale delivery state from readiness", () => {
    state.data = {
      ...snapshot(),
      packageAssembly: { status: "stale", package: null },
    };
    renderTab();

    expect(
      screen.getByRole("heading", {
        name: "One or more delivery stages are stale",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByLabelText("Status: Stale").length).toBeGreaterThan(0);
  });

  it("never offers note-based resolution for fatal or likely-fatal findings", () => {
    const current = snapshot();
    current.redTeamReview.status = "findings_open";
    current.redTeamReview.run!.status = "findings_open";
    current.redTeamReview.run!.approvedAt = null;
    current.redTeamReview.run!.approvedByUserId = null;
    current.redTeamReview.run!.approvalAttestation = null;
    current.redTeamReview.run!.findings = [
      {
        id: "finding-fatal",
        category: "compliance",
        severity: "fatal",
        finding: "The submission basis changed.",
        status: "open",
        resolution: null,
        resolvedByUserId: null,
        resolvedAt: null,
        version: 1,
      },
      {
        id: "finding-likely-fatal",
        category: "eligibility",
        severity: "likely_fatal",
        finding: "The cited authority is no longer current.",
        status: "open",
        resolution: null,
        resolvedByUserId: null,
        resolvedAt: null,
        version: 1,
      },
    ];
    state.data = current;
    renderTab();

    expect(
      screen.queryByRole("button", { name: "Resolve finding" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByText(
        /remediate the cited source, then run a new independent review/i,
      ),
    ).toHaveLength(2);
  });

  it("hands red-team approval to a different named reviewer", () => {
    const current = snapshot();
    current.redTeamReview.status = "review_required";
    current.redTeamReview.run!.status = "review_required";
    current.redTeamReview.run!.initiatedByUserId = ACTOR_ID;
    current.redTeamReview.run!.approvedAt = null;
    current.redTeamReview.run!.approvedByUserId = null;
    current.redTeamReview.run!.approvalAttestation = null;
    state.data = current;
    renderTab();

    expect(
      screen.queryByRole("button", { name: "Record approval" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Independent approval is required" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/a different named reviewer must inspect/i),
    ).toBeInTheDocument();
  });

  it.each(["signed_off", "exported", "archived"])(
    "makes a %s project released and suppresses every mutation entry point",
    (projectStatus) => {
      const current = snapshot();
      current.project.status = projectStatus;
      current.packageAssembly = {
        status: "ready",
        package: assembledPackage(),
      };
      current.redTeamReview.status = "findings_open";
      current.redTeamReview.run!.status = "findings_open";
      current.redTeamReview.run!.findings = [
        {
          id: "finding-open",
          category: "quality",
          severity: "scoring_risk",
          finding: "Clarify the implementation sequence.",
          status: "open",
          resolution: null,
          resolvedByUserId: null,
          resolvedAt: null,
          version: 1,
        },
      ];
      state.data = current;
      renderTab();

      expect(
        screen.getByRole("heading", {
          name: "Released project — Delivery Studio is read-only",
        }),
      ).toBeInTheDocument();
      for (const name of [
        "Add response section",
        "Edit response",
        "Review claim",
        "Resolve finding",
        "Record approval",
        "Assemble package",
        "Prepare submission rehearsal",
      ]) {
        expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
      }
      expect(mutate).not.toHaveBeenCalled();
    },
  );

  it("keeps a cold-paused query loading and makes transport errors retryable", async () => {
    state.pending = true;
    const view = renderTab();
    expect(screen.getByText("Loading Delivery Studio")).toBeInTheDocument();
    expect(
      screen.queryByText("No delivery work has been recorded yet"),
    ).not.toBeInTheDocument();

    state.pending = false;
    state.error = true;
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <DeliveryStudioTab projectId={PROJECT_ID} />
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalled();
  });
});
