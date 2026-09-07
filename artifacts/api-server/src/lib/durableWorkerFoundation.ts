import { createHash } from "node:crypto";
import { processingJobs, processingRuns } from "@workspace/db/schema";
import {
  and,
  asc,
  count,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import {
  appendTransactionalOutboxTx,
  type TransactionalOutboxEvent,
  type TransactionalOutboxIntent,
} from "./transactionalOutbox";
import { isOneOf } from "./typeGuards";

async function appendAuditTx(
  tx: Parameters<
    Parameters<(typeof import("@workspace/db"))["db"]["transaction"]>[0]
  >[0],
  params: import("./audit").AuditParams,
): Promise<void> {
  const { writeAuditTx } = await import("./audit");
  await writeAuditTx(tx, params);
}

export const DURABLE_WORKER_FOUNDATION_STATUS = Object.freeze({
  persistenceImplemented: true,
  userAuthenticatedControlRouteMounted: false,
  workloadIdentityConnected: false,
  arbitraryPayloadPersistenceImplemented: false,
  referenceOnlyInputs: true,
  externalProviderInvocationAllowed: false,
  globalClaimAllowed: false,
  activation: "internal-capabilities-only" as const,
});

/**
 * Fairness is deliberately an interface contract, not a misleading global
 * SQL claim. The dispatcher must rotate eligible tenant/capability scopes; the
 * repository only claims within the supplied scope and uses FIFO within each
 * numeric priority. That makes cross-tenant scheduling observable and prevents
 * a high-volume tenant from winning an unscoped database race.
 */
export const TENANT_CAPABILITY_FAIRNESS_CONTRACT = Object.freeze({
  dispatcher: "deficit-round-robin-by-organisation-and-capability" as const,
  claimScope: "one-organisation-one-capability" as const,
  withinScopeOrder: [
    "priority-ascending",
    "available-at-ascending",
    "created-at-ascending",
    "id-ascending",
  ] as const,
  globalClaimSupported: false,
});

export type WorkerJob = typeof processingJobs.$inferSelect;
export type WorkerRun = typeof processingRuns.$inferSelect;

export interface WorkerScope {
  organisationId: string;
  projectId?: string | null;
}

export interface WorkerCapabilityPolicy {
  /** Immutable and versioned, for example `documents.thumbnail@v1`. */
  id: string;
  effectClass: "internal_deterministic" | "external_provider";
  requiresProject: boolean;
  requiresDocumentVersion: boolean;
  maxQueuedPerTenant: number;
  maxRunningPerTenant: number;
  maxAttempts: number;
  leaseMs: number;
  deadlineMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
  retryableErrorCodes: readonly string[];
}

export interface WorkerClaim {
  job: WorkerJob;
  run: WorkerRun;
  fenceToken: number;
  deadlineAt: Date;
  effectInvocationAllowed: true;
}

export interface WorkerSuccess {
  job: WorkerJob;
  run: WorkerRun;
  outboxEvent?: TransactionalOutboxEvent;
}

export interface WorkerTransition {
  job: WorkerJob;
  run?: WorkerRun;
}

export type DurableWorkerErrorCode =
  | "invalid_scope"
  | "invalid_input"
  | "unknown_capability"
  | "provider_disconnected"
  | "admission_exceeded"
  | "not_found_or_not_authorized"
  | "no_work_available"
  | "stale_fence"
  | "invalid_transition"
  | "lease_mismatch"
  | "lease_not_expired"
  | "deadline_exceeded"
  | "attempts_exhausted"
  | "persistence_conflict";

export class DurableWorkerError extends Error {
  constructor(readonly code: DurableWorkerErrorCode) {
    super(code);
    this.name = "DurableWorkerError";
  }
}

export interface DurableWorkerEnqueueInput extends WorkerScope {
  capability: string;
  idempotencyDigest: string;
  documentVersionId?: string | null;
  priority?: number;
  availableAt?: Date;
}

export interface DurableWorkerClaimInput extends WorkerScope {
  capability: string;
  workerId: string;
  inputHash: string;
}

export interface DurableWorkerHeartbeatInput extends WorkerScope {
  jobId: string;
  runId: string;
  workerId: string;
  fenceToken: number;
  progressPercent: number;
}

export interface DurableWorkerSucceedInput extends WorkerScope {
  jobId: string;
  runId: string;
  workerId: string;
  fenceToken: number;
  outputHash: string;
  outbox?: Omit<
    TransactionalOutboxIntent,
    "organisationId" | "projectId" | "aggregateId"
  > & { aggregateId?: string };
}

export interface DurableWorkerFailInput extends WorkerScope {
  jobId: string;
  runId: string;
  workerId: string;
  fenceToken: number;
  errorCode: string;
}

export interface DurableWorkerCancelInput extends WorkerScope {
  jobId: string;
  fenceToken: number;
  reasonCode: string;
  actorUserId?: string | null;
}

export interface DurableWorkerRecoverInput extends WorkerScope {
  jobId: string;
  fenceToken: number;
}

interface RepositoryEnqueueInput extends DurableWorkerEnqueueInput {
  idempotencyKey: string;
  policy: WorkerCapabilityPolicy;
  priority: number;
  availableAt: Date;
  now: Date;
}

interface RepositoryClaimInput extends DurableWorkerClaimInput {
  policy: WorkerCapabilityPolicy;
  now: Date;
}

interface RepositoryHeartbeatInput extends DurableWorkerHeartbeatInput {
  now: Date;
  leaseExpiresAt: Date;
  deadlineAt: Date;
}

interface RepositorySucceedInput extends DurableWorkerSucceedInput {
  now: Date;
  deadlineAt: Date;
  outboxIntent?: TransactionalOutboxIntent;
}

interface RepositoryFailInput extends DurableWorkerFailInput {
  now: Date;
  nextStatus: "failed" | "retry_wait" | "dead_letter";
  availableAt: Date;
}

interface RepositoryCancelInput extends DurableWorkerCancelInput {
  now: Date;
  expectedStatus: string;
}

interface RepositoryRecoverInput extends DurableWorkerRecoverInput {
  now: Date;
  expectedStatus: "queued" | "retry_wait" | "running";
  nextStatus: "retry_wait" | "dead_letter";
  availableAt: Date;
  deadlineExpired: boolean;
}

export interface DurableWorkerRepository {
  enqueue(input: RepositoryEnqueueInput): Promise<WorkerJob>;
  findJob(scope: WorkerScope, jobId: string): Promise<WorkerJob | null>;
  claimNext(input: RepositoryClaimInput): Promise<WorkerClaim | null>;
  heartbeat(input: RepositoryHeartbeatInput): Promise<WorkerJob | null>;
  succeed(input: RepositorySucceedInput): Promise<WorkerSuccess | null>;
  fail(input: RepositoryFailInput): Promise<WorkerTransition | null>;
  cancel(input: RepositoryCancelInput): Promise<WorkerTransition | null>;
  recover(input: RepositoryRecoverInput): Promise<WorkerTransition | null>;
}

import {
  SHA256_HEX_PATTERN as SHA256,
  UUID_V1_5_PATTERN as UUID,
} from "./identifierPatterns";
const CONTROL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CAPABILITY = /^[a-z][a-z0-9_.:-]{1,95}@v[1-9][0-9]{0,5}$/;

function validInteger(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
  );
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function assertScope(scope: WorkerScope): void {
  if (
    !UUID.test(scope.organisationId) ||
    (scope.projectId != null && !UUID.test(scope.projectId))
  ) {
    throw new DurableWorkerError("invalid_scope");
  }
}

function assertFence(value: number): void {
  if (!validInteger(value, 1, Number.MAX_SAFE_INTEGER)) {
    throw new DurableWorkerError("invalid_input");
  }
}

function assertJobControl(input: {
  jobId: string;
  workerId?: string;
  runId?: string;
  fenceToken: number;
}): void {
  assertFence(input.fenceToken);
  if (
    !UUID.test(input.jobId) ||
    (input.runId != null && !UUID.test(input.runId)) ||
    (input.workerId != null && !CONTROL.test(input.workerId))
  ) {
    throw new DurableWorkerError("invalid_input");
  }
}

function validatePolicy(policy: WorkerCapabilityPolicy): void {
  if (
    !CAPABILITY.test(policy.id) ||
    (policy.effectClass !== "internal_deterministic" &&
      policy.effectClass !== "external_provider") ||
    typeof policy.requiresProject !== "boolean" ||
    typeof policy.requiresDocumentVersion !== "boolean" ||
    !validInteger(policy.maxQueuedPerTenant, 1, 100_000) ||
    !validInteger(policy.maxRunningPerTenant, 1, 10_000) ||
    !validInteger(policy.maxAttempts, 1, 10) ||
    !validInteger(policy.leaseMs, 5_000, 300_000) ||
    !validInteger(policy.deadlineMs, policy.leaseMs, 30 * 24 * 60 * 60_000) ||
    !validInteger(policy.retryBaseMs, 1_000, 60 * 60_000) ||
    !validInteger(policy.retryMaxMs, policy.retryBaseMs, 24 * 60 * 60_000) ||
    policy.retryableErrorCodes.length > 50 ||
    policy.retryableErrorCodes.some((code) => !CONTROL.test(code))
  ) {
    throw new DurableWorkerError("invalid_input");
  }
}

function deterministicRetryDelay(
  job: WorkerJob,
  policy: WorkerCapabilityPolicy,
): number {
  const exponential = Math.min(
    policy.retryMaxMs,
    policy.retryBaseMs * 2 ** Math.max(0, job.attempts - 1),
  );
  const digest = createHash("sha256")
    .update(`${job.idempotencyKey}\0${job.attempts}`)
    .digest();
  return Math.min(
    policy.retryMaxMs,
    exponential +
      (digest.readUInt16BE(0) % Math.max(1, Math.floor(exponential / 5))),
  );
}

function deadlineFor(job: WorkerJob, policy: WorkerCapabilityPolicy): Date {
  return new Date(job.createdAt.getTime() + policy.deadlineMs);
}

function workerIdempotencyKey(input: DurableWorkerEnqueueInput): string {
  return createHash("sha256")
    .update(
      [
        "valo-durable-worker-v1",
        input.organisationId,
        input.projectId ?? "-",
        input.capability,
        input.documentVersionId ?? "-",
        input.idempotencyDigest,
      ].join("\0"),
    )
    .digest("hex");
}

export class DurableWorkerService {
  private readonly policies = new Map<string, WorkerCapabilityPolicy>();

  constructor(
    private readonly repository: DurableWorkerRepository,
    policies: readonly WorkerCapabilityPolicy[],
    private readonly now: () => Date = () => new Date(),
  ) {
    for (const policy of policies) {
      validatePolicy(policy);
      if (this.policies.has(policy.id)) {
        throw new DurableWorkerError("invalid_input");
      }
      this.policies.set(policy.id, Object.freeze({ ...policy }));
    }
  }

  private policy(capability: string): WorkerCapabilityPolicy {
    const policy = this.policies.get(capability);
    if (!policy) throw new DurableWorkerError("unknown_capability");
    return policy;
  }

  private async currentJob(
    scope: WorkerScope,
    jobId: string,
    fenceToken: number,
  ): Promise<WorkerJob> {
    const job = await this.repository.findJob(scope, jobId);
    if (!job) throw new DurableWorkerError("not_found_or_not_authorized");
    if (job.version !== fenceToken) throw new DurableWorkerError("stale_fence");
    return job;
  }

  async enqueue(input: DurableWorkerEnqueueInput): Promise<WorkerJob> {
    assertScope(input);
    const policy = this.policy(input.capability);
    const now = this.now();
    const priority = input.priority ?? 100;
    const availableAt = input.availableAt ?? now;
    if (
      !SHA256.test(input.idempotencyDigest) ||
      (input.documentVersionId != null &&
        !UUID.test(input.documentVersionId)) ||
      !validInteger(priority, 0, 1_000) ||
      !validDate(availableAt) ||
      availableAt.getTime() < now.getTime() - 60_000 ||
      availableAt.getTime() >= now.getTime() + policy.deadlineMs ||
      (policy.requiresProject && input.projectId == null) ||
      (policy.requiresDocumentVersion && input.documentVersionId == null)
    ) {
      throw new DurableWorkerError("invalid_input");
    }
    return this.repository.enqueue({
      ...input,
      policy,
      idempotencyKey: workerIdempotencyKey(input),
      priority,
      availableAt,
      now,
    });
  }

  async claimNext(input: DurableWorkerClaimInput): Promise<WorkerClaim> {
    assertScope(input);
    const policy = this.policy(input.capability);
    if (policy.effectClass === "external_provider") {
      throw new DurableWorkerError("provider_disconnected");
    }
    if (!CONTROL.test(input.workerId) || !SHA256.test(input.inputHash)) {
      throw new DurableWorkerError("invalid_input");
    }
    const result = await this.repository.claimNext({
      ...input,
      policy,
      now: this.now(),
    });
    if (!result) throw new DurableWorkerError("no_work_available");
    return result;
  }

  async heartbeat(input: DurableWorkerHeartbeatInput): Promise<WorkerJob> {
    assertScope(input);
    assertJobControl(input);
    if (!validInteger(input.progressPercent, 0, 99)) {
      throw new DurableWorkerError("invalid_input");
    }
    const now = this.now();
    const job = await this.currentJob(input, input.jobId, input.fenceToken);
    const policy = this.policy(job.jobType);
    const deadlineAt = deadlineFor(job, policy);
    if (deadlineAt.getTime() <= now.getTime()) {
      throw new DurableWorkerError("deadline_exceeded");
    }
    if (
      job.status !== "running" ||
      job.leaseOwner !== input.workerId ||
      job.leaseExpiresAt == null ||
      job.leaseExpiresAt.getTime() <= now.getTime()
    ) {
      throw new DurableWorkerError("lease_mismatch");
    }
    if (input.progressPercent < job.progressPercent) {
      throw new DurableWorkerError("invalid_transition");
    }
    const leaseExpiresAt = new Date(
      Math.min(now.getTime() + policy.leaseMs, deadlineAt.getTime()),
    );
    const updated = await this.repository.heartbeat({
      ...input,
      projectId: job.projectId,
      now,
      leaseExpiresAt,
      deadlineAt,
    });
    if (!updated) throw new DurableWorkerError("persistence_conflict");
    return updated;
  }

  async succeed(input: DurableWorkerSucceedInput): Promise<WorkerSuccess> {
    assertScope(input);
    assertJobControl(input);
    if (!SHA256.test(input.outputHash))
      throw new DurableWorkerError("invalid_input");
    const now = this.now();
    const job = await this.currentJob(input, input.jobId, input.fenceToken);
    const policy = this.policy(job.jobType);
    const deadlineAt = deadlineFor(job, policy);
    if (deadlineAt.getTime() <= now.getTime())
      throw new DurableWorkerError("deadline_exceeded");
    if (
      job.status !== "running" ||
      job.leaseOwner !== input.workerId ||
      job.leaseExpiresAt == null ||
      job.leaseExpiresAt.getTime() <= now.getTime()
    ) {
      throw new DurableWorkerError("lease_mismatch");
    }
    const outboxIntent = input.outbox
      ? {
          ...input.outbox,
          organisationId: input.organisationId,
          projectId: job.projectId,
          aggregateId: input.outbox.aggregateId ?? input.jobId,
        }
      : undefined;
    const result = await this.repository.succeed({
      ...input,
      projectId: job.projectId,
      now,
      deadlineAt,
      outboxIntent,
    });
    if (!result) throw new DurableWorkerError("persistence_conflict");
    return result;
  }

  async fail(input: DurableWorkerFailInput): Promise<WorkerTransition> {
    assertScope(input);
    assertJobControl(input);
    if (!CONTROL.test(input.errorCode))
      throw new DurableWorkerError("invalid_input");
    const now = this.now();
    const job = await this.currentJob(input, input.jobId, input.fenceToken);
    const policy = this.policy(job.jobType);
    const deadlineAt = deadlineFor(job, policy);
    if (
      job.status !== "running" ||
      job.leaseOwner !== input.workerId ||
      job.leaseExpiresAt == null ||
      job.leaseExpiresAt.getTime() <= now.getTime()
    ) {
      throw new DurableWorkerError("lease_mismatch");
    }
    const retryable = policy.retryableErrorCodes.includes(input.errorCode);
    const exhausted = job.attempts >= job.maxAttempts;
    const deadlineExpired = deadlineAt.getTime() <= now.getTime();
    const nextStatus = retryable
      ? exhausted || deadlineExpired
        ? "dead_letter"
        : "retry_wait"
      : "failed";
    const availableAt =
      nextStatus === "retry_wait"
        ? new Date(now.getTime() + deterministicRetryDelay(job, policy))
        : now;
    const result = await this.repository.fail({
      ...input,
      projectId: job.projectId,
      now,
      nextStatus,
      availableAt,
    });
    if (!result) throw new DurableWorkerError("persistence_conflict");
    return result;
  }

  async cancel(input: DurableWorkerCancelInput): Promise<WorkerTransition> {
    assertScope(input);
    assertJobControl(input);
    if (
      !CONTROL.test(input.reasonCode) ||
      (input.actorUserId != null && !UUID.test(input.actorUserId))
    ) {
      throw new DurableWorkerError("invalid_input");
    }
    const job = await this.currentJob(input, input.jobId, input.fenceToken);
    if (["succeeded", "dead_letter", "cancelled"].includes(job.status)) {
      throw new DurableWorkerError("invalid_transition");
    }
    const result = await this.repository.cancel({
      ...input,
      projectId: job.projectId,
      expectedStatus: job.status,
      now: this.now(),
    });
    if (!result) throw new DurableWorkerError("persistence_conflict");
    return result;
  }

  async recover(input: DurableWorkerRecoverInput): Promise<WorkerTransition> {
    assertScope(input);
    assertJobControl(input);
    const now = this.now();
    const job = await this.currentJob(input, input.jobId, input.fenceToken);
    const policy = this.policy(job.jobType);
    const deadlineExpired = deadlineFor(job, policy).getTime() <= now.getTime();
    const leaseExpired =
      job.status === "running" &&
      job.leaseExpiresAt != null &&
      job.leaseExpiresAt.getTime() <= now.getTime();
    if (!deadlineExpired && !leaseExpired) {
      throw new DurableWorkerError("lease_not_expired");
    }
    if (!isOneOf(job.status, ["queued", "retry_wait", "running"])) {
      throw new DurableWorkerError("invalid_transition");
    }
    const nextStatus =
      deadlineExpired || job.attempts >= job.maxAttempts
        ? "dead_letter"
        : "retry_wait";
    const availableAt =
      nextStatus === "retry_wait"
        ? new Date(now.getTime() + deterministicRetryDelay(job, policy))
        : now;
    const result = await this.repository.recover({
      ...input,
      projectId: job.projectId,
      expectedStatus: job.status,
      now,
      nextStatus,
      availableAt,
      deadlineExpired,
    });
    if (!result) throw new DurableWorkerError("persistence_conflict");
    return result;
  }
}

function projectPredicate(projectId: string | null | undefined) {
  if (projectId === undefined) return undefined;
  return projectId === null
    ? isNull(processingJobs.projectId)
    : eq(processingJobs.projectId, projectId);
}

function admissionLockKey(organisationId: string, capability: string): string {
  return `bidbox-worker:${organisationId}:${capability}`;
}

export class DrizzleDurableWorkerRepository implements DurableWorkerRepository {
  async enqueue(input: RepositoryEnqueueInput): Promise<WorkerJob> {
    const database = (await import("@workspace/db")).db;
    return database.transaction(
      async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${admissionLockKey(input.organisationId, input.capability)}, 0))`,
        );
        const [existing] = await tx
          .select()
          .from(processingJobs)
          .where(
            and(
              eq(processingJobs.organisationId, input.organisationId),
              eq(processingJobs.idempotencyKey, input.idempotencyKey),
            ),
          );
        if (existing) {
          if (
            existing.jobType !== input.capability ||
            existing.projectId !== (input.projectId ?? null) ||
            existing.documentVersionId !== (input.documentVersionId ?? null)
          ) {
            throw new DurableWorkerError("persistence_conflict");
          }
          return existing;
        }
        const [queued] = await tx
          .select({ value: count() })
          .from(processingJobs)
          .where(
            and(
              eq(processingJobs.organisationId, input.organisationId),
              eq(processingJobs.jobType, input.capability),
              inArray(processingJobs.status, ["queued", "retry_wait"]),
            ),
          );
        if ((queued?.value ?? 0) >= input.policy.maxQueuedPerTenant) {
          throw new DurableWorkerError("admission_exceeded");
        }
        const [job] = await tx
          .insert(processingJobs)
          .values({
            organisationId: input.organisationId,
            projectId: input.projectId ?? null,
            documentVersionId: input.documentVersionId ?? null,
            jobType: input.capability,
            idempotencyKey: input.idempotencyKey,
            status: "queued",
            priority: input.priority,
            attempts: 0,
            maxAttempts: input.policy.maxAttempts,
            availableAt: input.availableAt,
            progressPercent: 0,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .returning();
        if (!job) throw new DurableWorkerError("persistence_conflict");
        await appendAuditTx(tx, {
          organisationId: input.organisationId,
          projectId: input.projectId ?? null,
          eventType: "worker.job_enqueued",
          objectType: "processing_job",
          objectId: job.id,
          details: JSON.stringify({ capability: input.capability }),
        });
        return job;
      },
      { isolationLevel: "read committed" },
    );
  }

  async findJob(scope: WorkerScope, jobId: string): Promise<WorkerJob | null> {
    const database = (await import("@workspace/db")).db;
    const [job] = await database
      .select()
      .from(processingJobs)
      .where(
        and(
          eq(processingJobs.id, jobId),
          eq(processingJobs.organisationId, scope.organisationId),
          projectPredicate(scope.projectId),
        ),
      );
    return job ?? null;
  }

  async claimNext(input: RepositoryClaimInput): Promise<WorkerClaim | null> {
    const database = (await import("@workspace/db")).db;
    return database.transaction(
      async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${admissionLockKey(input.organisationId, input.capability)}, 0))`,
        );
        const [running] = await tx
          .select({ value: count() })
          .from(processingJobs)
          .where(
            and(
              eq(processingJobs.organisationId, input.organisationId),
              eq(processingJobs.jobType, input.capability),
              eq(processingJobs.status, "running"),
            ),
          );
        if ((running?.value ?? 0) >= input.policy.maxRunningPerTenant)
          return null;
        const deadlineCutoff = new Date(
          input.now.getTime() - input.policy.deadlineMs,
        );
        const [candidate] = await tx
          .select()
          .from(processingJobs)
          .where(
            and(
              eq(processingJobs.organisationId, input.organisationId),
              projectPredicate(input.projectId),
              eq(processingJobs.jobType, input.capability),
              inArray(processingJobs.status, ["queued", "retry_wait"]),
              lte(processingJobs.availableAt, input.now),
              gt(processingJobs.createdAt, deadlineCutoff),
            ),
          )
          .orderBy(
            asc(processingJobs.priority),
            asc(processingJobs.availableAt),
            asc(processingJobs.createdAt),
            asc(processingJobs.id),
          )
          .limit(1)
          .for("update", { skipLocked: true });
        if (!candidate || candidate.attempts >= candidate.maxAttempts)
          return null;
        const deadlineAt = deadlineFor(candidate, input.policy);
        const fenceToken = candidate.version + 1;
        const leaseExpiresAt = new Date(
          Math.min(
            input.now.getTime() + input.policy.leaseMs,
            deadlineAt.getTime(),
          ),
        );
        const [job] = await tx
          .update(processingJobs)
          .set({
            status: "running",
            attempts: candidate.attempts + 1,
            leaseOwner: input.workerId,
            leaseExpiresAt,
            version: fenceToken,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(processingJobs.id, candidate.id),
              eq(processingJobs.version, candidate.version),
              eq(processingJobs.status, candidate.status),
            ),
          )
          .returning();
        if (!job) throw new DurableWorkerError("persistence_conflict");
        const [run] = await tx
          .insert(processingRuns)
          .values({
            organisationId: input.organisationId,
            jobId: job.id,
            runType: input.capability,
            provider: "internal-worker",
            inputHash: input.inputHash,
            status: "running",
            startedAt: input.now,
          })
          .returning();
        if (!run) throw new DurableWorkerError("persistence_conflict");
        await appendAuditTx(tx, {
          organisationId: input.organisationId,
          projectId: input.projectId ?? null,
          eventType: "worker.job_claimed",
          objectType: "processing_job",
          objectId: job.id,
          details: JSON.stringify({ runId: run.id, attempt: job.attempts }),
        });
        return {
          job,
          run,
          fenceToken,
          deadlineAt,
          effectInvocationAllowed: true as const,
        };
      },
      { isolationLevel: "read committed" },
    );
  }

  async heartbeat(input: RepositoryHeartbeatInput): Promise<WorkerJob | null> {
    const database = (await import("@workspace/db")).db;
    const [job] = await database
      .update(processingJobs)
      .set({
        progressPercent: input.progressPercent,
        leaseExpiresAt: input.leaseExpiresAt,
        version: input.fenceToken + 1,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(processingJobs.id, input.jobId),
          eq(processingJobs.organisationId, input.organisationId),
          projectPredicate(input.projectId),
          eq(processingJobs.status, "running"),
          eq(processingJobs.version, input.fenceToken),
          eq(processingJobs.leaseOwner, input.workerId),
          gt(processingJobs.leaseExpiresAt, input.now),
          lte(processingJobs.progressPercent, input.progressPercent),
          sql<boolean>`EXISTS (
            SELECT 1 FROM ${processingRuns}
            WHERE ${processingRuns.id} = ${input.runId}::uuid
              AND ${processingRuns.organisationId} = ${input.organisationId}::uuid
              AND ${processingRuns.jobId} = ${input.jobId}::uuid
              AND ${processingRuns.status} = 'running'
          )`,
        ),
      )
      .returning();
    return job ?? null;
  }

  async succeed(input: RepositorySucceedInput): Promise<WorkerSuccess | null> {
    const database = (await import("@workspace/db")).db;
    return database.transaction(
      async (tx) => {
        const [job] = await tx
          .update(processingJobs)
          .set({
            status: "succeeded",
            progressPercent: 100,
            leaseOwner: null,
            leaseExpiresAt: null,
            lastErrorCode: null,
            lastErrorSummary: null,
            version: input.fenceToken + 1,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(processingJobs.id, input.jobId),
              eq(processingJobs.organisationId, input.organisationId),
              projectPredicate(input.projectId),
              eq(processingJobs.status, "running"),
              eq(processingJobs.version, input.fenceToken),
              eq(processingJobs.leaseOwner, input.workerId),
              gt(processingJobs.leaseExpiresAt, input.now),
            ),
          )
          .returning();
        if (!job) return null;
        const [run] = await tx
          .update(processingRuns)
          .set({
            status: "succeeded",
            outputHash: input.outputHash,
            completedAt: input.now,
          })
          .where(
            and(
              eq(processingRuns.id, input.runId),
              eq(processingRuns.organisationId, input.organisationId),
              eq(processingRuns.jobId, input.jobId),
              eq(processingRuns.status, "running"),
            ),
          )
          .returning();
        if (!run) throw new DurableWorkerError("persistence_conflict");
        const outboxEvent = input.outboxIntent
          ? await appendTransactionalOutboxTx(tx, input.outboxIntent, input.now)
          : undefined;
        await appendAuditTx(tx, {
          organisationId: input.organisationId,
          projectId: input.projectId ?? null,
          eventType: "worker.job_succeeded",
          objectType: "processing_job",
          objectId: job.id,
          details: JSON.stringify({
            runId: run.id,
            outboxEventId: outboxEvent?.id ?? null,
          }),
        });
        return { job, run, ...(outboxEvent ? { outboxEvent } : {}) };
      },
      { isolationLevel: "read committed" },
    );
  }

  async fail(input: RepositoryFailInput): Promise<WorkerTransition | null> {
    const database = (await import("@workspace/db")).db;
    return database.transaction(
      async (tx) => {
        const [job] = await tx
          .update(processingJobs)
          .set({
            status: input.nextStatus,
            availableAt: input.availableAt,
            leaseOwner: null,
            leaseExpiresAt: null,
            lastErrorCode: input.errorCode,
            lastErrorSummary: null,
            version: input.fenceToken + 1,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(processingJobs.id, input.jobId),
              eq(processingJobs.organisationId, input.organisationId),
              projectPredicate(input.projectId),
              eq(processingJobs.status, "running"),
              eq(processingJobs.version, input.fenceToken),
              eq(processingJobs.leaseOwner, input.workerId),
              gt(processingJobs.leaseExpiresAt, input.now),
            ),
          )
          .returning();
        if (!job) return null;
        const [run] = await tx
          .update(processingRuns)
          .set({
            status: "failed",
            errorCode: input.errorCode,
            completedAt: input.now,
          })
          .where(
            and(
              eq(processingRuns.id, input.runId),
              eq(processingRuns.organisationId, input.organisationId),
              eq(processingRuns.jobId, input.jobId),
              eq(processingRuns.status, "running"),
            ),
          )
          .returning();
        if (!run) throw new DurableWorkerError("persistence_conflict");
        await appendAuditTx(tx, {
          organisationId: input.organisationId,
          projectId: input.projectId ?? null,
          eventType: "worker.job_failed",
          objectType: "processing_job",
          objectId: job.id,
          details: JSON.stringify({
            runId: run.id,
            errorCode: input.errorCode,
            nextStatus: input.nextStatus,
          }),
        });
        return { job, run };
      },
      { isolationLevel: "read committed" },
    );
  }

  async cancel(input: RepositoryCancelInput): Promise<WorkerTransition | null> {
    const database = (await import("@workspace/db")).db;
    return database.transaction(
      async (tx) => {
        const [job] = await tx
          .update(processingJobs)
          .set({
            status: "cancelled",
            leaseOwner: null,
            leaseExpiresAt: null,
            lastErrorCode: "WORKER_CANCELLED",
            lastErrorSummary: null,
            version: input.fenceToken + 1,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(processingJobs.id, input.jobId),
              eq(processingJobs.organisationId, input.organisationId),
              projectPredicate(input.projectId),
              eq(processingJobs.version, input.fenceToken),
              eq(processingJobs.status, input.expectedStatus),
            ),
          )
          .returning();
        if (!job) return null;
        const [run] = await tx
          .update(processingRuns)
          .set({
            status: "cancelled",
            errorCode: "WORKER_CANCELLED",
            completedAt: input.now,
          })
          .where(
            and(
              eq(processingRuns.organisationId, input.organisationId),
              eq(processingRuns.jobId, input.jobId),
              eq(processingRuns.status, "running"),
            ),
          )
          .returning();
        if (input.expectedStatus === "running" && !run) {
          throw new DurableWorkerError("persistence_conflict");
        }
        await appendAuditTx(tx, {
          organisationId: input.organisationId,
          projectId: input.projectId ?? null,
          eventType: "worker.job_cancelled",
          objectType: "processing_job",
          objectId: job.id,
          details: JSON.stringify({
            reasonCode: input.reasonCode,
            actorUserId: input.actorUserId ?? null,
          }),
        });
        return { job, ...(run ? { run } : {}) };
      },
      { isolationLevel: "read committed" },
    );
  }

  async recover(
    input: RepositoryRecoverInput,
  ): Promise<WorkerTransition | null> {
    const database = (await import("@workspace/db")).db;
    return database.transaction(
      async (tx) => {
        const [job] = await tx
          .update(processingJobs)
          .set({
            status: input.nextStatus,
            availableAt: input.availableAt,
            leaseOwner: null,
            leaseExpiresAt: null,
            lastErrorCode: input.deadlineExpired
              ? "WORKER_DEADLINE_EXCEEDED"
              : "WORKER_LEASE_EXPIRED",
            lastErrorSummary: null,
            version: input.fenceToken + 1,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(processingJobs.id, input.jobId),
              eq(processingJobs.organisationId, input.organisationId),
              projectPredicate(input.projectId),
              eq(processingJobs.version, input.fenceToken),
              eq(processingJobs.status, input.expectedStatus),
              input.deadlineExpired
                ? undefined
                : lte(processingJobs.leaseExpiresAt, input.now),
            ),
          )
          .returning();
        if (!job) return null;
        const [run] = await tx
          .update(processingRuns)
          .set({
            status: "failed",
            errorCode: input.deadlineExpired
              ? "WORKER_DEADLINE_EXCEEDED"
              : "WORKER_LEASE_EXPIRED",
            completedAt: input.now,
          })
          .where(
            and(
              eq(processingRuns.organisationId, input.organisationId),
              eq(processingRuns.jobId, input.jobId),
              eq(processingRuns.status, "running"),
            ),
          )
          .returning();
        if (input.expectedStatus === "running" && !run) {
          throw new DurableWorkerError("persistence_conflict");
        }
        await appendAuditTx(tx, {
          organisationId: input.organisationId,
          projectId: input.projectId ?? null,
          eventType: "worker.job_recovered",
          objectType: "processing_job",
          objectId: job.id,
          details: JSON.stringify({
            nextStatus: input.nextStatus,
            deadlineExpired: input.deadlineExpired,
          }),
        });
        return { job, ...(run ? { run } : {}) };
      },
      { isolationLevel: "read committed" },
    );
  }
}

export function createDurableWorkerService(input: {
  policies: readonly WorkerCapabilityPolicy[];
  repository?: DurableWorkerRepository;
  now?: () => Date;
}): DurableWorkerService {
  return new DurableWorkerService(
    input.repository ?? new DrizzleDurableWorkerRepository(),
    input.policies,
    input.now,
  );
}
