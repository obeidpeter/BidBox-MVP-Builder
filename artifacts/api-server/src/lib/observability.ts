import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { RequestHandler } from "express";
import type { DatabasePoolSnapshot } from "@workspace/db";
import type { RuntimeLifecycleState } from "./runtimeLifecycle";

const CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/u;
const DURATION_BUCKETS = [25, 100, 500, 2_000, 10_000] as const;

export const OPERATIONAL_SIGNAL_REGISTRY_VERSION =
  "bidbox-operational-signals/v1" as const;

type ResponseClass = "1xx" | "2xx" | "3xx" | "4xx" | "5xx";
type DeliveryState = "connected" | "disconnected";

const DEFAULT_PUBLISH_DEADLINE_MILLISECONDS = 10_000;

export interface DeliveryStatus {
  metrics: DeliveryState;
  paging: DeliveryState;
}

export interface OperationalSignalsSnapshot {
  databasePool: DatabasePoolSnapshot;
  delivery: DeliveryStatus;
  http: {
    active: number;
    durationMilliseconds: Record<string, number>;
    responses: Record<ResponseClass, number>;
    started: number;
  };
  runtime: {
    lifecycle: RuntimeLifecycleState;
    uptimeSeconds: number;
  };
}

export interface OperationalSignalsAdapter {
  readonly status: DeliveryState;
  /** Must match the source-controlled registry consumed by the deployment. */
  readonly registryVersion: typeof OPERATIONAL_SIGNAL_REGISTRY_VERSION;
  /** Immutable deployment evidence; a connected string alone is not proof. */
  readonly verificationEvidenceReference: string | null;
  publish(
    batch: OperationalSignalBatch,
    options: { signal: AbortSignal },
  ): Promise<void>;
}

export interface PagingAdapter {
  readonly status: DeliveryState;
  /** Immutable synthetic delivery/acknowledgement evidence. */
  readonly verificationEvidenceReference: string | null;
}

export interface OperationalSignalPoint {
  labels?: Readonly<Record<string, string>>;
  name: string;
  type: "counter" | "gauge" | "histogram_bucket";
  value: number;
}

export interface OperationalSignalBatch {
  emittedAt: string;
  points: readonly OperationalSignalPoint[];
  registryVersion: typeof OPERATIONAL_SIGNAL_REGISTRY_VERSION;
  source: "api_runtime";
}

let metricsAdapter: OperationalSignalsAdapter | undefined;
let pagingAdapter: PagingAdapter | undefined;
let metricsDeliveryHealthy = false;
let metricsDeliverySuppressed = false;

/** Provider adapters are installed explicitly by the deployment composition. */
export function configureOperationsDelivery(adapters: {
  metrics?: OperationalSignalsAdapter;
  paging?: PagingAdapter;
}): void {
  if (
    adapters.metrics?.status === "connected" &&
    (adapters.metrics.registryVersion !== OPERATIONAL_SIGNAL_REGISTRY_VERSION ||
      !validEvidenceReference(adapters.metrics.verificationEvidenceReference))
  ) {
    throw new Error(
      "A connected metrics adapter requires the current registry and verification evidence",
    );
  }
  if (
    adapters.paging?.status === "connected" &&
    !validEvidenceReference(adapters.paging.verificationEvidenceReference)
  ) {
    throw new Error(
      "A connected paging adapter requires synthetic delivery evidence",
    );
  }
  metricsAdapter = adapters.metrics;
  pagingAdapter = adapters.paging;
  metricsDeliveryHealthy = false;
  metricsDeliverySuppressed = false;
}

function validEvidenceReference(value: string | null): value is string {
  return Boolean(
    value &&
    value === value.trim() &&
    value.length >= 16 &&
    value.length <= 512 &&
    !/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value),
  );
}

export function operationsDeliveryStatus(): DeliveryStatus {
  return {
    metrics:
      metricsAdapter?.status === "connected" && metricsDeliveryHealthy
        ? "connected"
        : "disconnected",
    paging: pagingAdapter?.status ?? "disconnected",
  };
}

export function requestCorrelationId(headers: IncomingHttpHeaders): string {
  const supplied = headers["x-request-id"];
  if (typeof supplied === "string" && CORRELATION_ID.test(supplied)) {
    return supplied;
  }
  return randomUUID();
}

function responseClass(statusCode: number): ResponseClass {
  if (statusCode >= 500) return "5xx";
  if (statusCode >= 400) return "4xx";
  if (statusCode >= 300) return "3xx";
  if (statusCode >= 200) return "2xx";
  return "1xx";
}

export class OperationalSignals {
  private active = 0;
  private readonly durations = new Map<string, number>([
    ...DURATION_BUCKETS.map((bound) => [`le_${bound}`, 0] as const),
    ["overflow", 0],
  ]);
  private readonly responses: Record<ResponseClass, number> = {
    "1xx": 0,
    "2xx": 0,
    "3xx": 0,
    "4xx": 0,
    "5xx": 0,
  };
  private started = 0;

  begin(): (statusCode: number, durationMilliseconds: number) => void {
    this.active += 1;
    this.started += 1;
    let finished = false;
    return (statusCode, durationMilliseconds) => {
      if (finished) return;
      finished = true;
      this.active = Math.max(0, this.active - 1);
      this.responses[responseClass(statusCode)] += 1;
      const bound = DURATION_BUCKETS.find(
        (candidate) => durationMilliseconds <= candidate,
      );
      const key = bound === undefined ? "overflow" : `le_${bound}`;
      this.durations.set(key, (this.durations.get(key) ?? 0) + 1);
    };
  }

  middleware(): RequestHandler {
    return (_request, response, next) => {
      const startedAt = process.hrtime.bigint();
      const finish = this.begin();
      let complete = false;
      const record = () => {
        if (complete) return;
        complete = true;
        const elapsed = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        finish(response.statusCode, elapsed);
      };
      response.once("finish", record);
      response.once("close", record);
      next();
    };
  }

  snapshot(
    databasePool: DatabasePoolSnapshot,
    lifecycle: RuntimeLifecycleState,
  ): OperationalSignalsSnapshot {
    return {
      databasePool: { ...databasePool },
      delivery: operationsDeliveryStatus(),
      http: {
        active: this.active,
        durationMilliseconds: Object.fromEntries(this.durations),
        responses: { ...this.responses },
        started: this.started,
      },
      runtime: {
        lifecycle,
        uptimeSeconds: Math.floor(process.uptime()),
      },
    };
  }
}

export const operationalSignals = new OperationalSignals();

/**
 * Convert the in-process snapshot into stable, low-cardinality points. Ratios
 * and staleness are deliberately derived by the deployment adapter so source
 * never invents values it cannot observe.
 */
export function operationalSignalBatch(
  snapshot: OperationalSignalsSnapshot,
  emittedAt = new Date(),
): OperationalSignalBatch {
  const points: OperationalSignalPoint[] = [
    {
      name: "http.server.active_requests",
      type: "gauge",
      value: snapshot.http.active,
    },
    {
      name: "http.server.started_total",
      type: "counter",
      value: snapshot.http.started,
    },
    ...Object.entries(snapshot.http.responses).map(
      ([statusClass, value]): OperationalSignalPoint => ({
        labels: { status_class: statusClass },
        name: "http.server.responses_total",
        type: "counter",
        value,
      }),
    ),
    ...Object.entries(snapshot.http.durationMilliseconds).map(
      ([bucket, value]): OperationalSignalPoint => ({
        labels: { bucket },
        name: "http.server.duration_milliseconds_bucket_total",
        type: "counter",
        value,
      }),
    ),
    ...Object.entries(snapshot.databasePool).map(
      ([state, value]): OperationalSignalPoint => ({
        labels: { state },
        name: "bidbox.database.pool_connections",
        type: "gauge",
        value,
      }),
    ),
    {
      name: "bidbox.runtime.uptime_seconds",
      type: "gauge",
      value: snapshot.runtime.uptimeSeconds,
    },
    ...(["starting", "accepting", "draining"] as const).map(
      (state): OperationalSignalPoint => ({
        labels: { state },
        name: "bidbox.runtime.lifecycle",
        type: "gauge",
        value: snapshot.runtime.lifecycle === state ? 1 : 0,
      }),
    ),
    ...Object.entries(snapshot.delivery).map(
      ([channel, state]): OperationalSignalPoint => ({
        labels: { channel },
        name: "bidbox.observability.delivery_connected",
        type: "gauge",
        value: state === "connected" ? 1 : 0,
      }),
    ),
  ];
  return {
    emittedAt: emittedAt.toISOString(),
    points,
    registryVersion: OPERATIONAL_SIGNAL_REGISTRY_VERSION,
    source: "api_runtime",
  };
}

interface SignalsLogger {
  error(bindings: object, message: string): void;
  info(bindings: object, message: string): void;
  warn(bindings: object, message: string): void;
}

interface HeartbeatScheduler {
  clear(handle: { unref(): void }): void;
  set(callback: () => void, intervalMillis: number): { unref(): void };
}

export function startOperationalSignalHeartbeat(options: {
  getDatabasePool: () => DatabasePoolSnapshot;
  getLifecycle: () => RuntimeLifecycleState;
  intervalMillis?: number;
  publishDeadlineMillis?: number;
  scheduler?: HeartbeatScheduler;
  logger: SignalsLogger;
  signals?: OperationalSignals;
}): () => void {
  const intervalMillis = options.intervalMillis ?? 60_000;
  if (
    !Number.isSafeInteger(intervalMillis) ||
    intervalMillis < 10_000 ||
    intervalMillis > 300_000
  ) {
    throw new Error(
      "Operational signal interval must be between 10000 and 300000 ms",
    );
  }
  const signals = options.signals ?? operationalSignals;
  const publishDeadlineMillis =
    options.publishDeadlineMillis ?? DEFAULT_PUBLISH_DEADLINE_MILLISECONDS;
  if (
    !Number.isSafeInteger(publishDeadlineMillis) ||
    publishDeadlineMillis < 100 ||
    publishDeadlineMillis > 30_000
  ) {
    throw new Error(
      "Operational signal publish deadline must be between 100 and 30000 ms",
    );
  }
  const delivery = operationsDeliveryStatus();
  if (
    delivery.metrics === "disconnected" ||
    delivery.paging === "disconnected"
  ) {
    options.logger.warn(
      { delivery },
      "External observability delivery is not connected",
    );
  }
  let inFlight = false;
  let stopped = false;
  let activeController: AbortController | undefined;
  const publish = () => {
    const snapshot = signals.snapshot(
      options.getDatabasePool(),
      options.getLifecycle(),
    );
    const batch = operationalSignalBatch(snapshot);
    // Structured logs provide an immediately deployable, privacy-safe signal
    // stream. An external metrics adapter remains explicitly disconnected until
    // deployment composition installs and verifies one.
    options.logger.info(
      {
        operationalSignalBatch: batch,
        operationalSignals: snapshot,
      },
      "Operational signals",
    );
    if (
      metricsAdapter?.status === "connected" &&
      !inFlight &&
      !metricsDeliverySuppressed
    ) {
      inFlight = true;
      const adapter = metricsAdapter;
      const controller = new AbortController();
      activeController = controller;
      let timedOut = false;
      const providerPublish = adapter.publish(batch, {
        signal: controller.signal,
      });
      const deadline = setTimeout(() => {
        timedOut = true;
        metricsDeliveryHealthy = false;
        // If the provider ignores AbortSignal, permanently suppress it until
        // deployment composition installs a fresh verified adapter. This
        // bounds the process to one unresolved provider operation.
        metricsDeliverySuppressed = true;
        const error = new Error("Operational signal publish timed out");
        controller.abort(error);
        options.logger.error(
          { err: error },
          "Operational signals adapter publish failed",
        );
      }, publishDeadlineMillis);
      deadline.unref();
      void providerPublish
        .then(() => {
          if (!stopped && !timedOut) metricsDeliveryHealthy = true;
        })
        .catch((error: unknown) => {
          metricsDeliveryHealthy = false;
          if (!stopped && !timedOut) {
            options.logger.error(
              { err: error },
              "Operational signals adapter publish failed",
            );
          }
        })
        .finally(() => {
          clearTimeout(deadline);
          if (activeController === controller) activeController = undefined;
          inFlight = false;
        });
    } else if (metricsAdapter?.status === "connected" && inFlight) {
      metricsDeliveryHealthy = false;
      options.logger.warn(
        { publishDeadlineMillis },
        "Operational signals adapter publish is still in flight",
      );
    }
  };
  publish();
  const scheduler: HeartbeatScheduler = options.scheduler ?? {
    clear: (handle) => clearInterval(handle as NodeJS.Timeout),
    set: (callback, milliseconds) => setInterval(callback, milliseconds),
  };
  const interval = scheduler.set(publish, intervalMillis);
  interval.unref();
  return () => {
    stopped = true;
    metricsDeliveryHealthy = false;
    metricsDeliverySuppressed = true;
    activeController?.abort(new Error("Operational signal heartbeat stopped"));
    scheduler.clear(interval);
  };
}
