import { useId } from "react";
import { ExternalLink, Landmark, NotebookPen } from "lucide-react";
import { StateBadge, type SurfaceState } from "@/components/platform-states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type {
  CredentialCheckRecord,
  CredentialCheckStatus,
  OperationsSectionState,
} from "./operations-suite-contract";
import {
  formatOperationsDate,
  HumanAuthorityNotice,
  OperationsSection,
  RecordsBoundary,
  RecordFacts,
  safeExternalHref,
} from "./operations-suite-primitives";

const STATUS: Record<
  CredentialCheckStatus,
  { label: string; state: SurfaceState }
> = {
  unverified: { label: "Not checked", state: "pending" },
  verified: { label: "Human-verified", state: "active" },
  not_verified: { label: "Not verified", state: "blocked" },
  failed: { label: "Check failed", state: "blocked" },
  inconclusive: { label: "Inconclusive check", state: "pending" },
  expired: { label: "Expired", state: "expired" },
};

export interface CredentialVerificationHubProps extends OperationsSectionState {
  credentials: readonly CredentialCheckRecord[];
  onRecordCheck?: (credentialId: string) => void;
}

export function CredentialVerificationHub({
  credentials,
  state = "ready",
  error,
  readOnly = false,
  onRetry,
  onRecordCheck,
}: CredentialVerificationHubProps) {
  const instanceId = useId();
  const boundary = RecordsBoundary({
    state,
    error,
    count: credentials.length,
    loadingLabel: "Loading credential verification records",
    errorTitle: "Credential checks could not be loaded",
    emptyTitle: "No credential checks are recorded",
    emptyDescription:
      "No verification record was supplied. The absence of a record is not proof that a credential is authentic or current.",
    onRetry,
  });

  return (
    <OperationsSection
      id="credential-verification"
      title="Credential checks"
      description="Guide checks against official issuer sources and record who checked, when they checked and the receipt fingerprint."
      icon={<Landmark aria-hidden="true" className="size-5" />}
      busy={state === "loading"}
    >
      <HumanAuthorityNotice title="Issuer authority">
        Valo records a check; it does not impersonate an issuer or declare a
        credential genuine. The named checker must use the issuer&apos;s
        official service and keep the check receipt. The selected source
        document must not be quarantined, but this current record does not prove
        that a malware scan passed.
      </HumanAuthorityNotice>

      {boundary ?? (
        <ul
          className="grid list-none gap-4 p-0 lg:grid-cols-2"
          aria-label="Credential verification records"
        >
          {credentials.map((credential) => {
            const presentation = STATUS[credential.status];
            const officialHref = safeExternalHref(credential.officialUrl);
            return (
              <li key={credential.id}>
                <Card className="h-full shadow-none">
                  <article
                    aria-labelledby={`${instanceId}-${credential.id}-title`}
                  >
                    <CardHeader className="space-y-3 pb-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <StateBadge
                          state={presentation.state}
                          label={presentation.label}
                        />
                        <span className="text-xs text-muted-foreground">
                          {credential.issuerName}
                        </span>
                      </div>
                      <h3
                        id={`${instanceId}-${credential.id}-title`}
                        className="text-base font-semibold"
                      >
                        {credential.credentialName}
                      </h3>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-0">
                      <RecordFacts
                        facts={[
                          { label: "Reference", value: credential.reference },
                          {
                            label: "Current evidence version",
                            value:
                              credential.vaultItemVersion?.toLocaleString(
                                "en-NG",
                              ) ?? "Not recorded",
                          },
                          {
                            label: "Checked",
                            value: formatOperationsDate(
                              credential.checkedAt ?? null,
                            ),
                          },
                          {
                            label: "Checked by",
                            value: credential.checkedByName ?? "Not checked",
                          },
                        ]}
                      />
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">
                          Document fingerprint (SHA-256)
                        </p>
                        <code className="mt-1 block break-all rounded-md border border-border bg-muted/40 p-3 text-xs">
                          {credential.documentHash ?? "Not recorded"}
                        </code>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">
                          Verification receipt SHA-256
                        </p>
                        <code className="mt-1 block break-all rounded-md border border-border bg-muted/40 p-3 text-xs">
                          {credential.receiptHash ?? "Not recorded"}
                        </code>
                      </div>
                      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                        {officialHref ? (
                          <Button
                            asChild
                            variant="outline"
                            className="min-h-11 w-full sm:w-auto"
                            data-control-size="44"
                          >
                            <a
                              href={officialHref}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`Open official ${credential.issuerName} service for ${credential.credentialName}`}
                            >
                              <ExternalLink aria-hidden="true" />
                              Open official issuer service
                            </a>
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          className="min-h-11 w-full sm:w-auto"
                          data-control-size="44"
                          disabled={readOnly || !onRecordCheck}
                          onClick={() => onRecordCheck?.(credential.id)}
                        >
                          <NotebookPen aria-hidden="true" />
                          Record human check
                        </Button>
                      </div>
                    </CardContent>
                  </article>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </OperationsSection>
  );
}

export default CredentialVerificationHub;
