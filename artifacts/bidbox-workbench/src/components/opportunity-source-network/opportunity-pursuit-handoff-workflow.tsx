import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { StatusPanel } from "@/components/platform-states";
import { Button } from "@/components/ui/button";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import { useToast } from "@/hooks/use-toast";
import { assertAuthorityScopeCurrent } from "@/lib/authority-scope";
import {
  OPPORTUNITY_PURSUIT_HANDOFF_AUTHORITY,
  adaptOpportunityPursuitHandoffPreparation,
  adaptOpportunityPursuitHandoffResult,
  type OpportunityPursuitHandoffConfirmation,
} from "./opportunity-pursuit-handoff-contract";
import { OpportunityPursuitHandoffPanel } from "./opportunity-pursuit-handoff-panel";

export interface OpportunityPursuitHandoffWorkflowProps {
  organisationId: string;
  candidateId: string;
}

function randomIdempotencyKey(candidateId: string): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const nonce = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  return `handoff:${candidateId}:${nonce}`;
}

export function OpportunityPursuitHandoffWorkflow({
  organisationId,
  candidateId,
}: OpportunityPursuitHandoffWorkflowProps) {
  const [opened, setOpened] = useState(false);
  const access = useOrganisationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const activeMembershipId = access?.activeOrganisation?.membershipId ?? "";
  const capabilityFingerprint = [...(access?.effectivePermissions ?? [])]
    .sort()
    .join("|");
  const authorityScope = {
    organisationId,
    membershipId: activeMembershipId,
    capabilityFingerprint,
  };
  const currentAuthorityScope = useRef(authorityScope);
  currentAuthorityScope.current = authorityScope;
  const idempotency = useRef<{ digest: string; key: string } | null>(null);
  const queryKey = [
    "opportunity-pursuit-handoff",
    organisationId,
    candidateId,
    activeMembershipId,
    capabilityFingerprint,
  ] as const;

  const preparation = useQuery({
    queryKey,
    enabled:
      opened &&
      Boolean(activeMembershipId) &&
      access?.activeOrganisation?.id === organisationId &&
      access.effectivePermissions.includes("project:create"),
    queryFn: async () => {
      const requestedScope = { ...currentAuthorityScope.current };
      const response = await customFetch<unknown>(
        `/api/opportunity-sources/${candidateId}/pursuit-handoff`,
        { responseType: "json", cache: "no-store" },
      );
      assertAuthorityScopeCurrent(
        currentAuthorityScope.current,
        requestedScope,
        "Authority changed while handoff loaded",
      );
      return adaptOpportunityPursuitHandoffPreparation(
        response,
        requestedScope.organisationId,
        candidateId,
      );
    },
  });

  const confirm = useMutation({
    mutationFn: async (confirmation: OpportunityPursuitHandoffConfirmation) => {
      const requestedScope = { ...currentAuthorityScope.current };
      const requestDigest = JSON.stringify(confirmation);
      if (idempotency.current?.digest !== requestDigest) {
        idempotency.current = {
          digest: requestDigest,
          key: randomIdempotencyKey(candidateId),
        };
      }
      const release = access?.beginCriticalWorkflow();
      try {
        const response = await customFetch<unknown>(
          `/api/opportunity-sources/${candidateId}/pursuit-handoff/confirm`,
          {
            method: "POST",
            headers: { "Idempotency-Key": idempotency.current.key },
            body: JSON.stringify(confirmation),
            responseType: "json",
            cache: "no-store",
          },
        );
        assertAuthorityScopeCurrent(
          currentAuthorityScope.current,
          requestedScope,
          "Authority changed while handoff completed",
        );
        return adaptOpportunityPursuitHandoffResult(
          response,
          requestedScope.organisationId,
          candidateId,
        );
      } finally {
        release?.();
      }
    },
    onSuccess: (result) => {
      idempotency.current = null;
      queryClient.setQueryData(queryKey, {
        state: "completed",
        receipt: result.receipt,
        authority: OPPORTUNITY_PURSUIT_HANDOFF_AUTHORITY,
      });
      toast({ title: "Intake pursuit created" });
      void queryClient.invalidateQueries({
        queryKey: ["projects", organisationId],
      });
    },
  });

  if (!opened) {
    return (
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        onClick={() => setOpened(true)}
      >
        Prepare pursuit handoff
      </Button>
    );
  }
  if (preparation.isLoading) {
    return (
      <StatusPanel
        state="pending"
        title="Preparing the handoff"
        description="Checking the accepted source, your current permissions, reviewer options and any conflicts."
      />
    );
  }
  if (preparation.isError || !preparation.data) {
    return (
      <StatusPanel
        state="error"
        title="Pursuit handoff could not be prepared"
        description="No pursuit was created. Reload the source, permissions and conflict check before trying again."
      >
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => void preparation.refetch()}
        >
          Retry preparation
        </Button>
      </StatusPanel>
    );
  }
  return (
    <div className="space-y-4">
      {confirm.isError ? (
        <StatusPanel
          state="error"
          title="Pursuit handoff was not recorded"
          description="No pursuit was created. Reload the accepted source, permissions and conflict check, then review the confirmation before retrying."
        />
      ) : null}
      <OpportunityPursuitHandoffPanel
        preparation={preparation.data}
        pending={confirm.isPending}
        onConfirm={async (_confirmedCandidateId, confirmation) => {
          await confirm.mutateAsync(confirmation);
        }}
      />
    </div>
  );
}

export default OpportunityPursuitHandoffWorkflow;
