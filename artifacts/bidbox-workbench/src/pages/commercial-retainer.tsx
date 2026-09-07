import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch, useGetMe } from "@workspace/api-client-react";
import { CommercialControlCentre } from "@/components/commercial-retainer/commercial-control-centre";
import type {
  CommercialRetainerMutation,
  CommercialRetainerSnapshotView,
} from "@/components/commercial-retainer/commercial-retainer-contract";
import { PageGatePanel, PageHeader } from "@/components/platform-states";
import { Button } from "@/components/ui/button";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import { useToast } from "@/hooks/use-toast";

const QUERY_ROOT = "commercial-retainer";
const CHECKER_ROLES = new Set([
  "client_organisation_owner",
  "client_administrator",
  "valo_operations_administrator",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

export function adaptCommercialRetainerSnapshot(
  value: unknown,
  expectedOrganisationId: string,
): CommercialRetainerSnapshotView {
  if (!isRecord(value) || !isRecord(value.snapshot)) {
    throw new Error("Invalid commercial snapshot envelope");
  }
  const snapshot = value.snapshot;
  if (
    typeof snapshot.organisationId !== "string" ||
    snapshot.organisationId !== expectedOrganisationId ||
    !isRecord(snapshot.manifest) ||
    snapshot.manifest.routeMounted !== true ||
    snapshot.manifest.navigationMounted !== true ||
    snapshot.manifest.openApiPublished !== true ||
    snapshot.manifest.automaticPricingAllowed !== false ||
    snapshot.manifest.paymentProviderConnected !== false ||
    snapshot.manifest.externalMessagingConnected !== false ||
    snapshot.manifest.autonomousWorkAllowed !== false ||
    snapshot.manifest.makerCheckerRequired !== true ||
    !isRecord(snapshot.activation) ||
    snapshot.activation.providerConnected !== false ||
    !Array.isArray(snapshot.offers) ||
    !Array.isArray(snapshot.quotes) ||
    !Array.isArray(snapshot.invoices) ||
    !Array.isArray(snapshot.payments) ||
    !Array.isArray(snapshot.entitlements) ||
    !Array.isArray(snapshot.serviceRequests)
  ) {
    throw new Error("Commercial snapshot failed its safety contract");
  }
  const boundedArrays = [
    snapshot.offers,
    snapshot.quotes,
    snapshot.invoices,
    snapshot.payments,
    snapshot.entitlements,
    snapshot.serviceRequests,
  ];
  if (boundedArrays.some((items) => items.length > 50)) {
    throw new Error("Commercial record contains too many items");
  }
  return snapshot as unknown as CommercialRetainerSnapshotView;
}

export default function CommercialRetainerPage() {
  const access = useOrganisationAccess();
  const meQuery = useGetMe();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const organisation = access?.activeOrganisation;
  const organisationId = organisation?.id ?? "";
  const actorMembershipId = organisation?.membershipId ?? "";
  const roles = access?.effectiveRoles ?? [];
  const permissions = access?.effectivePermissions ?? [];
  const directMembership = Boolean(
    organisationId &&
    organisation?.accessSource === "membership" &&
    organisation.membershipOrganisationId === organisationId,
  );
  const canRead = Boolean(
    directMembership &&
    permissions.includes("billing:read") &&
    permissions.includes("entitlement:read"),
  );
  const canCreateOrder = canRead && permissions.includes("order:create");
  const canApprove = Boolean(
    canCreateOrder && roles.some((role) => CHECKER_ROLES.has(role)),
  );
  const canReconcile = Boolean(
    canCreateOrder &&
    permissions.includes("billing:read") &&
    roles.includes("valo_operations_administrator"),
  );
  const canUseRetainer = canRead && permissions.includes("order:create");
  const activeOrganisationId = useRef(organisationId);
  activeOrganisationId.current = organisationId;
  const queryKey = [QUERY_ROOT, organisationId] as const;

  const snapshotQuery = useQuery({
    queryKey,
    enabled: canRead,
    queryFn: async () => {
      const requestedOrganisationId = organisationId;
      const payload = await customFetch<unknown>(
        "/api/commercial-retainer/snapshot",
        { responseType: "json", cache: "no-store" },
      );
      if (activeOrganisationId.current !== requestedOrganisationId) {
        throw new Error("Organisation changed while commercial records loaded");
      }
      return adaptCommercialRetainerSnapshot(payload, requestedOrganisationId);
    },
  });

  const mutation = useMutation({
    mutationFn: async (command: CommercialRetainerMutation) => {
      const requestedOrganisationId = organisationId;
      const releaseCriticalWorkflow = access?.beginCriticalWorkflow();
      try {
        await customFetch<unknown>(command.path, {
          method: "POST",
          body: JSON.stringify(command.body),
          responseType: "json",
          cache: "no-store",
        });
        if (activeOrganisationId.current !== requestedOrganisationId) {
          throw new Error(
            "Organisation changed while the commercial record was saved",
          );
        }
        return requestedOrganisationId;
      } finally {
        releaseCriticalWorkflow?.();
      }
    },
    onSuccess: (recordedOrganisationId) => {
      toast({ title: "Commercial record saved" });
      void queryClient.invalidateQueries({
        queryKey: [QUERY_ROOT, recordedOrganisationId],
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Commercial record was not saved",
        description:
          "Reload this organisation's commercial record before trying again. No provider was called and no external message was sent.",
      });
    },
  });

  if (!canRead) {
    return (
      <PageGatePanel
        state="blocked"
        title="Direct commercial membership required"
        description="You need a current direct organisation membership with permission to read billing and entitlements. Partner access and emergency access are not accepted."
      />
    );
  }

  const snapshotPending = snapshotQuery.isLoading || snapshotQuery.isPending;
  const identityPending = meQuery.isLoading || meQuery.isPending;
  const snapshotUnavailable =
    snapshotQuery.isError ||
    (!snapshotPending &&
      (!snapshotQuery.isSuccess || snapshotQuery.data === undefined));
  const identityUnavailable =
    meQuery.isError ||
    (!identityPending && (!meQuery.isSuccess || !meQuery.data?.id));

  if (snapshotPending || identityPending) {
    return (
      <PageGatePanel
        state="pending"
        title="Loading commercial records"
        description="Checking approved offers, named reviewers, payment evidence and active entitlements."
      />
    );
  }

  if (
    snapshotUnavailable ||
    !snapshotQuery.data ||
    identityUnavailable ||
    !meQuery.data?.id
  ) {
    return (
      <PageGatePanel
        state="error"
        title="Commercial records could not be verified"
        description="We could not verify the commercial records. We have not treated them as empty or assumed any payment, entitlement or service capacity."
      >
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void snapshotQuery.refetch();
            void meQuery.refetch();
          }}
        >
          Retry verification
        </Button>
      </PageGatePanel>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7 p-5 sm:p-8">
      <PageHeader
        eyebrow="Commercial & retainer controls"
        title="Quotes, invoices & retainers"
        description="Review fixed offers, two-person approvals, manually verified payments, service access and retainer requests. People remain responsible for every decision."
        state={
          snapshotQuery.data.activation.fixedPriceBookReady
            ? "partial"
            : "blocked"
        }
      />
      <CommercialControlCentre
        key={organisationId}
        snapshot={snapshotQuery.data}
        actorUserId={meQuery.data.id}
        actorMembershipId={actorMembershipId}
        canCreateOrder={canCreateOrder}
        canApprove={canApprove}
        canReconcile={canReconcile}
        canUseRetainer={canUseRetainer}
        busy={mutation.isPending}
        onMutate={async (command) => {
          await mutation.mutateAsync(command);
        }}
      />
    </div>
  );
}
