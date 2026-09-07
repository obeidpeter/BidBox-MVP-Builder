import { sql, type SQL } from "drizzle-orm";

type AdvisoryLockExecutor = {
  execute(query: SQL): Promise<unknown>;
};

export type StableAdvisoryLockKey =
  | `valo.membership-administration:${string}`
  | `valo.document-snapshot-series:${string}`
  | `valo.tender-context:${string}`
  | `valo:canonical-evidence:${string}`
  | `valo-worker:${string}`;

/**
 * Lock identities are part of the cross-release data protocol, not branding.
 * The Valo key must stay unchanged for pre-rename instances. Acquire the
 * temporary BidBox alias second while the initial renamed release may still
 * be running. Separate awaited statements make the order explicit; the caller
 * must supply the surrounding transaction and keep its existing resource order.
 */
export async function lockCompatibleAdvisoryKey(
  transaction: AdvisoryLockExecutor,
  stableKey: StableAdvisoryLockKey,
): Promise<void> {
  const renamedKey = `bidbox${stableKey.slice("valo".length)}`;
  for (const key of [stableKey, renamedKey]) {
    await transaction.execute(sql`
      SELECT pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(${key}, 0)
      )
    `);
  }
}
