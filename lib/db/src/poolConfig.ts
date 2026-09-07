import type { PoolConfig } from "pg";

interface IntegerBudget {
  readonly defaultValue: number;
  readonly maximum: number;
  readonly minimum: number;
}

const BUDGETS = {
  connectionTimeoutMillis: {
    defaultValue: 5_000,
    minimum: 250,
    maximum: 30_000,
  },
  idleTimeoutMillis: {
    defaultValue: 30_000,
    minimum: 1_000,
    maximum: 600_000,
  },
  lockTimeoutMillis: {
    defaultValue: 5_000,
    minimum: 250,
    maximum: 60_000,
  },
  maxLifetimeSeconds: {
    defaultValue: 1_800,
    minimum: 60,
    maximum: 86_400,
  },
  poolMax: { defaultValue: 10, minimum: 2, maximum: 100 },
  queryTimeoutMillis: {
    defaultValue: 35_000,
    minimum: 1_000,
    maximum: 600_000,
  },
  statementTimeoutMillis: {
    defaultValue: 30_000,
    minimum: 1_000,
    maximum: 300_000,
  },
  transactionIdleTimeoutMillis: {
    // Tenant context currently spans the complete HTTP workflow. Keep this
    // above the statement budget so bounded provider/storage work can finish,
    // while still terminating abandoned request transactions.
    defaultValue: 300_000,
    minimum: 30_000,
    maximum: 900_000,
  },
} satisfies Record<string, IntegerBudget>;

const CONNECTION_STRING_POLICY_KEYS = new Set([
  "application_name",
  "connect_timeout",
  "idle_in_transaction_session_timeout",
  "keepalives",
  "keepalives_idle",
  "lock_timeout",
  "options",
  "query_timeout",
  "statement_timeout",
]);

function assertConnectionStringCannotOverrideBudgets(
  connectionString: string,
): void {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    // The security selector owns the canonical malformed-URL error in
    // production; node-postgres will reject malformed development URLs.
    return;
  }
  const conflicting = Array.from(url.searchParams.keys()).filter((key) =>
    CONNECTION_STRING_POLICY_KEYS.has(key.toLocaleLowerCase("en-US")),
  );
  if (conflicting.length > 0) {
    throw new Error(
      "Database URL cannot override runtime connection or query budgets",
    );
  }
}

function integerFromEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
  budget: IntegerBudget,
): number {
  const raw = environment[name];
  if (raw === undefined || raw.trim() === "") return budget.defaultValue;
  if (!/^\d+$/u.test(raw)) {
    throw new Error(`${name} must be a whole number`);
  }
  const value = Number(raw);
  if (
    !Number.isSafeInteger(value) ||
    value < budget.minimum ||
    value > budget.maximum
  ) {
    throw new Error(
      `${name} must be between ${budget.minimum} and ${budget.maximum}`,
    );
  }
  return value;
}

/**
 * Build explicit, bounded node-postgres settings for the API runtime.
 *
 * Server-side statement/lock/idle-transaction limits remain authoritative if
 * a caller forgets its own deadline. The slightly longer client query timeout
 * gives PostgreSQL time to return the server-side cancellation cleanly.
 */
export function createRuntimePoolConfig(
  connectionString: string,
  environment: NodeJS.ProcessEnv = process.env,
): PoolConfig {
  // node-postgres applies connection-string query parameters after explicit
  // PoolConfig fields. Reject policy-bearing URL parameters so managed URLs
  // cannot silently disable these fail-closed runtime budgets.
  assertConnectionStringCannotOverrideBudgets(connectionString);
  const statementTimeoutMillis = integerFromEnvironment(
    environment,
    "VALO_DB_STATEMENT_TIMEOUT_MS",
    BUDGETS.statementTimeoutMillis,
  );
  const queryTimeoutMillis = integerFromEnvironment(
    environment,
    "VALO_DB_QUERY_TIMEOUT_MS",
    BUDGETS.queryTimeoutMillis,
  );
  const transactionIdleTimeoutMillis = integerFromEnvironment(
    environment,
    "VALO_DB_IDLE_TRANSACTION_TIMEOUT_MS",
    BUDGETS.transactionIdleTimeoutMillis,
  );
  if (queryTimeoutMillis < statementTimeoutMillis) {
    throw new Error(
      "VALO_DB_QUERY_TIMEOUT_MS must be greater than or equal to VALO_DB_STATEMENT_TIMEOUT_MS",
    );
  }
  if (transactionIdleTimeoutMillis < statementTimeoutMillis) {
    throw new Error(
      "VALO_DB_IDLE_TRANSACTION_TIMEOUT_MS must be greater than or equal to VALO_DB_STATEMENT_TIMEOUT_MS",
    );
  }

  return {
    application_name: "bidbox-api",
    connectionString,
    connectionTimeoutMillis: integerFromEnvironment(
      environment,
      "VALO_DB_CONNECTION_TIMEOUT_MS",
      BUDGETS.connectionTimeoutMillis,
    ),
    idleTimeoutMillis: integerFromEnvironment(
      environment,
      "VALO_DB_POOL_IDLE_TIMEOUT_MS",
      BUDGETS.idleTimeoutMillis,
    ),
    idle_in_transaction_session_timeout: transactionIdleTimeoutMillis,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    lock_timeout: integerFromEnvironment(
      environment,
      "VALO_DB_LOCK_TIMEOUT_MS",
      BUDGETS.lockTimeoutMillis,
    ),
    max: integerFromEnvironment(
      environment,
      "VALO_DB_POOL_MAX",
      BUDGETS.poolMax,
    ),
    maxLifetimeSeconds: integerFromEnvironment(
      environment,
      "VALO_DB_POOL_MAX_LIFETIME_SECONDS",
      BUDGETS.maxLifetimeSeconds,
    ),
    query_timeout: queryTimeoutMillis,
    statement_timeout: statementTimeoutMillis,
  };
}

/**
 * Coalesce dependency probes and bound what callers wait for. The underlying
 * query may finish after a caller's deadline, but only one query can remain in
 * flight, so a failing/saturated dependency cannot grow the pool queue.
 */
export function createSingleFlightReadinessProbe(
  run: () => Promise<unknown>,
  options: { cacheMillis?: number; now?: () => number } = {},
): (timeoutMillis: number) => Promise<boolean> {
  const cacheMillis = options.cacheMillis ?? 1_000;
  if (
    !Number.isSafeInteger(cacheMillis) ||
    cacheMillis < 0 ||
    cacheMillis > 5_000
  ) {
    throw new Error("Readiness probe cache must be between 0 and 5000 ms");
  }
  const now = options.now ?? Date.now;
  let inFlight: Promise<boolean> | undefined;
  let cached: { expiresAt: number; result: boolean } | undefined;
  return async (timeoutMillis) => {
    if (cached && cached.expiresAt > now()) return cached.result;
    if (!inFlight) {
      inFlight = run()
        .then(() => true)
        .catch(() => false)
        .then((result) => {
          cached = { expiresAt: now() + cacheMillis, result };
          return result;
        })
        .finally(() => {
          inFlight = undefined;
        });
    }
    const activeProbe = inFlight;
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        activeProbe,
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), timeoutMillis);
          timer.unref();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

export function createIdempotentAsyncCloser(
  close: () => Promise<void>,
): () => Promise<void> {
  let closing: Promise<void> | undefined;
  return () => {
    closing ??= close();
    return closing;
  };
}
