import {
  FeatureActivationNotice,
  PageHeader,
  QueueCapabilityCard,
  StatusPanel,
} from "@/components/platform-states";
import { platformFeatureFlags } from "@/lib/platform-access";

export default function BillingEntitlements() {
  const enabled = platformFeatureFlags().billingEntitlements;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7 p-5 sm:p-8">
      <PageHeader
        eyebrow="Commercial controls"
        title="Billing & access"
        description="Review which billing and service-access controls are available."
        state={enabled ? "partial" : "pending"}
      />

      <FeatureActivationNotice
        enabled={enabled}
        feature="Billing and access"
        detail={
          enabled
            ? "Billing is enabled, but prices, orders, subscriptions, invoices, payment matching and access decisions are not connected yet."
            : "Billing is not active. This page does not set prices, create orders or invoices, record payments or grant access."
        }
      />

      <StatusPanel
        state="partial"
        title="Project payment checks are not billing records"
        description="A project payment check can pause work. It is not an invoice, verified payment, subscription or proof of service access."
      />

      <section
        aria-labelledby="commercial-capabilities-heading"
        className="space-y-4"
      >
        <h2
          id="commercial-capabilities-heading"
          className="font-serif text-xl font-semibold"
        >
          Billing and access status
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <QueueCapabilityCard
            title="Price list versions"
            description="Each product needs an approved version with start and end dates."
            state="unavailable"
          />
          <QueueCapabilityCard
            title="Access decisions"
            description="The server must explain why access is allowed or denied, using product, organisation, usage and expiry rules."
            state="blocked"
          />
          <QueueCapabilityCard
            title="Orders and subscriptions"
            description="Creating, cancelling and renewing orders or subscriptions is not connected."
            state="unavailable"
          />
          <QueueCapabilityCard
            title="Invoices and payments"
            description="Matching provider payments to invoices and handling billing exceptions are not connected."
            state="unavailable"
          />
          <QueueCapabilityCard
            title="Usage and fair-use limits"
            description="Model costs are tracked separately. Customer usage and limit decisions are not available."
            state="partial"
          />
          <QueueCapabilityCard
            title="Partner arrangements"
            description="Partner revenue share and access rules need an active, versioned agreement."
            state="pending"
          />
        </div>
      </section>
    </div>
  );
}
