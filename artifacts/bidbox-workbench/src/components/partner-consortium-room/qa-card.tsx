import { useState } from "react";
import { FileCheck2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  ConsortiumMutation,
  ConsortiumParticipantOption,
  ConsortiumParty,
  ConsortiumQaItem,
  ConsortiumReasonCode,
} from "./partner-consortium-contract";
import {
  REASON_LABELS,
  REASONS,
  participantName,
  short,
} from "./consortium-support";

const QA_LABELS: Readonly<Record<ConsortiumQaItem["code"], string>> = {
  evidence_quality_review: "Evidence quality review",
  requirement_coverage_review: "Requirement coverage review",
  client_release_readiness: "Client release readiness",
  partner_cosign: "Partner co-sign",
};

export function QaCard(props: {
  item: ConsortiumQaItem;
  participants: readonly ConsortiumParticipantOption[];
  roomVersion: number;
  actorParty: ConsortiumParty;
  actorUserId: string;
  canWrite: boolean;
  pending: boolean;
  onMutate: (mutation: ConsortiumMutation) => void;
}) {
  const [evidenceSha256, setEvidenceSha256] = useState("");
  const [reasonCode, setReasonCode] = useState<ConsortiumReasonCode>(
    "evidence_not_sufficient",
  );
  const mayPrepare =
    props.canWrite &&
    props.item.required &&
    props.item.status === "open" &&
    props.item.preparerParty === props.actorParty &&
    props.item.ownerUserId === props.actorUserId;
  const mayCheck =
    props.canWrite &&
    props.item.required &&
    props.item.status === "ready_for_check" &&
    props.item.checkerParty === props.actorParty &&
    props.item.preparedByUserId !== props.actorUserId;

  return (
    <article className="rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">
            {QA_LABELS[props.item.code]}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {props.item.preparerParty} prepares · {props.item.checkerParty}{" "}
            checks
          </p>
        </div>
        <span className="rounded-full border px-2 py-1 text-xs">
          {props.item.required
            ? props.item.status.replaceAll("_", " ")
            : "not required"}
        </span>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Named owner{" "}
        {participantName(
          props.participants,
          props.item.ownerUserId,
          props.item.preparerParty,
        )}
      </p>
      {props.item.evidenceSha256 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Evidence {short(props.item.evidenceSha256, 10, 8)}
        </p>
      ) : null}
      {mayPrepare ? (
        <div className="mt-4 grid gap-2">
          <label className="grid gap-1 text-xs font-medium">
            Evidence document fingerprint (SHA-256)
            <input
              required
              minLength={64}
              maxLength={64}
              pattern="[a-f0-9]{64}"
              autoComplete="off"
              className="min-h-10 rounded-md border border-input bg-background px-3 font-mono text-sm"
              value={evidenceSha256}
              onChange={(event) => setEvidenceSha256(event.currentTarget.value)}
            />
            <span className="font-normal text-muted-foreground">
              This fingerprint identifies the exact document bytes; it does not
              prove the content is correct.
            </span>
          </label>
          <Button
            type="button"
            variant="outline"
            disabled={props.pending || evidenceSha256.length !== 64}
            onClick={() =>
              props.onMutate({
                kind: "qa_preparation",
                path: `qa/${props.item.id}/preparations`,
                body: {
                  expectedVersion: props.roomVersion,
                  evidenceSha256,
                },
              })
            }
          >
            Ready for independent check
          </Button>
        </div>
      ) : null}
      {mayCheck ? (
        <div className="mt-4 grid gap-2">
          <select
            aria-label={`${QA_LABELS[props.item.code]} rejection reason`}
            className="min-h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={reasonCode}
            onChange={(event) =>
              setReasonCode(event.currentTarget.value as ConsortiumReasonCode)
            }
          >
            {REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {REASON_LABELS[reason]}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={props.pending}
              onClick={() =>
                props.onMutate({
                  kind: "qa_decision",
                  path: `qa/${props.item.id}/decisions`,
                  body: {
                    expectedVersion: props.roomVersion,
                    decision: "rejected",
                    reasonCode,
                  },
                })
              }
            >
              Reject check
            </Button>
            <Button
              type="button"
              disabled={props.pending}
              onClick={() =>
                props.onMutate({
                  kind: "qa_decision",
                  path: `qa/${props.item.id}/decisions`,
                  body: {
                    expectedVersion: props.roomVersion,
                    decision: "checked",
                  },
                })
              }
            >
              <FileCheck2 className="mr-2 size-4" aria-hidden="true" />
              Check
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
