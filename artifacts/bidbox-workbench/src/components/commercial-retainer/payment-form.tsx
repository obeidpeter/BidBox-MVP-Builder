import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  CommercialRetainerMutation,
  CommercialRetainerSnapshotView,
} from "./commercial-retainer-contract";
import { FormField, randomDigest } from "./commercial-form-field";

export function PaymentForm({
  invoice,
  busy,
  onMutate,
}: {
  invoice: CommercialRetainerSnapshotView["invoices"][number];
  busy: boolean;
  onMutate: (mutation: CommercialRetainerMutation) => Promise<void>;
}) {
  const [digest, setDigest] = useState(randomDigest);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await onMutate({
        path: `/api/commercial-retainer/invoices/${invoice.id}/payments`,
        body: {
          expectedInvoiceVersion: invoice.version,
          evidenceReference: data.get("evidenceReference"),
          evidenceSha256: data.get("evidenceSha256"),
          amountMinor: invoice.netPayableMinor,
          currency: invoice.currency,
          settledAt: new Date(String(data.get("settledAt"))).toISOString(),
          idempotencyDigest: digest,
        },
      });
    } catch {
      return;
    }
    setDigest(randomDigest());
  }
  return (
    <details className="mt-3 rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Record payment evidence
      </summary>
      <form className="mt-4 grid gap-3" onSubmit={submit}>
        <FormField
          id={`payment-reference-${invoice.id}`}
          label="Evidence reference"
        >
          <Input
            id={`payment-reference-${invoice.id}`}
            name="evidenceReference"
            required
          />
        </FormField>
        <FormField id={`payment-hash-${invoice.id}`} label="Evidence SHA-256">
          <Input
            id={`payment-hash-${invoice.id}`}
            name="evidenceSha256"
            required
            pattern="[a-f0-9]{64}"
          />
        </FormField>
        <FormField id={`payment-settled-${invoice.id}`} label="Settled at">
          <Input
            id={`payment-settled-${invoice.id}`}
            name="settledAt"
            type="datetime-local"
            required
          />
        </FormField>
        <Button type="submit" disabled={busy}>
          Record payment evidence for review
        </Button>
      </form>
    </details>
  );
}
