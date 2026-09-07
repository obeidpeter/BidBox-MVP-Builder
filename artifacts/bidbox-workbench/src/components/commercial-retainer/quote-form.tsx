import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  CommercialRetainerMutation,
  CommercialRetainerSnapshotView,
} from "./commercial-retainer-contract";
import { FormField, randomDigest } from "./commercial-form-field";

export function QuoteForm({
  snapshot,
  busy,
  onMutate,
}: {
  snapshot: CommercialRetainerSnapshotView;
  busy: boolean;
  onMutate: (mutation: CommercialRetainerMutation) => Promise<void>;
}) {
  const orderable = snapshot.offers.filter((offer) => offer.orderable);
  const [digest, setDigest] = useState(randomDigest);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await onMutate({
        path: "/api/commercial-retainer/quotes",
        body: {
          projectId: data.get("projectId") || null,
          customerReference: data.get("customerReference"),
          offerVersionId: data.get("offerVersionId"),
          scopeSummary: data.get("scopeSummary"),
          currency: data.get("currency"),
          amountMinor: Number(data.get("amountMinor")),
          validUntil: data.get("validUntil"),
          serviceStartsOn: data.get("serviceStartsOn"),
          serviceEndsOn: data.get("serviceEndsOn"),
          serviceUnits: Number(data.get("serviceUnits")),
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
      <FormField id="commercial-offer" label="Offer version">
        <select
          id="commercial-offer"
          name="offerVersionId"
          required
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          disabled={busy || orderable.length === 0}
        >
          <option value="">Select an approved offer</option>
          {orderable.map((offer) => (
            <option key={offer.versionId} value={offer.versionId}>
              {offer.title} ({offer.versionId})
            </option>
          ))}
        </select>
      </FormField>
      <FormField id="commercial-customer-reference" label="Customer reference">
        <Input
          id="commercial-customer-reference"
          name="customerReference"
          required
          maxLength={160}
        />
      </FormField>
      <FormField id="commercial-project-id" label="Project ID (optional)">
        <Input id="commercial-project-id" name="projectId" inputMode="text" />
      </FormField>
      <FormField id="commercial-currency" label="Currency">
        <Input
          id="commercial-currency"
          name="currency"
          required
          pattern="[A-Z]{3}"
          maxLength={3}
          placeholder="NGN"
        />
      </FormField>
      <FormField
        id="commercial-amount"
        label="Amount entered by a person (minor units)"
      >
        <Input
          id="commercial-amount"
          name="amountMinor"
          required
          type="number"
          min={1}
          step={1}
        />
      </FormField>
      <FormField id="commercial-units" label="Service units">
        <Input
          id="commercial-units"
          name="serviceUnits"
          required
          type="number"
          min={1}
          max={100}
          step={1}
        />
      </FormField>
      <FormField id="commercial-valid-until" label="Quote valid until">
        <Input
          id="commercial-valid-until"
          name="validUntil"
          required
          type="date"
        />
      </FormField>
      <FormField id="commercial-service-start" label="Service starts">
        <Input
          id="commercial-service-start"
          name="serviceStartsOn"
          required
          type="date"
        />
      </FormField>
      <FormField id="commercial-service-end" label="Service ends">
        <Input
          id="commercial-service-end"
          name="serviceEndsOn"
          required
          type="date"
        />
      </FormField>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="commercial-scope">Agreed scope</Label>
        <Textarea
          id="commercial-scope"
          name="scopeSummary"
          required
          maxLength={1000}
        />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy || orderable.length === 0}>
          Create proposal for review
        </Button>
      </div>
    </form>
  );
}
