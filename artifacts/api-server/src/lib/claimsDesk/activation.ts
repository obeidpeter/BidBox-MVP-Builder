import { CLAIMS_DESK_NAMESPACE } from "./contracts";
import { PROJECT_ROUTE_POLICIES } from "../projectRoutePolicy";

/**
 * Exact append-only mutation exceptions that the shared project immutability
 * guard must opt into before signed-off/exported Claims Desk writes are live.
 * Archived projects are deliberately absent and remain terminal.
 */
export const CLAIMS_DESK_RELEASED_LEDGER_ROUTE_EXCEPTIONS = Object.freeze(
  PROJECT_ROUTE_POLICIES.filter(
    ({ id }) =>
      id === "claims-desk-record-create" ||
      id === "claims-desk-transition-create",
  ).map(({ method, path }) => ({ method, path })),
);

export function isClaimsDeskReleasedLedgerMutation(
  projectStatus: string,
  method: string,
  path: string,
): boolean {
  if (projectStatus !== "signed_off" && projectStatus !== "exported") {
    return false;
  }
  return CLAIMS_DESK_RELEASED_LEDGER_ROUTE_EXCEPTIONS.some(
    (route) => route.method === method.toUpperCase() && route.path.test(path),
  );
}

/** Exact selector required in the project-retention deletion transaction. */
export const CLAIMS_DESK_RETENTION_WORK_TASK_LIKE =
  `${CLAIMS_DESK_NAMESPACE}%` as const;

export const CLAIMS_DESK_ACTIVATION_GATES = Object.freeze({
  routeFactoryExport: "createClaimsDeskRouter",
  apiMountAfterTenantBoundary: true,
  workbenchRouteMount: true,
  navigationMounted: true,
  signedOffExportedExceptionIntegrated: true,
  retentionSelectorIntegrated: true,
});
