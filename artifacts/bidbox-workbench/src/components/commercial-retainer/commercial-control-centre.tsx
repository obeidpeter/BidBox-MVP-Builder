import { StateBadge, StatusPanel } from "@/components/platform-states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  CommercialRetainerMutation,
  CommercialRetainerSnapshotView,
} from "./commercial-retainer-contract";
import { InvoiceForm } from "./invoice-form";
import { PaymentForm } from "./payment-form";
import { QuoteForm } from "./quote-form";
import {
  RetainerRequestCard,
  RetainerRequestForm,
} from "./retainer-request-forms";

function commercialStatusLabel(value: string): string {
  const labels: Readonly<Record<string, string>> = {
    pending_checker: "Awaiting second review",
    issued_manual: "Invoice recorded",
    paid_manual: "Payment verified",
    verified_manual: "Payment verified",
  };
  return labels[value] ?? value.replaceAll("_", " ");
}

export function dispatchCommercialMutation(
  onMutate: (mutation: CommercialRetainerMutation) => Promise<void>,
  mutation: CommercialRetainerMutation,
): void {
  // The page mutation owns user-facing error feedback. Event handlers must
  // still settle the rejected promise so React does not surface it globally.
  void onMutate(mutation).catch(() => undefined);
}

export function CommercialControlCentre({
  snapshot,
  actorUserId,
  actorMembershipId,
  canCreateOrder,
  canApprove,
  canReconcile,
  canUseRetainer,
  busy = false,
  onMutate,
}: {
  snapshot: CommercialRetainerSnapshotView;
  actorUserId: string;
  actorMembershipId: string;
  canCreateOrder: boolean;
  canApprove: boolean;
  canReconcile: boolean;
  canUseRetainer: boolean;
  busy?: boolean;
  onMutate: (mutation: CommercialRetainerMutation) => Promise<void>;
}) {
  return (
    <div className="space-y-8">
      {!snapshot.activation.fixedPriceBookReady ? (
        <StatusPanel
          state="blocked"
          title="Approved offers cannot be ordered"
          description="An approved price-book version is missing. This page cannot create a product or price."
        />
      ) : null}
      <StatusPanel
        state="partial"
        title="People control each commercial step"
        description="A named person enters each price. A different named person must approve it and verify payment. Payment providers, external messages and automatic delivery are not connected."
      />

      <section
        aria-labelledby="commercial-offers-heading"
        className="space-y-4"
      >
        <h2
          id="commercial-offers-heading"
          className="font-serif text-xl font-semibold"
        >
          Approved offers
        </h2>
        <div className="grid gap-4 lg:grid-cols-3">
          {snapshot.offers.map((offer) => (
            <Card key={offer.versionId}>
              <CardHeader>
                <CardTitle className="text-base">{offer.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground">{offer.summary}</p>
                <StateBadge
                  state={offer.orderable ? "active" : "blocked"}
                  label={
                    offer.orderable ? "Approved version" : "Price list missing"
                  }
                />
                <p className="font-mono text-xs">{offer.versionId}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        {canCreateOrder ? (
          <QuoteForm snapshot={snapshot} busy={busy} onMutate={onMutate} />
        ) : null}
      </section>

      <section aria-labelledby="quote-ledger-heading" className="space-y-4">
        <h2
          id="quote-ledger-heading"
          className="font-serif text-xl font-semibold"
        >
          Quotes, invoices &amp; payments
        </h2>
        {snapshot.quotes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No quote proposals for this organisation.
          </p>
        ) : null}
        {snapshot.quotes.map((quote) => {
          const selfApproval = quote.createdByUserId === actorUserId;
          return (
            <Card key={quote.id}>
              <CardContent className="space-y-3 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{quote.customerReference}</h3>
                    <p className="text-sm text-muted-foreground">
                      {quote.offerVersionId} · {quote.currency}{" "}
                      {quote.amountMinor} minor units
                    </p>
                  </div>
                  <StateBadge
                    state={quote.status === "paid" ? "active" : "pending"}
                    label={commercialStatusLabel(quote.status)}
                  />
                </div>
                <p className="text-sm">{quote.scopeSummary}</p>
                {quote.status === "pending_checker" && canApprove ? (
                  <div>
                    <Button
                      type="button"
                      disabled={busy || selfApproval}
                      aria-describedby={
                        selfApproval ? `self-approval-${quote.id}` : undefined
                      }
                      onClick={() =>
                        dispatchCommercialMutation(onMutate, {
                          path: `/api/commercial-retainer/quotes/${quote.id}/approve`,
                          body: { expectedVersion: quote.version },
                        })
                      }
                    >
                      Approve as second reviewer
                    </Button>
                    {selfApproval ? (
                      <p
                        id={`self-approval-${quote.id}`}
                        className="mt-2 text-xs text-muted-foreground"
                      >
                        The person who created the proposal cannot approve it.
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {quote.status === "approved" && canReconcile ? (
                  <InvoiceForm quote={quote} busy={busy} onMutate={onMutate} />
                ) : null}
              </CardContent>
            </Card>
          );
        })}
        {snapshot.invoices.map((invoice) => (
          <Card key={invoice.id}>
            <CardContent className="space-y-2 p-5 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <h3 className="font-semibold">
                  Invoice {invoice.invoiceNumber}
                </h3>
                <StateBadge
                  state={
                    invoice.status === "paid_manual" ? "active" : "pending"
                  }
                  label={commercialStatusLabel(invoice.status)}
                />
              </div>
              <p>
                {invoice.currency} {invoice.netPayableMinor} minor units payable
              </p>
              {invoice.status === "issued_manual" && canReconcile ? (
                <PaymentForm
                  invoice={invoice}
                  busy={busy}
                  onMutate={onMutate}
                />
              ) : null}
            </CardContent>
          </Card>
        ))}
        {snapshot.payments.map((payment) => {
          const invoice = snapshot.invoices.find(
            (item) => item.id === payment.invoiceId,
          );
          const selfVerification = payment.recordedByUserId === actorUserId;
          return (
            <Card key={payment.id}>
              <CardContent className="space-y-2 p-5 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <h3 className="font-semibold">
                    Payment evidence {payment.id}
                  </h3>
                  <StateBadge
                    state={
                      payment.reconciliationStatus === "verified_manual"
                        ? "active"
                        : "pending"
                    }
                    label={commercialStatusLabel(payment.reconciliationStatus)}
                  />
                </div>
                <p className="break-all font-mono text-xs">
                  SHA-256 {payment.evidenceSha256}
                </p>
                {payment.reconciliationStatus === "pending_checker" &&
                invoice &&
                canReconcile ? (
                  <Button
                    type="button"
                    disabled={busy || selfVerification}
                    onClick={() =>
                      dispatchCommercialMutation(onMutate, {
                        path: `/api/commercial-retainer/payments/${payment.id}/verify`,
                        body: {
                          expectedPaymentVersion: payment.version,
                          expectedInvoiceVersion: invoice.version,
                        },
                      })
                    }
                  >
                    Verify payment evidence and grant access
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section aria-labelledby="retainer-desk-heading" className="space-y-4">
        <h2
          id="retainer-desk-heading"
          className="font-serif text-xl font-semibold"
        >
          Retainer service desk
        </h2>
        <p className="text-sm text-muted-foreground">
          Each request uses one included service unit and creates internal work
          only. It does not send a message or start work automatically.
        </p>
        {canUseRetainer ? (
          <RetainerRequestForm
            snapshot={snapshot}
            actorMembershipId={actorMembershipId}
            busy={busy}
            onMutate={onMutate}
          />
        ) : null}
        <div className="grid gap-4 lg:grid-cols-2">
          {snapshot.serviceRequests.map((request) => (
            <RetainerRequestCard
              key={request.id}
              request={request}
              busy={busy}
              onMutate={onMutate}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
