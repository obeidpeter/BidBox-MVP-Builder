import { useState } from "react";
import { AlertTriangle, CheckCircle2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StateBadge, StatusPanel } from "@/components/platform-states";
import type {
  ClientActionAuthorityOption,
  ClientActionPurpose,
  ClientActionSnapshot,
  ClientEvidenceRequest,
} from "./client-action-contract";
import {
  ClientActionUploadControl,
  type ClientActionUploadControlProps,
} from "./client-action-upload-control";

export interface ClientActionMutation {
  path: string;
  body: Record<string, unknown>;
}

export interface ClientActionWorkspaceProps {
  snapshot: ClientActionSnapshot;
  currentUserId: string;
  membershipId?: string;
  canReview: boolean;
  canCreateEvidenceRequest?: boolean;
  authorityOptions?: readonly ClientActionAuthorityOption[];
  authorityState?: "loading" | "error" | "ready";
  pending?: boolean;
  onMutate?: (mutation: ClientActionMutation) => void;
  canUpload?: boolean;
  onUpload?: ClientActionUploadControlProps["onUpload"];
  onReload?: ClientActionUploadControlProps["onReload"];
}

function latest(request: ClientEvidenceRequest, slotId: string) {
  const slot = request.slots.find(({ id }) => id === slotId);
  return slot?.attempts.at(-1) ?? null;
}

function statusState(status: ClientEvidenceRequest["status"]) {
  if (status === "completed") return "active" as const;
  if (status === "changes_required") return "blocked" as const;
  if (status === "open") return "partial" as const;
  return "pending" as const;
}

const PURPOSE_LABELS: Readonly<Record<ClientActionPurpose, string>> = {
  tender_evidence: "Tender evidence",
  credential_refresh: "Credential refresh",
  clarification_support: "Clarification support",
  delivery_evidence: "Delivery evidence",
};

function EvidenceRequestCreator(props: {
  authorities: readonly ClientActionAuthorityOption[];
  authorityState: "loading" | "error" | "ready";
  pending: boolean;
  onMutate?: (mutation: ClientActionMutation) => void;
}) {
  const [recipientUserId, setRecipientUserId] = useState("");
  const [purpose, setPurpose] =
    useState<ClientActionPurpose>("tender_evidence");
  const [purposeStatement, setPurposeStatement] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [slotLabel, setSlotLabel] = useState("");
  const [contentTypes, setContentTypes] = useState("application/pdf");
  const acceptedContentTypes = [
    ...new Set(
      contentTypes
        .split(",")
        .map((value) => value.trim().toLocaleLowerCase("en-US"))
        .filter(Boolean),
    ),
  ];
  const contentTypesWithinBound = acceptedContentTypes.length <= 8;

  if (props.authorityState === "loading") {
    return (
      <StatusPanel
        state="pending"
        title="Loading named recipients"
        description="Waiting for the current pursuit member list. No recipient is selected until it loads."
      />
    );
  }
  if (props.authorityState === "error") {
    return (
      <StatusPanel
        state="error"
        title="Named recipients are unavailable"
        description="Request creation is off until the member list and permissions can be checked."
      />
    );
  }
  if (props.authorities.length === 0) {
    return (
      <StatusPanel
        state="empty"
        title="No eligible named recipient"
        description="No other active member with permission to receive documents is available for this organisation."
      />
    );
  }

  return (
    <form
      className="grid gap-4 rounded-xl border bg-card p-5"
      aria-labelledby="create-evidence-request-heading"
      onSubmit={(event) => {
        event.preventDefault();
        if (!contentTypesWithinBound) return;
        props.onMutate?.({
          path: "evidence-requests",
          body: {
            purpose,
            purposeStatement: purposeStatement.trim(),
            recipientUserId,
            dueAt: dueAt ? new Date(dueAt).toISOString() : null,
            slots: [
              {
                label: slotLabel.trim(),
                required: true,
                acceptedContentTypes,
              },
            ],
          },
        });
      }}
    >
      <div>
        <h2 id="create-evidence-request-heading" className="font-semibold">
          Create an evidence request
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This records an in-product request only. It does not email, message,
          upload, or transfer anything.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium">
          Named recipient
          <select
            required
            className="min-h-11 rounded-md border border-input bg-background px-3 py-2"
            value={recipientUserId}
            disabled={props.pending}
            onChange={(event) => setRecipientUserId(event.currentTarget.value)}
          >
            <option value="">Select a current direct member</option>
            {props.authorities.map((authority) => (
              <option key={authority.userId} value={authority.userId}>
                {authority.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Purpose
          <select
            className="min-h-11 rounded-md border border-input bg-background px-3 py-2"
            value={purpose}
            disabled={props.pending}
            onChange={(event) =>
              setPurpose(event.currentTarget.value as ClientActionPurpose)
            }
          >
            {Object.entries(PURPOSE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="md:col-span-2">
          <Label htmlFor="client-action-purpose-statement">
            Purpose statement
          </Label>
          <Textarea
            id="client-action-purpose-statement"
            required
            maxLength={1000}
            value={purposeStatement}
            disabled={props.pending}
            onChange={(event) => setPurposeStatement(event.currentTarget.value)}
          />
        </div>
        <div>
          <Label htmlFor="client-action-slot-label">Required evidence</Label>
          <Input
            id="client-action-slot-label"
            required
            maxLength={160}
            value={slotLabel}
            disabled={props.pending}
            onChange={(event) => setSlotLabel(event.currentTarget.value)}
          />
        </div>
        <div>
          <Label htmlFor="client-action-due-at">Due date (optional)</Label>
          <Input
            id="client-action-due-at"
            type="datetime-local"
            value={dueAt}
            disabled={props.pending}
            onChange={(event) => setDueAt(event.currentTarget.value)}
          />
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="client-action-content-types">
            Accepted content types (comma separated, maximum 8)
          </Label>
          <Input
            id="client-action-content-types"
            maxLength={1000}
            value={contentTypes}
            disabled={props.pending}
            onChange={(event) => setContentTypes(event.currentTarget.value)}
          />
          {!contentTypesWithinBound ? (
            <p className="mt-1 text-xs text-destructive" role="status">
              Use no more than eight distinct content types.
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={
            props.pending ||
            !recipientUserId ||
            !purposeStatement.trim() ||
            !slotLabel.trim() ||
            !contentTypesWithinBound
          }
        >
          Record evidence request
        </Button>
      </div>
    </form>
  );
}

export function ClientActionWorkspace({
  snapshot,
  currentUserId,
  membershipId = "",
  canReview,
  canCreateEvidenceRequest = false,
  authorityOptions = [],
  authorityState = "ready",
  pending = false,
  onMutate,
  canUpload = false,
  onUpload,
  onReload,
}: ClientActionWorkspaceProps) {
  const [intents, setIntents] = useState<
    Record<
      string,
      {
        filename: string;
        contentType: string;
        sizeBytes: string;
        sha256: string;
      }
    >
  >({});
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>(
    {},
  );
  const requests = snapshot.records.filter(
    (record): record is ClientEvidenceRequest =>
      record.kind === "evidence_request",
  );
  const deliveries = snapshot.records.filter(
    (record) => record.kind === "package_delivery",
  );

  return (
    <div className="space-y-8">
      <StatusPanel
        state="partial"
        title="Controlled actions only"
        description="This workspace records acknowledgements and planned uploads. The named recipient can upload directly to approved storage after acknowledging an active request. Valo does not receive the file itself or send messages or packages."
      />

      {canCreateEvidenceRequest ? (
        <EvidenceRequestCreator
          authorities={authorityOptions}
          authorityState={authorityState}
          pending={pending}
          onMutate={onMutate}
        />
      ) : null}

      <section aria-labelledby="client-evidence-actions" className="space-y-4">
        <div>
          <h2 id="client-evidence-actions" className="text-xl font-semibold">
            Evidence requests
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every request is bound to this pursuit, one named recipient and a
            closed purpose.
          </p>
        </div>
        {requests.length === 0 ? (
          <StatusPanel
            state="empty"
            title="No client evidence actions"
            description="No visible request is recorded for this pursuit and user."
          />
        ) : (
          requests.map((request) => {
            const isRecipient = request.recipientUserId === currentUserId;
            return (
              <article
                key={request.id}
                className="space-y-5 rounded-xl border bg-card p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {request.purpose.replaceAll("_", " ")}
                    </p>
                    <h3 className="mt-1 font-semibold">
                      {request.purposeStatement}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Due{" "}
                      {request.dueAt
                        ? new Date(request.dueAt).toLocaleString("en-NG")
                        : "not recorded"}{" "}
                      · version {request.version}
                    </p>
                  </div>
                  <StateBadge
                    state={statusState(request.status)}
                    label={request.status.replaceAll("_", " ")}
                  />
                </div>

                {isRecipient && request.status === "open" ? (
                  <Button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      onMutate?.({
                        path: `evidence-requests/${request.id}/acknowledgements`,
                        body: {
                          expectedVersion: request.version,
                          statement:
                            "I acknowledge this purpose-bound evidence request.",
                        },
                      })
                    }
                  >
                    Acknowledge request
                  </Button>
                ) : null}

                <div className="space-y-4">
                  {request.slots.map((slot) => {
                    const attempt = latest(request, slot.id);
                    const intent = intents[slot.id] ?? {
                      filename: "",
                      contentType: "application/pdf",
                      sizeBytes: "",
                      sha256: "",
                    };
                    const reviewReason = reviewReasons[slot.id] ?? "";
                    const canStartIntent =
                      isRecipient &&
                      Boolean(request.requestAcknowledgement) &&
                      request.status !== "completed" &&
                      (!attempt ||
                        (attempt.review?.decision === "correction_required" &&
                          attempt.correctionAcknowledgement));
                    return (
                      <div
                        key={slot.id}
                        className="space-y-4 rounded-lg border bg-background p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h4 className="font-medium">{slot.label}</h4>
                            <p className="text-xs text-muted-foreground">
                              {slot.required ? "Required" : "Optional"} ·{" "}
                              {slot.acceptedContentTypes.join(", ") ||
                                "Any approved intake type"}
                            </p>
                          </div>
                          {attempt?.review ? (
                            <StateBadge
                              state={
                                attempt.review.decision === "accepted"
                                  ? "active"
                                  : "blocked"
                              }
                              label={attempt.review.decision.replaceAll(
                                "_",
                                " ",
                              )}
                            />
                          ) : null}
                        </div>

                        {attempt?.review?.decision === "correction_required" ? (
                          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                            <p className="flex items-center gap-2 font-medium">
                              <AlertTriangle className="h-4 w-4" />
                              Correction requested
                            </p>
                            <p className="mt-1 text-muted-foreground">
                              {attempt.review.reason}
                            </p>
                            {isRecipient &&
                            !attempt.correctionAcknowledgement ? (
                              <Button
                                type="button"
                                variant="outline"
                                className="mt-3"
                                disabled={pending}
                                onClick={() =>
                                  onMutate?.({
                                    path: `evidence-requests/${request.id}/slots/${slot.id}/correction-acknowledgements`,
                                    body: {
                                      expectedVersion: request.version,
                                      statement:
                                        "I acknowledge the requested correction and will provide a replacement.",
                                    },
                                  })
                                }
                              >
                                Acknowledge correction
                              </Button>
                            ) : null}
                          </div>
                        ) : null}

                        {canStartIntent ? (
                          <form
                            className="grid gap-3 md:grid-cols-2"
                            onSubmit={(event) => {
                              event.preventDefault();
                              onMutate?.({
                                path: `evidence-requests/${request.id}/slots/${slot.id}/upload-intents`,
                                body: {
                                  expectedVersion: request.version,
                                  filename: intent.filename,
                                  contentType: intent.contentType,
                                  sizeBytes: Number(intent.sizeBytes),
                                  declaredSha256: intent.sha256,
                                },
                              });
                            }}
                          >
                            <div>
                              <Label htmlFor={`${slot.id}-filename`}>
                                Filename
                              </Label>
                              <Input
                                id={`${slot.id}-filename`}
                                value={intent.filename}
                                maxLength={255}
                                required
                                onChange={(event) =>
                                  setIntents((values) => ({
                                    ...values,
                                    [slot.id]: {
                                      ...intent,
                                      filename: event.target.value,
                                    },
                                  }))
                                }
                              />
                            </div>
                            <div>
                              <Label htmlFor={`${slot.id}-type`}>
                                Content type
                              </Label>
                              <Input
                                id={`${slot.id}-type`}
                                value={intent.contentType}
                                maxLength={192}
                                required
                                onChange={(event) =>
                                  setIntents((values) => ({
                                    ...values,
                                    [slot.id]: {
                                      ...intent,
                                      contentType: event.target.value,
                                    },
                                  }))
                                }
                              />
                            </div>
                            <div>
                              <Label htmlFor={`${slot.id}-size`}>
                                Size in bytes
                              </Label>
                              <Input
                                id={`${slot.id}-size`}
                                type="number"
                                min="1"
                                max="52428800"
                                value={intent.sizeBytes}
                                required
                                onChange={(event) =>
                                  setIntents((values) => ({
                                    ...values,
                                    [slot.id]: {
                                      ...intent,
                                      sizeBytes: event.target.value,
                                    },
                                  }))
                                }
                              />
                            </div>
                            <div>
                              <Label htmlFor={`${slot.id}-digest`}>
                                Client SHA-256
                              </Label>
                              <Input
                                id={`${slot.id}-digest`}
                                value={intent.sha256}
                                minLength={64}
                                maxLength={64}
                                required
                                onChange={(event) =>
                                  setIntents((values) => ({
                                    ...values,
                                    [slot.id]: {
                                      ...intent,
                                      sha256: event.target.value,
                                    },
                                  }))
                                }
                              />
                            </div>
                            <Button
                              type="submit"
                              disabled={pending}
                              className="md:col-span-2"
                            >
                              <UploadCloud className="mr-2 h-4 w-4" />
                              Record upload intent
                            </Button>
                          </form>
                        ) : null}

                        {isRecipient && attempt && !attempt.document ? (
                          canUpload &&
                          onUpload &&
                          onReload &&
                          request.status === "in_progress" &&
                          request.requestAcknowledgement
                            ?.acknowledgedByUserId === currentUserId &&
                          attempt.intent.recordedByUserId === currentUserId &&
                          !attempt.review ? (
                            <ClientActionUploadControl
                              key={`${snapshot.organisationId}:${membershipId}:${currentUserId}:${request.id}:${request.version}:${slot.id}:${attempt.intent.id}`}
                              binding={{
                                organisationId: snapshot.organisationId,
                                projectId: snapshot.projectId,
                                recordId: request.id,
                                slotId: slot.id,
                                intentId: attempt.intent.id,
                                expectedRecordVersion: request.version,
                                filename: attempt.intent.filename,
                                contentType: attempt.intent.contentType,
                                sizeBytes: attempt.intent.sizeBytes,
                                declaredSha256: attempt.intent.declaredSha256,
                                acceptedContentTypes: slot.acceptedContentTypes,
                              }}
                              membershipId={membershipId}
                              actorUserId={currentUserId}
                              disabled={pending}
                              onUpload={onUpload}
                              onReload={onReload}
                            />
                          ) : (
                            <StatusPanel
                              state="unavailable"
                              title="Upload details are out of date"
                              description="Reload the acknowledged request, recipient, open slot and latest upload record before selecting a file."
                            />
                          )
                        ) : null}

                        {canReview &&
                        !isRecipient &&
                        attempt?.document &&
                        !attempt.review ? (
                          <div className="space-y-3">
                            <Label htmlFor={`${slot.id}-review`}>
                              Named review reason
                            </Label>
                            <Textarea
                              id={`${slot.id}-review`}
                              value={reviewReason}
                              maxLength={1000}
                              required
                              onChange={(event) =>
                                setReviewReasons((values) => ({
                                  ...values,
                                  [slot.id]: event.target.value,
                                }))
                              }
                            />
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                disabled={pending || !reviewReason.trim()}
                                onClick={() =>
                                  onMutate?.({
                                    path: `evidence-requests/${request.id}/slots/${slot.id}/reviews`,
                                    body: {
                                      expectedVersion: request.version,
                                      decision: "accepted",
                                      reason: reviewReason,
                                    },
                                  })
                                }
                              >
                                <CheckCircle2 className="mr-2 h-4 w-4" />
                                Accept
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                disabled={pending || !reviewReason.trim()}
                                onClick={() =>
                                  onMutate?.({
                                    path: `evidence-requests/${request.id}/slots/${slot.id}/reviews`,
                                    body: {
                                      expectedVersion: request.version,
                                      decision: "correction_required",
                                      reason: reviewReason,
                                    },
                                  })
                                }
                              >
                                Request correction
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })
        )}
      </section>

      <section aria-labelledby="package-acknowledgements" className="space-y-4">
        <h2 id="package-acknowledgements" className="text-xl font-semibold">
          Released package acknowledgements
        </h2>
        {deliveries.length === 0 ? (
          <StatusPanel
            state="empty"
            title="No released package awaiting acknowledgement"
            description="No visible metadata-only delivery record is available."
          />
        ) : (
          deliveries.map((delivery) => (
            <article
              key={delivery.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-5"
            >
              <div>
                <h3 className="font-medium">
                  Package version {delivery.packageVersionId}
                </h3>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  Manifest {delivery.manifestSha256}
                </p>
              </div>
              {delivery.recipientUserId === currentUserId &&
              delivery.status === "available_for_acknowledgement" ? (
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    onMutate?.({
                      path: `package-deliveries/${delivery.id}/acknowledgements`,
                      body: {
                        expectedVersion: delivery.version,
                        statement:
                          "I acknowledge receipt of this exact released package version.",
                      },
                    })
                  }
                >
                  Acknowledge exact package
                </Button>
              ) : (
                <StateBadge state="active" label="Acknowledged" />
              )}
            </article>
          ))
        )}
      </section>
    </div>
  );
}

export default ClientActionWorkspace;
