import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  lockCompatibleAdvisoryKey,
  type StableAdvisoryLockKey,
} from "./compatibleAdvisoryLock";

test(
  "compatible resource locks contend with both deployed release identities",
  {
    skip: !process.env.DATABASE_URL,
  },
  async (t) => {
    const { pool } = await import("@workspace/db");
    const dialect = new PgDialect();
    const suffix = randomUUID();
    const keys: StableAdvisoryLockKey[] = [
      `valo.membership-administration:${suffix}`,
      `valo.document-snapshot-series:${suffix}:project:source`,
      `valo.tender-context:${suffix}:project`,
      `valo:canonical-evidence:${suffix}:sha256`,
      `valo-worker:${suffix}:capability`,
    ];
    try {
      for (const stableKey of keys) {
        for (const deployedKey of [stableKey, `bidbox${stableKey.slice(4)}`]) {
          await t.test(deployedKey, async () => {
            const holder = await pool.connect();
            const contender = await pool.connect();
            let lockResult: Promise<{ error?: unknown }> | undefined;
            try {
              await holder.query("BEGIN");
              await contender.query("BEGIN");
              await contender.query("SET LOCAL statement_timeout = '5s'");
              await holder.query(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                [deployedKey],
              );
              const pid = (
                await contender.query<{ pid: number }>(
                  "SELECT pg_backend_pid() AS pid",
                )
              ).rows[0]!.pid;
              lockResult = lockCompatibleAdvisoryKey(
                {
                  execute(query) {
                    const compiled = dialect.sqlToQuery(query);
                    return contender.query(compiled.sql, compiled.params);
                  },
                },
                stableKey,
              ).then(
                () => ({}),
                (error: unknown) => ({ error }),
              );

              let waiting = false;
              const deadline = Date.now() + 2_000;
              while (!waiting && Date.now() < deadline) {
                const result = await holder.query<{ waiting: boolean }>(
                  "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid = $1 AND locktype = 'advisory' AND NOT granted) AS waiting",
                  [pid],
                );
                waiting = result.rows[0]!.waiting;
                if (!waiting) await delay(10);
              }
              assert.ok(
                waiting,
                `new instance did not wait for ${deployedKey}`,
              );
              await holder.query("ROLLBACK");
              assert.deepEqual(await lockResult, {});
            } finally {
              await holder.query("ROLLBACK");
              if (lockResult) await lockResult;
              await contender.query("ROLLBACK");
              holder.release();
              contender.release();
            }
          });
        }
      }
    } finally {
      await pool.end();
    }
  },
);
