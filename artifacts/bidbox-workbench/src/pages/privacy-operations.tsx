import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch, useGetMe } from "@workspace/api-client-react";
import {
  adaptPrivacyOperationsAssignees,
  adaptPrivacyOperationsDashboard,
  assertPrivacyWorkflowResponse,
  type PrivacyConsentWithdrawalDraft,
  type PrivacyDsrTriageDraft,
  type PrivacyHoldReviewDraft,
} from "@/components/privacy-operations/privacy-operations-contract";
import { PrivacyOperationsDashboardView } from "@/components/privacy-operations/privacy-operations-dashboard";
import { PrivacyWorkflowPanel } from "@/components/privacy-operations/privacy-workflow-panel";
import { PageGatePanel, StatusPanel } from "@/components/platform-states";
import { Button } from "@/components/ui/button";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useToast } from "@/hooks/use-toast";
import { adaptCanonicalEvidenceOptions } from "@/lib/canonical-evidence-options";
import { assertAuthorityScopeCurrent } from "@/lib/authority-scope";

const QUERY_ROOT = "privacy-operations";

interface WorkflowMutation {
  path: string;
  objectId: string;
  expectedEventType:
    | "privacy.dsr_triage_recorded"
    | "privacy.consent_withdrawal_recorded"
    | "privacy.legal_hold_review_recorded";
  version: number;
  body:
    | PrivacyDsrTriageDraft
    | PrivacyConsentWithdrawalDraft
    | PrivacyHoldReviewDraft;
}

export default function PrivacyOperationsPage() {
  const access = useOrganisationAccess();
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const meQuery = useGetMe();
  const organisationId = access?.activeOrganisation?.id ?? "";
  const permissions = access?.effectivePermissions ?? [];
  const actorUserId = meQuery.data?.id ?? "";
  const capabilityKey = permissions
    .filter((permission) =>
      ["privacy:read", "privacy:manage", "document:read"].includes(permission),
    )
    .sort()
    .join("|");
  const directMembership =
    access?.activeOrganisation?.accessSource === "membership" &&
    access.activeOrganisation.membershipOrganisationId === organisationId;
  const canRead = Boolean(
    organisationId &&
    actorUserId &&
    directMembership &&
    permissions.includes("privacy:read"),
  );
  const canManage = Boolean(
    organisationId &&
    actorUserId &&
    directMembership &&
    permissions.includes("privacy:manage"),
  );
  const canBrowseDocuments = Boolean(
    canManage && permissions.includes("document:read"),
  );
  const activeScope = useRef({ organisationId, actorUserId, capabilityKey });
  activeScope.current = { organisationId, actorUserId, capabilityKey };
  const queryKey = [
    QUERY_ROOT,
    organisationId,
    actorUserId,
    capabilityKey,
  ] as const;

  const assigneesQuery = useQuery({
    queryKey: [
      QUERY_ROOT,
      "assignees",
      organisationId,
      actorUserId,
      capabilityKey,
    ],
    enabled: canManage && online,
    queryFn: async () => {
      const requestedScope = { organisationId, actorUserId, capabilityKey };
      const payload = await customFetch<unknown>(
        "/api/privacy-operations/assignees",
        { responseType: "json", cache: "no-store" },
      );
      assertAuthorityScopeCurrent(
        activeScope.current,
        requestedScope,
        "Privacy authority changed while assignees loaded",
      );
      return adaptPrivacyOperationsAssignees(payload, organisationId);
    },
  });

  const dashboardQuery = useQuery({
    queryKey,
    enabled: canRead && online,
    queryFn: async () => {
      const requestedScope = { organisationId, actorUserId, capabilityKey };
      const payload = await customFetch<unknown>(
        "/api/privacy-operations?limit=25",
        { responseType: "json", cache: "no-store" },
      );
      assertAuthorityScopeCurrent(
        activeScope.current,
        requestedScope,
        "Privacy authority changed while evidence loaded",
      );
      return adaptPrivacyOperationsDashboard(payload, organisationId);
    },
  });

  const evidenceOptionsQuery = useQuery({
    queryKey: [
      "canonical-evidence-options",
      organisationId,
      actorUserId,
      capabilityKey,
      "privacy-operations",
    ],
    enabled: canBrowseDocuments && online,
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const requestedScope = { organisationId, actorUserId, capabilityKey };
      const payload = await customFetch<unknown>(
        "/api/canonical-evidence-options?limit=100",
        { responseType: "json", cache: "no-store" },
      );
      assertAuthorityScopeCurrent(
        activeScope.current,
        requestedScope,
        "Privacy authority changed while evidence options loaded",
      );
      const adapted = adaptCanonicalEvidenceOptions(
        payload,
        organisationId,
        null,
      );
      return {
        ...adapted,
        items: adapted.items.filter((option) => option.privacyEligible),
      };
    },
  });
  const evidenceOptionsPending = Boolean(
    canBrowseDocuments &&
    (evidenceOptionsQuery.isLoading || evidenceOptionsQuery.isPending),
  );
  const dashboardPending = dashboardQuery.isLoading || dashboardQuery.isPending;
  const dashboardUnavailable =
    dashboardQuery.isError ||
    (!dashboardPending &&
      (!dashboardQuery.isSuccess || dashboardQuery.data === undefined));
  const assigneesPending = assigneesQuery.isLoading || assigneesQuery.isPending;
  const assigneesUnavailable =
    assigneesQuery.isError ||
    (!assigneesPending &&
      (!assigneesQuery.isSuccess || assigneesQuery.data === undefined));

  const workflowMutation = useMutation({
    mutationFn: async (workflow: WorkflowMutation) => {
      const requestedScope = { organisationId, actorUserId, capabilityKey };
      const releaseCriticalWorkflow = access?.beginCriticalWorkflow();
      try {
        const payload = await customFetch<unknown>(workflow.path, {
          method: "POST",
          headers: { "If-Match": `"${workflow.version}"` },
          body: JSON.stringify(workflow.body),
          responseType: "json",
          cache: "no-store",
        });
        assertAuthorityScopeCurrent(
          activeScope.current,
          requestedScope,
          "Privacy authority changed while evidence was recorded",
        );
        assertPrivacyWorkflowResponse(
          payload,
          workflow.objectId,
          workflow.expectedEventType,
        );
        return {
          organisationId: requestedScope.organisationId,
          receiptSha256: payload.receipt.receiptSha256,
        };
      } finally {
        releaseCriticalWorkflow?.();
      }
    },
    onSuccess: ({ organisationId: recordedOrganisationId, receiptSha256 }) => {
      toast({
        title: "Privacy workflow evidence recorded",
        description: `Receipt ${receiptSha256.slice(0, 12)}…`,
      });
      void queryClient.invalidateQueries({
        queryKey: [QUERY_ROOT, recordedOrganisationId],
      });
    },
    onError: () => {
      toast({
        title: "Privacy workflow was not recorded",
        description:
          "Reload this organisation's privacy record and verify the named person's evidence before trying again.",
        variant: "destructive",
      });
    },
  });

  if (!canRead) {
    return (
      <PageGatePanel
        state="blocked"
        title="Direct privacy membership required"
        description="You need a direct organisation membership with permission to view privacy records. Partner access and emergency access are not accepted."
      />
    );
  }

  if (!online) {
    return (
      <PageGatePanel
        state="offline"
        title="Live privacy evidence is unavailable offline"
        description="Cached data cannot support a legal or compliance conclusion. Reconnect to load this organisation's privacy records."
      />
    );
  }

  if (dashboardPending) {
    return (
      <PageGatePanel
        state="pending"
        title="Loading privacy records"
        description="Checking organisation scope, due dates, evidence digests and audit receipts."
      />
    );
  }

  if (dashboardUnavailable || !dashboardQuery.data) {
    return (
      <PageGatePanel
        state="error"
        title="Privacy records could not be verified"
        description="We cannot show a compliance or legal conclusion without verified records."
      >
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => void dashboardQuery.refetch()}
        >
          Retry verification
        </Button>
      </PageGatePanel>
    );
  }

  const run = (workflow: WorkflowMutation) =>
    workflowMutation.mutateAsync(workflow).then(() => {});

  return (
    <PrivacyOperationsDashboardView
      dashboard={dashboardQuery.data}
      workflowPanel={
        canManage ? (
          assigneesPending ? (
            <StatusPanel
              state="pending"
              title="Loading privacy managers"
              description="Privacy actions stay disabled until the current organisation's manager list is verified."
            />
          ) : assigneesUnavailable || !assigneesQuery.data ? (
            <StatusPanel
              state="error"
              title="Privacy managers could not be loaded"
              description="We could not verify the list. This does not mean there is no active manager. Try again before reviewing a request or legal hold."
            >
              <Button
                type="button"
                variant="outline"
                onClick={() => void assigneesQuery.refetch()}
              >
                Retry manager directory
              </Button>
            </StatusPanel>
          ) : (
            <>
              {evidenceOptionsPending ? (
                <StatusPanel
                  state="pending"
                  title="Loading approved document choices"
                  description="You can still enter an external or older evidence digest. A digest alone does not prove that a security scan passed."
                />
              ) : canBrowseDocuments && evidenceOptionsQuery.isError ? (
                <StatusPanel
                  state="error"
                  title="Approved document choices are unavailable"
                  description="You can still enter an external or older evidence digest. A digest alone does not prove that a security scan passed."
                />
              ) : null}
              <PrivacyWorkflowPanel
                dashboard={dashboardQuery.data}
                assigneeOptions={assigneesQuery.data.items.map(
                  ({ userId, name }) => ({
                    id: userId,
                    name,
                  }),
                )}
                evidenceOptions={evidenceOptionsQuery.data?.items ?? []}
                evidenceOptionsTruncated={
                  evidenceOptionsQuery.data?.truncated ?? false
                }
                evidenceOptionsPending={evidenceOptionsPending}
                busy={workflowMutation.isPending}
                onTriage={(id, version, body) =>
                  run({
                    path: `/api/privacy-operations/data-subject-requests/${id}/triage`,
                    objectId: id,
                    expectedEventType: "privacy.dsr_triage_recorded",
                    version,
                    body,
                  })
                }
                onWithdraw={(id, version, body) =>
                  run({
                    path: `/api/privacy-operations/consent-records/${id}/withdrawal`,
                    objectId: id,
                    expectedEventType: "privacy.consent_withdrawal_recorded",
                    version,
                    body,
                  })
                }
                onReviewHold={(id, version, body) =>
                  run({
                    path: `/api/privacy-operations/legal-holds/${id}/reviews`,
                    objectId: id,
                    expectedEventType: "privacy.legal_hold_review_recorded",
                    version,
                    body,
                  })
                }
              />
            </>
          )
        ) : undefined
      }
    />
  );
}
