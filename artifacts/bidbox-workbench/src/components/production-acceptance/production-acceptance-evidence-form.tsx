import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  PRODUCTION_ACCEPTANCE_CATEGORIES,
  type ProductionAcceptanceCategory,
  type ProductionAcceptanceEvidenceDraft,
} from "./production-acceptance-contract";
import { humaniseToken as readable } from "@/lib/format";

const SELECT_CLASS =
  "flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function idempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `acceptance-${crypto.randomUUID()}`;
  }
  return `acceptance-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isoDate(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function textValue(
  data: FormData,
  name: string,
  maxCodeUnits: number,
): string | null {
  const value = data.get(name);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxCodeUnits ? trimmed : null;
}

export function ProductionAcceptanceEvidenceForm({
  releaseSha256,
  ownerOptions,
  pending,
  onSubmit,
}: {
  releaseSha256: string | null;
  ownerOptions: readonly { id: string; name: string }[];
  pending: boolean;
  onSubmit: (draft: ProductionAcceptanceEvidenceDraft) => Promise<void>;
}) {
  const retryKey = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setError(null);
    if (!releaseSha256) {
      setError("The exact release candidate must be configured first.");
      return;
    }
    const data = new FormData(form);
    const category = data.get("category");
    const outcome = data.get("outcome");
    const environment = data.get("environment");
    const observedAt = isoDate(data.get("observedAt"));
    const expiresAt = isoDate(data.get("expiresAt"));
    const ownerUserId = textValue(data, "ownerUserId", 128);
    const evidenceReference = textValue(data, "evidenceReference", 256);
    const artifactSha256 = textValue(data, "artifactSha256", 64);
    const summary = textValue(data, "summary", 1_000);
    if (
      typeof category !== "string" ||
      !PRODUCTION_ACCEPTANCE_CATEGORIES.includes(
        category as ProductionAcceptanceCategory,
      ) ||
      (outcome !== "passed" && outcome !== "failed") ||
      !["staging", "production", "recovery_rehearsal"].includes(
        String(environment),
      ) ||
      !observedAt ||
      !expiresAt ||
      !ownerUserId ||
      !UUID.test(ownerUserId) ||
      !evidenceReference ||
      !artifactSha256 ||
      !/^[a-f0-9]{64}$/u.test(artifactSha256) ||
      !summary
    ) {
      setError(
        "Complete every field and provide a valid retained artefact SHA-256.",
      );
      return;
    }
    retryKey.current ??= idempotencyKey();
    try {
      await onSubmit({
        category: category as ProductionAcceptanceCategory,
        outcome,
        environment:
          environment as ProductionAcceptanceEvidenceDraft["environment"],
        releaseSha256,
        ownerUserId,
        observedAt,
        expiresAt,
        evidenceReference,
        artifactSha256,
        summary,
        idempotencyKey: retryKey.current,
      });
      retryKey.current = null;
      form.reset();
    } catch {
      setError(
        "Evidence was not confirmed. Correct the issue or try again without changing the form; the same duplicate-prevention key will be reused.",
      );
    }
  };

  return (
    <section aria-labelledby="record-acceptance-evidence-heading">
      <Card className="shadow-none">
        <CardContent className="p-5">
          <h2
            id="record-acceptance-evidence-heading"
            className="text-lg font-semibold"
          >
            Record retained evidence
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Enter the reference and SHA-256 of evidence stored outside this
            form. The signed-in person is the verifier and must differ from the
            owner. This form does not run a rehearsal or recovery.
          </p>

          <form className="mt-5 space-y-5" onSubmit={submit}>
            <fieldset
              disabled={pending || !releaseSha256 || ownerOptions.length === 0}
              className="space-y-5"
            >
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="acceptance-category">Evidence category</Label>
                  <select
                    id="acceptance-category"
                    name="category"
                    className={SELECT_CLASS}
                    defaultValue="migration"
                    required
                  >
                    {PRODUCTION_ACCEPTANCE_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {readable(category)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="acceptance-outcome">Observed outcome</Label>
                  <select
                    id="acceptance-outcome"
                    name="outcome"
                    className={SELECT_CLASS}
                    defaultValue="passed"
                    required
                  >
                    <option value="passed">Passed</option>
                    <option value="failed">Failed</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="acceptance-environment">Environment</Label>
                  <select
                    id="acceptance-environment"
                    name="environment"
                    className={SELECT_CLASS}
                    defaultValue="recovery_rehearsal"
                    required
                  >
                    <option value="recovery_rehearsal">
                      Recovery rehearsal
                    </option>
                    <option value="staging">Staging</option>
                    <option value="production">Production observation</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="acceptance-owner">Accountable owner</Label>
                  <select
                    id="acceptance-owner"
                    name="ownerUserId"
                    className={SELECT_CLASS}
                    defaultValue=""
                    required
                  >
                    <option value="" disabled>
                      Select a different owner
                    </option>
                    {ownerOptions.map((owner) => (
                      <option key={owner.id} value={owner.id}>
                        {owner.name} · {owner.id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                  {ownerOptions.length === 0 ? (
                    <p className="text-xs text-destructive">
                      No other active owner is available, so evidence recording
                      is disabled.
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="acceptance-release">Release SHA-256</Label>
                  <Input
                    id="acceptance-release"
                    className="min-h-11 font-mono text-xs"
                    value={releaseSha256 ?? "Not configured"}
                    readOnly
                    aria-readonly="true"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="acceptance-observed-at">Observed at</Label>
                  <Input
                    id="acceptance-observed-at"
                    name="observedAt"
                    type="datetime-local"
                    className="min-h-11"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="acceptance-expires-at">Expires at</Label>
                  <Input
                    id="acceptance-expires-at"
                    name="expiresAt"
                    type="datetime-local"
                    className="min-h-11"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="acceptance-reference">
                  Retained evidence reference
                </Label>
                <Input
                  id="acceptance-reference"
                  name="evidenceReference"
                  className="min-h-11 font-mono text-xs"
                  maxLength={256}
                  autoComplete="off"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="acceptance-artifact-sha">
                  Retained artefact SHA-256
                </Label>
                <Input
                  id="acceptance-artifact-sha"
                  name="artifactSha256"
                  className="min-h-11 font-mono text-xs"
                  minLength={64}
                  maxLength={64}
                  pattern="[a-f0-9]{64}"
                  autoComplete="off"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="acceptance-summary">
                  Summary (no sensitive content)
                </Label>
                <Textarea
                  id="acceptance-summary"
                  name="summary"
                  maxLength={1_000}
                  rows={4}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Do not paste credentials, customer documents, database URLs or
                  recovery keys.
                </p>
              </div>
            </fieldset>

            {error ? (
              <p role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            ) : null}

            <Button
              type="submit"
              className="min-h-11"
              disabled={pending || !releaseSha256 || ownerOptions.length === 0}
            >
              {pending ? "Recording evidence…" : "Record evidence reference"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
