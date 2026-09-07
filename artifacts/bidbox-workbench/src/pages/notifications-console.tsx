import { Button } from "@/components/ui/button";
import {
  FeatureActivationNotice,
  PageHeader,
  QueueCapabilityCard,
  StatusPanel,
} from "@/components/platform-states";
import { platformFeatureFlags } from "@/lib/platform-access";

export default function NotificationsConsole() {
  const enabled = platformFeatureFlags().notificationAdapters;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7 p-5 sm:p-8">
      <PageHeader
        eyebrow="Delivery operations"
        title="Notifications"
        description="Review notification channels, delivery status, retries and failures. A queued item is not proof of delivery."
        state={enabled ? "partial" : "pending"}
        actions={
          <Button
            type="button"
            disabled
            title="Sending notifications is not connected"
          >
            Send notification
          </Button>
        }
      />

      <FeatureActivationNotice
        enabled={enabled}
        feature="Notification delivery services"
        detail={
          enabled
            ? "Notification delivery services are enabled, but channel credentials, provider health, receipt checks and the shared failure queue still need server confirmation."
            : "Only project notification records are available. This page does not claim that email, WhatsApp or in-app messages were delivered."
        }
      />

      <StatusPanel
        state="partial"
        title="Queued is not delivered"
        description="A notification stays pending until the provider response and any required receipt check update its status. An operator must resolve failed or uncertain deliveries."
      />

      <section
        aria-labelledby="notification-channels-heading"
        className="space-y-4"
      >
        <h2
          id="notification-channels-heading"
          className="font-serif text-xl font-semibold"
        >
          Channel and queue status
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <QueueCapabilityCard
            title="Manual record"
            description="Project notification records show who recorded an event. They do not prove that an external message was delivered."
            state="active"
          />
          <QueueCapabilityCard
            title="Email delivery"
            description="Provider health, duplicate protection, retry rules and receipt checks are not available here."
            state="unavailable"
          />
          <QueueCapabilityCard
            title="WhatsApp Business"
            description="Activation requires an approved WhatsApp Business integration and approved templates."
            state="unavailable"
          />
          <QueueCapabilityCard
            title="In-app notifications"
            description="Inboxes, read status and organisation-specific preferences are not connected."
            state="pending"
          />
          <QueueCapabilityCard
            title="Failure queue"
            description="A shared failed-delivery queue is not available."
            state="blocked"
          />
          <QueueCapabilityCard
            title="Digest and escalation rules"
            description="Response-time and expiry alerts exist, but schedules, suppression rules and recipients are not configured."
            state="partial"
          />
        </div>
      </section>
    </div>
  );
}
