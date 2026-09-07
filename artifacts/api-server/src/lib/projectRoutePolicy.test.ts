import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PROJECT_ROUTE_POLICIES,
  canUseReleasedProjectRoutePolicy,
  findProjectRoutePolicy,
  matchesProjectRoutePolicyClass,
} from "./projectRoutePolicy";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "22222222-2222-4222-8222-222222222222";

const examples = [
  [
    "claims-desk-record-create",
    "POST",
    `/projects/${PROJECT_ID}/claims-desk/records`,
  ],
  [
    "claims-desk-transition-create",
    "POST",
    `/projects/${PROJECT_ID}/claims-desk/records/${ITEM_ID}/transitions`,
  ],
  [
    "operations-submission-war-room-create",
    "POST",
    `/projects/${PROJECT_ID}/operations-suite/submission-war-rooms`,
  ],
  [
    "operations-submission-war-room-advance",
    "POST",
    `/projects/${PROJECT_ID}/operations-suite/submission-war-rooms/${ITEM_ID}/advance`,
  ],
  [
    "operations-visual-qa-report-create",
    "POST",
    `/projects/${PROJECT_ID}/operations-suite/visual-qa-reports`,
  ],
  [
    "operations-post-award-item-create",
    "POST",
    `/projects/${PROJECT_ID}/operations-suite/post-award-items`,
  ],
  [
    "operations-post-award-item-update",
    "PATCH",
    `/projects/${PROJECT_ID}/operations-suite/post-award-items/${ITEM_ID}`,
  ],
  [
    "client-package-delivery-create",
    "POST",
    `/projects/${PROJECT_ID}/client-actions/package-deliveries`,
  ],
  [
    "client-package-delivery-acknowledge",
    "POST",
    `/projects/${PROJECT_ID}/client-actions/package-deliveries/${ITEM_ID}/acknowledgements`,
  ],
  [
    "communication-intent-create",
    "POST",
    `/projects/${PROJECT_ID}/communications/intents`,
  ],
  [
    "communication-attempt-create",
    "POST",
    `/projects/${PROJECT_ID}/communications/intents/${ITEM_ID}/attempts`,
  ],
  [
    "communication-reconciliation-create",
    "POST",
    `/projects/${PROJECT_ID}/communications/intents/${ITEM_ID}/reconciliations`,
  ],
  [
    "addendum-impact-review",
    "POST",
    `/projects/${PROJECT_ID}/addendum-impact/review`,
  ],
  [
    "addendum-impact-apply",
    "POST",
    `/projects/${PROJECT_ID}/addendum-impact/apply`,
  ],
  ["project-package-export", "POST", `/projects/${PROJECT_ID}/export`],
  [
    "project-retention-request-create",
    "POST",
    `/projects/${PROJECT_ID}/retention-requests`,
  ],
  [
    "retention-request-complete",
    "POST",
    `/retention-requests/${ITEM_ID}/complete`,
  ],
  [
    "retention-action-reconcile",
    "POST",
    `/retention-actions/${ITEM_ID}/reconcile`,
  ],
  ["retention-action-certify", "POST", `/retention-actions/${ITEM_ID}/certify`],
] as const;

test("the project route-policy catalogue has unique, exact runtime entries", () => {
  assert.equal(PROJECT_ROUTE_POLICIES.length, examples.length);
  assert.equal(
    new Set(PROJECT_ROUTE_POLICIES.map(({ id }) => id)).size,
    PROJECT_ROUTE_POLICIES.length,
  );

  for (const [id, method, path] of examples) {
    const matched = findProjectRoutePolicy(method, path);
    assert.equal(matched?.id, id, `${method} ${path}`);
    assert.equal(matched?.requiresProjectLock, true);
    assert.equal(matched?.transactionMode, "request_transaction");
    assert.equal(
      findProjectRoutePolicy("GET", path),
      undefined,
      `${id} must reject the wrong method`,
    );
    assert.equal(
      findProjectRoutePolicy(method, `${path}/extra`),
      undefined,
      `${id} must reject a nested near-match`,
    );
  }
});

test("released exceptions remain status- and policy-class-bound", () => {
  const exportPath = `/projects/${PROJECT_ID}/export`;
  assert.equal(
    canUseReleasedProjectRoutePolicy(
      "signed_off",
      "POST",
      exportPath,
      "released_export_command",
    ),
    true,
  );
  assert.equal(
    canUseReleasedProjectRoutePolicy(
      "reporting",
      "POST",
      exportPath,
      "released_export_command",
    ),
    false,
  );
  assert.equal(
    canUseReleasedProjectRoutePolicy(
      "exported",
      "POST",
      exportPath,
      "released_addendum_command",
    ),
    false,
  );
});

test("retention lifecycle is explicit and cannot be mistaken for a released-content exception", () => {
  const retentionPath = `/retention-actions/${ITEM_ID}/certify`;
  assert.equal(
    matchesProjectRoutePolicyClass(
      "POST",
      retentionPath,
      "retention_lifecycle",
    ),
    true,
  );
  assert.equal(
    matchesProjectRoutePolicyClass(
      "POST",
      retentionPath,
      "released_append_only_ledger",
    ),
    false,
  );
});
