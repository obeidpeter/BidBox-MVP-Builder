import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { ProductionAcceptanceConsole } from "@/components/production-acceptance/production-acceptance-console";
import {
  adaptProductionAcceptanceAuthorities,
  adaptProductionAcceptanceSnapshot,
  assertProductionAcceptanceRecordResponse,
  type ProductionAcceptanceEvidenceDraft,
} from "@/components/production-acceptance/production-acceptance-contract";
import { ProductionAcceptanceEvidenceForm } from "@/components/production-acceptance/production-acceptance-evidence-form";
import { PageGatePanel, StatusPanel } from "@/components/platform-states";
import { Button } from "@/components/ui/button";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useToast } from "@/hooks/use-toast";

const QUERY_ROOT = "production-acceptance";
const READ_ROLES = new Set([
  "valo_operations_administrator",
  "restricted_platform_administrator",
  "valo_quality_adviser",
]);
const RECORD_ROLES = new Set([
  "valo_operations_administrator",
  "valo_quality_adviser",
]);

export default function ProductionAcceptancePage() {
  const access = useOrganisationAccess();
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const organisationId = access?.activeOrganisation?.id ?? "";
  const roles = access?.effectiveRoles ?? [];
  const permissions = access?.effectivePermissions ?? [];
  const directMembership =
    access?.activeOrganisation?.accessSource === "membership";
  const canRead = Boolean(
    organisationId &&
    directMembership &&
    permissions.includes("audit:read") &&
    roles.some((role) => READ_ROLES.has(role)),
  );
  const canRecord = Boolean(
    canRead &&
    roles.some((role) => RECORD_ROLES.has(role)) &&
    (permissions.includes("configuration:manage") ||
      permissions.includes("evaluation:manage")),
  );
  const activeOrganisationId = useRef(organisationId);
  activeOrganisationId.current = organisationId;
  const queryKey = [QUERY_ROOT, organisationId] as const;

  const authoritiesQuery = useQuery({
    queryKey: [QUERY_ROOT, "authorities", organisationId],
    enabled: canRecord && online,
    queryFn: async () => {
      const requestedOrganisationId = organisationId;
      const payload = await customFetch<unknown>(
        "/api/production-acceptance/authorities",
        {
          responseType: "json",
          cache: "no-store",
        },
      );
      if (activeOrganisationId.current !== requestedOrganisationId) {
        throw new Error(
          "Organisation changed while acceptance authorities loaded",
        );
      }
      return adaptProductionAcceptanceAuthorities(
        payload,
        requestedOrganisationId,
      );
    },
  });
  const ownerOptions =
    authoritiesQuery.data?.items.map(({ userId, name }) => ({
      id: userId,
      name,
    })) ?? [];

  const snapshotQuery = useQuery({
    queryKey,
    enabled: canRead && online,
    queryFn: async () => {
      const requestedOrganisationId = organisationId;
      const payload = await customFetch<unknown>("/api/production-acceptance", {
        responseType: "json",
        cache: "no-store",
      });
      if (activeOrganisationId.current !== requestedOrganisationId) {
        throw new Error(
          "Organisation changed while acceptance evidence loaded",
        );
      }
      return adaptProductionAcceptanceSnapshot(
        payload,
        requestedOrganisationId,
      );
    },
  });

  const evidenceMutation = useMutation({
    mutationFn: async (draft: ProductionAcceptanceEvidenceDraft) => {
      const requestedOrganisationId = organisationId;
      const releaseCriticalWorkflow = access?.beginCriticalWorkflow();
      try {
        const payload = await customFetch<unknown>(
          "/api/production-acceptance/evidence",
          {
            method: "POST",
            body: JSON.stringify(draft),
            responseType: "json",
            cache: "no-store",
          },
        );
        if (activeOrganisationId.current !== requestedOrganisationId) {
          throw new Error(
            "Organisation changed while acceptance evidence recorded",
          );
        }
        assertProductionAcceptanceRecordResponse(
          payload,
          requestedOrganisationId,
        );
        return requestedOrganisationId;
      } finally {
        releaseCriticalWorkflow?.();
      }
    },
    onSuccess: (recordedOrganisationId) => {
      toast({ title: "Acceptance evidence reference recorded" });
      void queryClient.invalidateQueries({
        queryKey: [QUERY_ROOT, recordedOrganisationId],
      });
    },
  });

  if (!canRead) {
    return (
      <PageGatePanel
        state="blocked"
        title="Release-check access required"
        description="You need direct membership, audit-read permission and an approved Valo operations, restricted platform or quality role. Partner access and emergency access are denied."
      />
    );
  }

  if (!online) {
    return (
      <PageGatePanel
        state="offline"
        title="Live acceptance evidence is unavailable offline"
        description="Cached or missing evidence cannot support a go decision. Reconnect to load the server-verified record."
      />
    );
  }

  const snapshotPending = snapshotQuery.isLoading || snapshotQuery.isPending;
  const snapshotUnavailable =
    snapshotQuery.isError ||
    (!snapshotPending &&
      (!snapshotQuery.isSuccess || snapshotQuery.data === undefined));
  const authoritiesPending =
    authoritiesQuery.isLoading || authoritiesQuery.isPending;
  const authoritiesUnavailable =
    authoritiesQuery.isError ||
    (!authoritiesPending &&
      (!authoritiesQuery.isSuccess || authoritiesQuery.data === undefined));

  if (snapshotPending) {
    return (
      <PageGatePanel
        state="pending"
        title="Loading production acceptance evidence"
        description="Checking organisation scope, evidence digests, release match and expiry dates."
      />
    );
  }

  if (snapshotUnavailable || !snapshotQuery.data) {
    return (
      <PageGatePanel
        state="error"
        title="Release evidence could not be verified"
        description="The result remains no-go. We have not treated missing data as an empty or successful release."
      >
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => void snapshotQuery.refetch()}
        >
          Retry verification
        </Button>
      </PageGatePanel>
    );
  }

  return (
    <ProductionAcceptanceConsole
      snapshot={snapshotQuery.data}
      evidenceRecorder={
        canRecord ? (
          authoritiesPending ? (
            <StatusPanel
              state="pending"
              title="Loading acceptance owners"
              description="Evidence recording stays disabled until the current organisation's authority list is verified."
            />
          ) : authoritiesUnavailable || !authoritiesQuery.data ? (
            <StatusPanel
              state="error"
              title="Acceptance owners could not be loaded"
              description="We could not verify the list. This does not mean there is no independent authority. Try again before recording evidence."
            >
              <Button
                type="button"
                variant="outline"
                onClick={() => void authoritiesQuery.refetch()}
              >
                Retry owner list
              </Button>
            </StatusPanel>
          ) : (
            <ProductionAcceptanceEvidenceForm
              releaseSha256={snapshotQuery.data.expectedReleaseSha256}
              ownerOptions={ownerOptions}
              pending={evidenceMutation.isPending}
              onSubmit={(draft) =>
                evidenceMutation.mutateAsync(draft).then(() => {})
              }
            />
          )
        ) : undefined
      }
    />
  );
}
