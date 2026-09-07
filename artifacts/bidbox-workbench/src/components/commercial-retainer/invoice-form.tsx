import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  CommercialRetainerMutation,
  QuoteProposalView,
} from "./commercial-retainer-contract";
import { FormField } from "./commercial-form-field";

export function InvoiceForm({
  quote,
  busy,
  onMutate,
}: {
  quote: QuoteProposalView;
  busy: boolean;
  onMutate: (mutation: CommercialRetainerMutation) => Promise<void>;
}) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await onMutate({
        path: `/api/commercial-retainer/quotes/${quote.id}/invoices`,
        body: {
          expectedOrderVersion: quote.version,
          invoiceNumber: data.get("invoiceNumber"),
          netAmountMinor: Number(data.get("netAmountMinor")),
          vatRateBasisPoints: Number(data.get("vatRateBasisPoints")),
          vatAmountMinor: Number(data.get("vatAmountMinor")),
          grossAmountMinor: Number(data.get("grossAmountMinor")),
          whtRateBasisPoints: data.get("whtRateBasisPoints")
            ? Number(data.get("whtRateBasisPoints"))
            : null,
          whtAmountMinor: data.get("whtAmountMinor")
            ? Number(data.get("whtAmountMinor"))
            : null,
          netPayableMinor: Number(data.get("netPayableMinor")),
          taxRuleId: data.get("taxRuleId"),
          taxPointAt: new Date(String(data.get("taxPointAt"))).toISOString(),
          dueAt: data.get("dueAt")
            ? new Date(String(data.get("dueAt"))).toISOString()
            : null,
        },
      });
    } catch {
      return;
    }
  }
  return (
    <details className="mt-3 rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Record manual invoice
      </summary>
      <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={submit}>
        <FormField id={`invoice-number-${quote.id}`} label="Invoice number">
          <Input
            id={`invoice-number-${quote.id}`}
            name="invoiceNumber"
            required
          />
        </FormField>
        <FormField
          id={`invoice-net-${quote.id}`}
          label="Net amount (minor units)"
        >
          <Input
            id={`invoice-net-${quote.id}`}
            name="netAmountMinor"
            type="number"
            min={1}
            step={1}
            required
            defaultValue={quote.amountMinor}
          />
        </FormField>
        {[
          ["vatRateBasisPoints", "VAT rate (basis points)"],
          ["vatAmountMinor", "VAT amount (minor units)"],
          ["grossAmountMinor", "Gross amount (minor units)"],
          ["whtRateBasisPoints", "WHT rate (basis points, optional)"],
          ["whtAmountMinor", "WHT amount (minor units, optional)"],
          ["netPayableMinor", "Net payable (minor units)"],
        ].map(([name, label]) => (
          <FormField key={name} id={`${name}-${quote.id}`} label={label}>
            <Input
              id={`${name}-${quote.id}`}
              name={name}
              type="number"
              min={0}
              step={1}
              required={!name.startsWith("wht")}
            />
          </FormField>
        ))}
        <FormField
          id={`tax-rule-${quote.id}`}
          label="Tax rule/version reference"
        >
          <Input id={`tax-rule-${quote.id}`} name="taxRuleId" required />
        </FormField>
        <FormField id={`tax-point-${quote.id}`} label="Tax point">
          <Input
            id={`tax-point-${quote.id}`}
            name="taxPointAt"
            type="datetime-local"
            required
          />
        </FormField>
        <FormField id={`invoice-due-${quote.id}`} label="Due at (optional)">
          <Input
            id={`invoice-due-${quote.id}`}
            name="dueAt"
            type="datetime-local"
          />
        </FormField>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={busy}>
            Record invoice without contacting a provider
          </Button>
        </div>
      </form>
    </details>
  );
}
