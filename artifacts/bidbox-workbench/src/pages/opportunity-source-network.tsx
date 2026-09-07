import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { OpportunitySourceConsole } from "@/components/opportunity-source-network/opportunity-source-console";
import {
  adaptOpportunitySourceCandidate,
  adaptOpportunitySourceSnapshot,
  type ManualOpportunitySourceDraft,
  type OpportunitySourceCandidate,
} from "@/components/opportunity-source-network/opportunity-source-contract";
import { PageGatePanel } from "@/components/platform-states";
import { Button } from "@/components/ui/button";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useToast } from "@/hooks/use-toast";

export default function OpportunitySourceNetworkPage() {
  const access = useOrganisationAccess();
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const organisationId = access?.activeOrganisation?.id ?? "";
  const permissions = access?.effectivePermissions ?? [];
  const directMembership =
    access?.activeOrganisation?.accessSource === "membership";
  const canRead = Boolean(
    directMembership && permissions.includes("organisation:read"),
  );
  const canManage = Boolean(canRead && permissions.includes("project:create"));
  const currentOrganisationId = useRef(organisationId);
  currentOrganisationId.current = organisationId;
  const queryKey = ["opportunity-source-network", organisationId] as const;

  const snapshot = useQuery({
    queryKey,
    enabled: canRead && online,
    queryFn: async () => {
      const requestedOrganisationId = organisationId;
      const response = await customFetch<unknown>("/api/opportunity-sources", {
        responseType: "json",
        cache: "no-store",
      });
      if (currentOrganisationId.current !== requestedOrganisationId) {
        throw new Error("Organisation changed while source receipts loaded");
      }
      return adaptOpportunitySourceSnapshot(response, requestedOrganisationId);
    },
  });

  const mutate = useMutation({
    mutationFn: async (
      request:
        | { kind: "record"; body: ManualOpportunitySourceDraft }
        | {
            kind: "decide";
            candidate: OpportunitySourceCandidate;
            decision: "accept" | "reject";
            reason: string;
          },
    ) => {
      const requestedOrganisationId = organisationId;
      const release = access?.beginCriticalWorkflow();
      try {
        const url =
          request.kind === "record"
            ? "/api/opportunity-sources/manual"
            : `/api/opportunity-sources/${request.candidate.id}/decision`;
        const body =
          request.kind === "record"
            ? request.body
            : {
                expectedVersion: request.candidate.version,
                decision: request.decision,
                reason: request.reason,
              };
        const response = await customFetch<unknown>(url, {
          method: "POST",
          body: JSON.stringify(body),
          responseType: "json",
          cache: "no-store",
        });
        if (currentOrganisationId.current !== requestedOrganisationId) {
          throw new Error("Organisation changed while source action completed");
        }
        adaptOpportunitySourceCandidate(response, requestedOrganisationId);
        return requestedOrganisationId;
      } finally {
        release?.();
      }
    },
    onSuccess: (updatedOrganisationId) => {
      toast({ title: "Opportunity source record updated" });
      void queryClient.invalidateQueries({
        queryKey: ["opportunity-source-network", updatedOrganisationId],
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Opportunity source record could not be updated",
        description:
          "Reload the source inbox before retrying. No opportunity was accepted, rejected, or recorded by this attempt.",
      });
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  if (!canRead)
    return (
      <PageGatePanel
        state="blocked"
        title="Direct organisation membership required"
        description="Opportunity source receipts are unavailable through partner-derived or emergency access."
      />
    );
  if (!online)
    return (
      <PageGatePanel
        state="offline"
        title="Source verification is unavailable offline"
        description="Reconnect before inspecting or deciding an external source receipt."
      />
    );
  const snapshotPending = snapshot.isLoading || snapshot.isPending;
  const snapshotUnavailable =
    snapshot.isError ||
    (!snapshotPending && (!snapshot.isSuccess || snapshot.data === undefined));
  if (snapshotPending)
    return (
      <PageGatePanel
        state="pending"
        title="Loading source receipts"
        description="Checking your organisation access, source records and review status."
      />
    );
  if (snapshotUnavailable || !snapshot.data)
    return (
      <PageGatePanel
        state="error"
        title="Source receipts could not be verified"
        description="Nothing is shown as empty or accepted while this check is unavailable."
      >
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => void snapshot.refetch()}
        >
          Retry
        </Button>
      </PageGatePanel>
    );

  return (
    <OpportunitySourceConsole
      key={organisationId}
      snapshot={snapshot.data}
      canManage={canManage}
      pending={mutate.isPending}
      onRecord={(body) =>
        mutate.mutateAsync({ kind: "record", body }).then(() => undefined)
      }
      onDecision={(candidate, decision, reason) =>
        mutate
          .mutateAsync({ kind: "decide", candidate, decision, reason })
          .then(() => undefined)
      }
    />
  );
}
