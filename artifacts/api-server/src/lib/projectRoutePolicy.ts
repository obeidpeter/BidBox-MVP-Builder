export type ProjectRoutePolicyClass =
  | "released_append_only_ledger"
  | "released_addendum_command"
  | "released_export_command"
  | "retention_lifecycle";

export type ProjectRoutePolicy = Readonly<{
  id: string;
  policyClass: ProjectRoutePolicyClass;
  method: "PATCH" | "POST";
  path: RegExp;
  transactionMode: "request_transaction";
  requiresProjectLock: true;
  releasedContentEffect:
    | "append_only"
    | "governed_version_change"
    | "immutable_export"
    | "retention_only";
}>;

const policy = (
  value: Omit<ProjectRoutePolicy, "transactionMode" | "requiresProjectLock">,
): ProjectRoutePolicy =>
  Object.freeze({
    ...value,
    transactionMode: "request_transaction",
    requiresProjectLock: true,
  });

/**
 * Exact project mutation exceptions consumed by the tenant boundary.
 *
 * This catalogue is deliberately closed and anchored. Adding an entry changes
 * the released-project immutability contract and therefore requires an ADR,
 * architecture-driver mapping, an OpenAPI operation, and negative near-match
 * tests. Prefix or caller-controlled bypasses are prohibited.
 */
export const PROJECT_ROUTE_POLICIES: readonly ProjectRoutePolicy[] =
  Object.freeze([
    policy({
      id: "claims-desk-record-create",
      policyClass: "released_append_only_ledger",
      method: "POST",
      path: /^\/projects\/[^/]+\/claims-desk\/records$/u,
      releasedContentEffect: "append_only",
    }),
    policy({
      id: "claims-desk-transition-create",
      policyClass: "released_append_only_ledger",
      method: "POST",
      path: /^\/projects\/[^/]+\/claims-desk\/records\/[^/]+\/transitions$/u,
      releasedContentEffect: "append_only",
    }),
    policy({
      id: "operations-submission-war-room-create",
      policyClass: "released_append_only_ledger",
      method: "POST",
      path: /^\/projects\/[^/]+\/operations-suite\/submission-war-rooms$/u,
      releasedContentEffect: "append_only",
    }),
    policy({
      id: "operations-submission-war-room-advance",
      policyClass: "released_append_only_ledger",
      method: "POST",
      path: /^\/projects\/[^/]+\/operations-suite\/submission-war-rooms\/[^/]+\/advance$/u,
      releasedContentEffect: "append_only",
    }),
    policy({
      id: "operations-visual-qa-report-create",
      policyClass: "released_append_only_ledger",
      method: "POST",
      path: /^\/projects\/[^/]+\/operations-suite\/visual-qa-reports$/u,
      releasedContentEffect: "append_only",
    }),
    policy({
      id: "operations-post-award-item-create",
      policyClass: "released_append_only_ledger",
      method: "POST",
      path: /^\/projects\/[^/]+\/operations-suite\/post-award-items$/u,
      releasedContentEffect: "append_only",
    }),
    policy({
      id: "operations-post-award-item-update",
      policyClass: "released_append_only_ledger",
      method: "PATCH",
      path: /^\/projects\/[^/]+\/operations-suite\/post-award-items\/[^/]+$/u,
      releasedContentEffect: "append_only",
    }),
    policy({
      id: "client-package-delivery-create",
      policyClass: "released_append_only_ledger",
      method: "POST",
      path: /^\/projects\/[^/]+\/client-actions\/package-deliveries$/u,
      releasedContentEffect: "append_only",
    }),
    policy({
      id: "client-package-delivery-acknowledge",
      policyClass: "released_append_only_ledger",
      method: "POST",
      path: /^\/projects\/[^/]+\/client-actions\/package-deliveries\/[^/]+\/acknowledgements$/u,
      releasedContentEffect: "append_only",
    }),
    policy({
      id: "communication-intent-create",
      policyClass: "released_append_only_ledger",
      method: "POST",
      path: /^\/projects\/[^/]+\/communications\/intents$/u,
      releasedContentEffect: "append_only",
    }),
    policy({
      id: "communication-attempt-create",
      policyClass: "released_append_only_ledger",
      method: "POST",
      path: /^\/projects\/[^/]+\/communications\/intents\/[^/]+\/attempts$/u,
      releasedContentEffect: "append_only",
    }),
    policy({
      id: "communication-reconciliation-create",
      policyClass: "released_append_only_ledger",
      method: "POST",
      path: /^\/projects\/[^/]+\/communications\/intents\/[^/]+\/reconciliations$/u,
      releasedContentEffect: "append_only",
    }),
    policy({
      id: "addendum-impact-review",
      policyClass: "released_addendum_command",
      method: "POST",
      path: /^\/projects\/[^/]+\/addendum-impact\/review$/u,
      releasedContentEffect: "governed_version_change",
    }),
    policy({
      id: "addendum-impact-apply",
      policyClass: "released_addendum_command",
      method: "POST",
      path: /^\/projects\/[^/]+\/addendum-impact\/apply$/u,
      releasedContentEffect: "governed_version_change",
    }),
    policy({
      id: "project-package-export",
      policyClass: "released_export_command",
      method: "POST",
      path: /^\/projects\/[^/]+\/export$/u,
      releasedContentEffect: "immutable_export",
    }),
    policy({
      id: "project-retention-request-create",
      policyClass: "retention_lifecycle",
      method: "POST",
      path: /^\/projects\/[^/]+\/retention-requests$/u,
      releasedContentEffect: "retention_only",
    }),
    policy({
      id: "retention-request-complete",
      policyClass: "retention_lifecycle",
      method: "POST",
      path: /^\/retention-requests\/[^/]+\/complete$/u,
      releasedContentEffect: "retention_only",
    }),
    policy({
      id: "retention-action-reconcile",
      policyClass: "retention_lifecycle",
      method: "POST",
      path: /^\/retention-actions\/[^/]+\/reconcile$/u,
      releasedContentEffect: "retention_only",
    }),
    policy({
      id: "retention-action-certify",
      policyClass: "retention_lifecycle",
      method: "POST",
      path: /^\/retention-actions\/[^/]+\/certify$/u,
      releasedContentEffect: "retention_only",
    }),
  ]);

export function findProjectRoutePolicy(
  method: string,
  path: string,
): ProjectRoutePolicy | undefined {
  const normalizedMethod = method.toUpperCase();
  return PROJECT_ROUTE_POLICIES.find(
    (entry) => entry.method === normalizedMethod && entry.path.test(path),
  );
}

export function matchesProjectRoutePolicyClass(
  method: string,
  path: string,
  policyClass: ProjectRoutePolicyClass,
): boolean {
  return findProjectRoutePolicy(method, path)?.policyClass === policyClass;
}

export function canUseReleasedProjectRoutePolicy(
  projectStatus: string,
  method: string,
  path: string,
  policyClass: Exclude<ProjectRoutePolicyClass, "retention_lifecycle">,
): boolean {
  return (
    (projectStatus === "signed_off" || projectStatus === "exported") &&
    matchesProjectRoutePolicyClass(method, path, policyClass)
  );
}
