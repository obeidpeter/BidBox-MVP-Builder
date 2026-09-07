import { useState, type FormEvent } from "react";
import { StateBadge } from "@/components/platform-states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  CommercialRetainerMutation,
  CommercialRetainerSnapshotView,
  RetainerServiceRequestView,
} from "./commercial-retainer-contract";
import { FormField, randomDigest } from "./commercial-form-field";

export function RetainerRequestForm({
  snapshot,
  actorMembershipId,
  busy,
  onMutate,
}: {
  snapshot: CommercialRetainerSnapshotView;
  actorMembershipId: string;
  busy: boolean;
  onMutate: (mutation: CommercialRetainerMutation) => Promise<void>;
}) {
  const [digest, setDigest] = useState(randomDigest);
  const active = snapshot.entitlements.filter(
    (item) =>
      item.productKind === "evidence_readiness_retainer" &&
      item.status === "active" &&
      item.usageConsumed < item.usageLimit,
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await onMutate({
        path: "/api/commercial-retainer/retainer/requests",
        body: {
          projectId: data.get("projectId"),
          entitlementId: data.get("entitlementId"),
          purpose: data.get("purpose"),
          summary: data.get("summary"),
          ownerMembershipId: data.get("ownerMembershipId"),
          sla: data.get("sla"),
          idempotencyDigest: digest,
        },
      });
    } catch {
      return;
    }
    setDigest(randomDigest());
    form.reset();
  }
  return (
    <form
      className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2"
      onSubmit={submit}
    >
      <FormField id="retainer-entitlement" label="Active retainer access">
        <select
          id="retainer-entitlement"
          name="entitlementId"
          required
          disabled={busy || active.length === 0}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Select service access</option>
          {active.map((item) => (
            <option key={item.id} value={item.id}>
              {item.id} ({item.usageConsumed}/{item.usageLimit} used)
            </option>
          ))}
        </select>
      </FormField>
      <FormField id="retainer-project" label="Project ID">
        <Input id="retainer-project" name="projectId" required />
      </FormField>
      <FormField id="retainer-purpose" label="Purpose">
        <select
          id="retainer-purpose"
          name="purpose"
          required
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="evidence_review">Evidence review</option>
          <option value="renewal_readiness">Renewal readiness</option>
          <option value="bid_evidence_pack">Bid evidence pack</option>
        </select>
      </FormField>
      <FormField id="retainer-sla" label="Service level">
        <select
          id="retainer-sla"
          name="sla"
          required
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="standard">Standard — 120 hours</option>
          <option value="priority">Priority — 48 hours</option>
        </select>
      </FormField>
      <FormField id="retainer-owner" label="Request owner">
        <Input
          id="retainer-owner"
          name="ownerMembershipId"
          required
          defaultValue={actorMembershipId}
        />
      </FormField>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="retainer-summary">Request summary</Label>
        <Textarea
          id="retainer-summary"
          name="summary"
          required
          maxLength={1000}
        />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy || active.length === 0}>
          Create service request
        </Button>
      </div>
    </form>
  );
}

export function RetainerRequestCard({
  request,
  busy,
  onMutate,
}: {
  request: RetainerServiceRequestView;
  busy: boolean;
  onMutate: (mutation: CommercialRetainerMutation) => Promise<void>;
}) {
  const terminal =
    request.status === "completed" || request.status === "cancelled";
  async function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await onMutate({
        path: `/api/commercial-retainer/retainer/requests/${request.id}/actions`,
        body: {
          action: "comment",
          expectedVersion: request.version,
          body: data.get("comment"),
        },
      });
    } catch {
      return;
    }
  }
  async function addEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await onMutate({
        path: `/api/commercial-retainer/retainer/requests/${request.id}/actions`,
        body: {
          action: "record_evidence",
          expectedVersion: request.version,
          reference: data.get("evidenceReference"),
          sha256: data.get("evidenceSha256"),
        },
      });
    } catch {
      return;
    }
  }
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{request.summary}</CardTitle>
          <StateBadge
            state={
              terminal
                ? request.status === "completed"
                  ? "active"
                  : "blocked"
                : "pending"
            }
            label={request.status.replaceAll("_", " ")}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="grid gap-2 sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Purpose</dt>
            <dd>{request.purpose.replaceAll("_", " ")}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Due</dt>
            <dd>{new Date(request.dueAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Owner</dt>
            <dd className="break-all font-mono text-xs">
              {request.ownerMembershipId}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Evidence receipts</dt>
            <dd>{request.evidenceReceipts.length}</dd>
          </div>
        </dl>
        {!terminal ? (
          <>
            <form className="flex gap-2" onSubmit={addComment}>
              <Label className="sr-only" htmlFor={`comment-${request.id}`}>
                Add internal comment
              </Label>
              <Input
                id={`comment-${request.id}`}
                name="comment"
                required
                maxLength={1000}
                placeholder="Internal comment"
              />
              <Button type="submit" variant="outline" disabled={busy}>
                Add
              </Button>
            </form>
            <form
              className="grid gap-2 rounded-md border p-3 sm:grid-cols-2"
              onSubmit={addEvidence}
            >
              <FormField
                id={`evidence-reference-${request.id}`}
                label="Evidence reference"
              >
                <Input
                  id={`evidence-reference-${request.id}`}
                  name="evidenceReference"
                  required
                />
              </FormField>
              <FormField
                id={`evidence-sha-${request.id}`}
                label="Evidence SHA-256"
              >
                <Input
                  id={`evidence-sha-${request.id}`}
                  name="evidenceSha256"
                  required
                  pattern="[a-f0-9]{64}"
                />
              </FormField>
              <div className="sm:col-span-2">
                <Button type="submit" variant="outline" disabled={busy}>
                  Record evidence receipt
                </Button>
              </div>
            </form>
            <div
              className="flex flex-wrap gap-2"
              aria-label="Request status actions"
            >
              {(
                [
                  "in_progress",
                  "awaiting_evidence",
                  "completed",
                  "cancelled",
                ] as const
              ).map((status) => (
                <Button
                  key={status}
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={
                    busy ||
                    (status === "completed" &&
                      request.evidenceReceipts.length === 0)
                  }
                  onClick={() => {
                    void onMutate({
                      path: `/api/commercial-retainer/retainer/requests/${request.id}/actions`,
                      body: {
                        action: "set_status",
                        expectedVersion: request.version,
                        status,
                      },
                    }).catch(() => undefined);
                  }}
                >
                  {status.replaceAll("_", " ")}
                </Button>
              ))}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
