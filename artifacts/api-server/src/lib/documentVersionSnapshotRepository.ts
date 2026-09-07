import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import {
  db,
  documentVersions,
  documentVersionSnapshots,
  documents,
  organisationMemberships,
  organisations,
  projects,
  roleGrants,
  users,
  vaultItems,
  vaultItemVersions,
} from "@workspace/db";
import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { writeAuditTx } from "./audit";
import {
  ORGANISATION_ROLES,
  isOrganisationRole,
  isRoleAllowedForOrganisation,
  permissionsForRoles,
  type OrganisationType,
  type Permission,
} from "./permissions";
import {
  parseProposedStructuredSnapshot,
  resolveEffectiveStructuredFields,
  selectExactCurrentDocumentVersion,
  type ProposedStructuredSnapshot,
  type StructuredField,
} from "./documentVersionSnapshotPolicy";

type Database = typeof db;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const SHA256 = /^[0-9a-f]{64}$/u;
const PARSER_VERSION = "valo.explicit-structured-proposal/v2";
const MAX_CHAIN = 64;

export interface SnapshotActor {
  readonly organisationId: string;
  readonly userId: string;
  readonly membershipId: string;
  readonly name: string;
}

const CAPTURE_PERMISSIONS = [
  "document:read",
  "requirement:write",
] as const satisfies readonly Permission[];
const REVIEW_PERMISSIONS = [
  "document:read",
  "intelligence:review",
] as const satisfies readonly Permission[];

export interface SnapshotRecord {
  readonly id: string;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly documentVersionSha256: string;
  readonly capturedRedactionStatus: "included" | "redacted";
  readonly canonicalText: string;
  readonly canonicalTextSha256: string;
  readonly structuredSnapshot: ProposedStructuredSnapshot | null;
  readonly structuredSnapshotSha256: string | null;
  readonly extractionMethod: string;
  readonly parserVersion: string;
  readonly status: "captured" | "verified" | "rejected";
  readonly capturedByUserId: string;
  readonly capturedByName: string;
  readonly verifiedByUserId: string | null;
  readonly verifiedByName: string | null;
  readonly verifiedAt: string | null;
  readonly version: number;
  readonly createdAt: string;
}

export interface CurrentSnapshotView {
  readonly documentId: string;
  readonly projectId: string;
  readonly documentVersionId: string;
  readonly documentVersionSha256: string;
  readonly filename: string;
  readonly redactionStatus: string;
  readonly extractionStatus: string;
  readonly canonicalText: string;
  readonly snapshot: SnapshotRecord | null;
}

export type SnapshotWriteResult =
  | {
      readonly outcome: "created" | "existing" | "updated";
      readonly value: SnapshotRecord;
    }
  | {
      readonly outcome:
        | "not_found"
        | "conflict"
        | "state_conflict"
        | "version_conflict";
    };

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function eligibleText(value: string | null): value is string {
  return Boolean(
    value &&
    value.length <= 2_000_000 &&
    Buffer.byteLength(value, "utf8") <= 4_000_000,
  );
}

function eligibleRedaction(value: string): boolean {
  return value === "included" || value === "redacted";
}

async function requireCurrentAuthority(
  transaction: Transaction,
  actor: SnapshotActor,
  required: readonly Permission[],
) {
  await transaction.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(
        ${`bidbox.membership-administration:${actor.organisationId}`},
        0
      )
    )
  `);
  const nowResult = await transaction.execute(
    sql`SELECT clock_timestamp() AS now`,
  );
  const now = new Date(String(nowResult.rows[0]?.now));
  if (!Number.isFinite(now.valueOf())) return null;
  const rows = await transaction
    .select({ actor: users, organisationType: organisations.type })
    .from(organisationMemberships)
    .innerJoin(users, eq(users.id, organisationMemberships.userId))
    .innerJoin(
      organisations,
      eq(organisations.id, organisationMemberships.organisationId),
    )
    .where(
      and(
        eq(organisationMemberships.id, actor.membershipId),
        eq(organisationMemberships.organisationId, actor.organisationId),
        eq(organisationMemberships.userId, actor.userId),
        eq(organisationMemberships.status, "active"),
        isNull(organisationMemberships.delegatedByMembershipId),
        or(
          isNull(organisationMemberships.accessStartsAt),
          lte(organisationMemberships.accessStartsAt, now),
        ),
        or(
          isNull(organisationMemberships.accessExpiresAt),
          gt(organisationMemberships.accessExpiresAt, now),
        ),
        eq(users.status, "active"),
        eq(organisations.status, "active"),
      ),
    )
    .limit(2);
  const authority = rows[0];
  if (rows.length !== 1 || !authority?.actor.name?.trim()) return null;
  const grants = await transaction
    .select({ role: roleGrants.role })
    .from(roleGrants)
    .where(
      and(
        eq(roleGrants.membershipId, actor.membershipId),
        isNull(roleGrants.revokedAt),
        or(isNull(roleGrants.startsAt), lte(roleGrants.startsAt, now)),
        or(isNull(roleGrants.expiresAt), gt(roleGrants.expiresAt, now)),
      ),
    )
    .limit(ORGANISATION_ROLES.length + 1);
  if (grants.length > ORGANISATION_ROLES.length) return null;
  const roles = grants
    .map(({ role }) => role)
    .filter(isOrganisationRole)
    .filter((role) =>
      isRoleAllowedForOrganisation(
        role,
        authority.organisationType as OrganisationType,
      ),
    );
  const permissions = permissionsForRoles(roles);
  return required.every((permission) => permissions.has(permission))
    ? authority.actor
    : null;
}

function parseStored(
  raw: string | null,
  canonicalText: string,
  documentId: string,
  documentVersionId: string,
): ProposedStructuredSnapshot | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  return parseProposedStructuredSnapshot({
    value,
    canonicalText,
    documentId,
    documentVersionId,
  });
}

function materialize(row: {
  document: typeof documents.$inferSelect;
  snapshot: typeof documentVersionSnapshots.$inferSelect;
}): SnapshotRecord {
  const structured = parseStored(
    row.snapshot.structuredSnapshot,
    row.snapshot.canonicalText,
    row.document.id,
    row.snapshot.documentVersionId,
  );
  if (
    !SHA256.test(row.snapshot.documentVersionSha256) ||
    row.snapshot.capturedRedactionStatus !== row.document.redactionStatus ||
    !eligibleRedaction(row.snapshot.capturedRedactionStatus) ||
    sha256(row.snapshot.canonicalText) !== row.snapshot.canonicalTextSha256 ||
    (row.snapshot.structuredSnapshot === null) !==
      (row.snapshot.structuredSnapshotSha256 === null) ||
    (row.snapshot.structuredSnapshot !== null &&
      (!structured ||
        sha256(row.snapshot.structuredSnapshot) !==
          row.snapshot.structuredSnapshotSha256))
  ) {
    throw new Error("Document-version snapshot integrity check failed");
  }
  return {
    id: row.snapshot.id,
    documentId: row.document.id,
    documentVersionId: row.snapshot.documentVersionId,
    documentVersionSha256: row.snapshot.documentVersionSha256,
    capturedRedactionStatus: row.snapshot
      .capturedRedactionStatus as SnapshotRecord["capturedRedactionStatus"],
    canonicalText: row.snapshot.canonicalText,
    canonicalTextSha256: row.snapshot.canonicalTextSha256,
    structuredSnapshot: structured,
    structuredSnapshotSha256: row.snapshot.structuredSnapshotSha256,
    extractionMethod: row.snapshot.extractionMethod,
    parserVersion: row.snapshot.parserVersion,
    status: row.snapshot.status as SnapshotRecord["status"],
    capturedByUserId: row.snapshot.capturedByUserId,
    capturedByName: row.snapshot.capturedByName,
    verifiedByUserId: row.snapshot.verifiedByUserId,
    verifiedByName: row.snapshot.verifiedByName,
    verifiedAt: row.snapshot.verifiedAt?.toISOString() ?? null,
    version: row.snapshot.version,
    createdAt: row.snapshot.createdAt.toISOString(),
  };
}

type StructuredCandidate = {
  document: typeof documents.$inferSelect;
  version: typeof documentVersions.$inferSelect;
  snapshot: typeof documentVersionSnapshots.$inferSelect;
};

function structurallyValidVerifiedStructuredCandidate(
  row: StructuredCandidate,
): ProposedStructuredSnapshot | null {
  if (
    !SHA256.test(row.version.sha256) ||
    row.snapshot.status !== "verified" ||
    !row.snapshot.capturedByUserId ||
    !row.snapshot.capturedByName.trim() ||
    !row.snapshot.verifiedByUserId ||
    !row.snapshot.verifiedByName?.trim() ||
    !row.snapshot.verifiedAt ||
    row.snapshot.documentVersionSha256 !== row.version.sha256 ||
    !eligibleText(row.snapshot.canonicalText) ||
    !SHA256.test(row.snapshot.canonicalTextSha256) ||
    sha256(row.snapshot.canonicalText) !== row.snapshot.canonicalTextSha256 ||
    row.snapshot.structuredSnapshot === null ||
    row.snapshot.structuredSnapshotSha256 === null ||
    !SHA256.test(row.snapshot.structuredSnapshotSha256) ||
    sha256(row.snapshot.structuredSnapshot) !==
      row.snapshot.structuredSnapshotSha256
  ) {
    return null;
  }
  return parseStored(
    row.snapshot.structuredSnapshot,
    row.snapshot.canonicalText,
    row.document.id,
    row.version.id,
  );
}

function eligibleVerifiedStructuredCandidate(
  row: StructuredCandidate,
): ProposedStructuredSnapshot | null {
  const structured = structurallyValidVerifiedStructuredCandidate(row);
  return structured &&
    eligibleRedaction(row.document.redactionStatus) &&
    row.snapshot.capturedRedactionStatus === row.document.redactionStatus &&
    row.version.malwareStatus === "clean" &&
    row.version.quarantineStatus === "cleared"
    ? structured
    : null;
}

async function exactCurrentVersion(
  transaction: Transaction,
  organisationId: string,
  documentId: string,
  lockRows: boolean = true,
) {
  const documentQuery = transaction
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.organisationId, organisationId),
      ),
    )
    .limit(1);
  const [document] = lockRows
    ? await documentQuery.for("update")
    : await documentQuery;
  if (!document) return null;
  if (
    !document.sha256 ||
    !SHA256.test(document.sha256) ||
    document.size === null ||
    !Number.isSafeInteger(document.size) ||
    !eligibleText(document.contentText) ||
    document.extractionStatus !== "extracted" ||
    !document.extractionMethod ||
    document.extractionMethod === "none" ||
    !eligibleRedaction(document.redactionStatus)
  ) {
    throw new Error("Document is not eligible for immutable capture");
  }
  const versionsQuery = transaction
    .select()
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.organisationId, organisationId),
        eq(documentVersions.documentId, document.id),
        eq(documentVersions.objectPath, document.objectPath),
        eq(documentVersions.sha256, document.sha256),
        eq(documentVersions.sizeBytes, document.size),
      ),
    )
    .limit(2);
  const versions = lockRows
    ? await versionsQuery.for("share")
    : await versionsQuery;
  const version = selectExactCurrentDocumentVersion(
    versions.map((candidate) => ({
      id: candidate.id,
      organisationId: candidate.organisationId,
      documentId: candidate.documentId,
      objectPath: candidate.objectPath,
      sha256: candidate.sha256,
      sizeBytes: candidate.sizeBytes,
      addendumStatus: candidate.addendumStatus,
    })),
    {
      organisationId,
      documentId: document.id,
      objectPath: document.objectPath,
      sha256: document.sha256,
      sizeBytes: document.size,
    },
  );
  const selected = versions.find(({ id }) => id === version?.id);
  if (
    !selected ||
    selected.malwareStatus !== "clean" ||
    selected.quarantineStatus !== "cleared"
  ) {
    throw new Error("Exact current document version is unavailable");
  }
  return { document, version: selected };
}

export function documentSnapshotSeriesLockKey(
  organisationId: string,
  projectId: string,
  sourceId: string,
): string {
  return `bidbox.document-snapshot-series:${organisationId}:${projectId}:${sourceId}`;
}

async function lockDocumentSnapshotSeries(
  transaction: Transaction,
  organisationId: string,
  projectId: string,
  sourceId: string,
): Promise<void> {
  await transaction.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(
        ${documentSnapshotSeriesLockKey(organisationId, projectId, sourceId)},
        0
      )
    )
  `);
}

async function isCurrentCompanyEvidence(
  transaction: Transaction,
  organisationId: string,
  projectId: string,
  documentId: string,
  documentVersionId: string,
  documentVersionSha256: string,
): Promise<boolean> {
  const rows = await transaction
    .select({ item: vaultItems, version: vaultItemVersions })
    .from(vaultItemVersions)
    .innerJoin(vaultItems, eq(vaultItems.id, vaultItemVersions.vaultItemId))
    .innerJoin(projects, eq(projects.clientId, vaultItems.clientId))
    .where(
      and(
        eq(vaultItemVersions.organisationId, organisationId),
        eq(vaultItemVersions.documentVersionId, documentVersionId),
        eq(vaultItems.organisationId, organisationId),
        eq(vaultItems.sourceDocumentId, documentId),
        eq(vaultItems.status, "active"),
        eq(projects.id, projectId),
        eq(projects.organisationId, organisationId),
      ),
    )
    .limit(2)
    .for("share");
  const row = rows[0];
  if (
    rows.length !== 1 ||
    !row ||
    row.version.verificationState !== "approved" ||
    row.version.withdrawnAt !== null ||
    !row.version.approvedByUserId ||
    !row.version.approvedAt ||
    row.version.documentVersionId !== documentVersionId ||
    !SHA256.test(documentVersionSha256)
  ) {
    return false;
  }
  const approvers = await transaction
    .select({ id: users.id, name: users.name, status: users.status })
    .from(users)
    .where(eq(users.id, row.version.approvedByUserId))
    .limit(2)
    .for("share");
  return Boolean(
    approvers.length === 1 &&
    approvers[0]?.status === "active" &&
    approvers[0]?.name?.trim() &&
    row.item.sourceDocumentId === documentId &&
    row.item.status === "active",
  );
}

async function baseSnapshot(
  transaction: Transaction,
  actor: SnapshotActor,
  projectId: string,
  proposal: ProposedStructuredSnapshot,
  currentCreatedAt: Date,
) {
  if (!proposal.baseVersionId) return null;
  const [row] = await transaction
    .select({
      document: documents,
      version: documentVersions,
      snapshot: documentVersionSnapshots,
    })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .innerJoin(
      documentVersionSnapshots,
      eq(documentVersionSnapshots.documentVersionId, documentVersions.id),
    )
    .where(
      and(
        eq(documentVersions.id, proposal.baseVersionId),
        eq(documentVersions.organisationId, actor.organisationId),
        eq(documents.organisationId, actor.organisationId),
        eq(documents.projectId, projectId),
        eq(documentVersionSnapshots.organisationId, actor.organisationId),
        eq(documentVersionSnapshots.status, "verified"),
      ),
    )
    .limit(1)
    .for("share");
  if (!row || row.version.createdAt.getTime() >= currentCreatedAt.getTime()) {
    return null;
  }
  const structured = eligibleVerifiedStructuredCandidate(row);
  return structured?.sourceId === proposal.sourceId
    ? { ...row, structured }
    : null;
}

async function validateProposalLink(
  transaction: Transaction,
  actor: SnapshotActor,
  document: typeof documents.$inferSelect,
  version: typeof documentVersions.$inferSelect,
  proposal: ProposedStructuredSnapshot,
): Promise<boolean> {
  const preceding = await latestVerifiedSameSeries(
    transaction,
    actor,
    document.projectId,
    proposal.sourceId,
    version.createdAt,
  );
  if (proposal.sourceKind === "solicitation") {
    return version.supersedesVersionId === null && preceding === null;
  }
  if (
    !proposal.baseVersionId ||
    (version.supersedesVersionId !== null &&
      version.supersedesVersionId !== proposal.baseVersionId) ||
    preceding?.version.id !== proposal.baseVersionId
  ) {
    return false;
  }
  return Boolean(
    await baseSnapshot(
      transaction,
      actor,
      document.projectId,
      proposal,
      version.createdAt,
    ),
  );
}

async function latestVerifiedSameSeries(
  transaction: Transaction,
  actor: SnapshotActor,
  projectId: string,
  sourceId: string,
  before: Date,
) {
  const candidates = await transaction
    .select({
      document: documents,
      version: documentVersions,
      snapshot: documentVersionSnapshots,
    })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .innerJoin(
      documentVersionSnapshots,
      eq(documentVersionSnapshots.documentVersionId, documentVersions.id),
    )
    .where(
      and(
        eq(documentVersions.organisationId, actor.organisationId),
        eq(documents.organisationId, actor.organisationId),
        eq(documents.projectId, projectId),
        eq(documentVersionSnapshots.organisationId, actor.organisationId),
        eq(documentVersionSnapshots.status, "verified"),
        sql`${documentVersions.createdAt} < ${before}`,
      ),
    )
    .limit(MAX_CHAIN + 1)
    .for("share");
  if (candidates.length > MAX_CHAIN) return undefined;
  const sameSeries = candidates
    .map((candidate) => ({
      ...candidate,
      structured: structurallyValidVerifiedStructuredCandidate(candidate),
    }))
    .filter(
      (candidate) =>
        candidate.structured?.sourceId === sourceId &&
        candidate.snapshot.documentVersionSha256 === candidate.version.sha256,
    )
    .sort(
      (left, right) =>
        right.version.createdAt.getTime() - left.version.createdAt.getTime() ||
        right.version.id.localeCompare(left.version.id),
    );
  const latest = sameSeries[0];
  if (!latest) return null;
  if (
    sameSeries[1]?.version.createdAt.getTime() ===
    latest.version.createdAt.getTime()
  ) {
    return undefined;
  }
  return eligibleVerifiedStructuredCandidate(latest) ? latest : undefined;
}

async function effectiveChain(
  transaction: Transaction,
  actor: SnapshotActor,
  projectId: string,
  current: {
    document: typeof documents.$inferSelect;
    version: typeof documentVersions.$inferSelect;
    snapshot: typeof documentVersionSnapshots.$inferSelect;
    structured: ProposedStructuredSnapshot;
  },
): Promise<ReadonlyMap<string, StructuredField> | null> {
  const chain = [current];
  const seen = new Set([current.version.id]);
  let cursor = current;
  while (cursor.structured.baseVersionId) {
    if (
      chain.length >= MAX_CHAIN ||
      seen.has(cursor.structured.baseVersionId)
    ) {
      return null;
    }
    const base = await baseSnapshot(
      transaction,
      actor,
      projectId,
      cursor.structured,
      cursor.version.createdAt,
    );
    const preceding = await latestVerifiedSameSeries(
      transaction,
      actor,
      projectId,
      cursor.structured.sourceId,
      cursor.version.createdAt,
    );
    if (
      !base ||
      preceding?.version.id !== base.version.id ||
      (cursor.version.supersedesVersionId !== null &&
        cursor.version.supersedesVersionId !== base.version.id) ||
      base.structured.sourceId !== current.structured.sourceId
    ) {
      return null;
    }
    seen.add(base.version.id);
    chain.push(base);
    cursor = base;
  }
  let effective: ReadonlyMap<string, StructuredField> | null = null;
  for (const item of chain.reverse()) {
    effective = resolveEffectiveStructuredFields(item.structured, effective);
    if (!effective) return null;
  }
  return effective;
}

export class DocumentVersionSnapshotRepository {
  constructor(
    private readonly database: Database = db,
    private readonly auditWriter: typeof writeAuditTx = writeAuditTx,
  ) {}

  async readCurrent(
    organisationId: string,
    documentId: string,
  ): Promise<CurrentSnapshotView | null> {
    return this.database.transaction(async (transaction) => {
      const selected = await exactCurrentVersion(
        transaction,
        organisationId,
        documentId,
        false,
      );
      if (!selected) return null;
      const [snapshot] = await transaction
        .select()
        .from(documentVersionSnapshots)
        .where(
          and(
            eq(documentVersionSnapshots.documentVersionId, selected.version.id),
            eq(documentVersionSnapshots.organisationId, organisationId),
          ),
        )
        .limit(1);
      return {
        documentId: selected.document.id,
        projectId: selected.document.projectId,
        documentVersionId: selected.version.id,
        documentVersionSha256: selected.version.sha256,
        filename: selected.document.filename,
        redactionStatus: selected.document.redactionStatus,
        extractionStatus: selected.document.extractionStatus ?? "unknown",
        canonicalText: selected.document.contentText!,
        snapshot: snapshot
          ? materialize({ document: selected.document, snapshot })
          : null,
      };
    });
  }

  async capture(
    actor: SnapshotActor,
    documentId: string,
    requestedVersionId: string,
    proposed: unknown | null,
    now: Date,
  ): Promise<SnapshotWriteResult> {
    return this.database.transaction(async (transaction) => {
      const currentActor = await requireCurrentAuthority(
        transaction,
        actor,
        CAPTURE_PERMISSIONS,
      );
      if (!currentActor) return { outcome: "conflict" } as const;
      const preflight = await exactCurrentVersion(
        transaction,
        actor.organisationId,
        documentId,
        false,
      );
      if (!preflight) return { outcome: "not_found" } as const;
      if (preflight.version.id !== requestedVersionId) {
        return { outcome: "state_conflict" } as const;
      }
      const preflightStructured =
        proposed === null
          ? null
          : parseProposedStructuredSnapshot({
              value: proposed,
              canonicalText: preflight.document.contentText!,
              documentId: preflight.document.id,
              documentVersionId: preflight.version.id,
            });
      if (proposed !== null && !preflightStructured) {
        return { outcome: "conflict" } as const;
      }
      await lockDocumentSnapshotSeries(
        transaction,
        actor.organisationId,
        preflight.document.projectId,
        preflightStructured?.sourceId ?? preflight.document.id,
      );
      const selected = await exactCurrentVersion(
        transaction,
        actor.organisationId,
        documentId,
      );
      if (!selected || selected.version.id !== requestedVersionId) {
        return { outcome: "state_conflict" } as const;
      }
      const structured =
        proposed === null
          ? null
          : parseProposedStructuredSnapshot({
              value: proposed,
              canonicalText: selected.document.contentText!,
              documentId: selected.document.id,
              documentVersionId: selected.version.id,
            });
      if (
        (proposed !== null && !structured) ||
        structured?.sourceId !== preflightStructured?.sourceId ||
        (structured &&
          !(await validateProposalLink(
            transaction,
            actor,
            selected.document,
            selected.version,
            structured,
          ))) ||
        (!structured &&
          !(await isCurrentCompanyEvidence(
            transaction,
            actor.organisationId,
            selected.document.projectId,
            selected.document.id,
            selected.version.id,
            selected.version.sha256,
          )))
      ) {
        return { outcome: "conflict" } as const;
      }
      const canonicalText = selected.document.contentText!;
      const structuredText = structured ? JSON.stringify(structured) : null;
      const [existing] = await transaction
        .select()
        .from(documentVersionSnapshots)
        .where(
          and(
            eq(documentVersionSnapshots.documentVersionId, selected.version.id),
            eq(documentVersionSnapshots.organisationId, actor.organisationId),
          ),
        )
        .limit(1)
        .for("update");
      if (existing) {
        if (
          existing.documentVersionSha256 !== selected.version.sha256 ||
          existing.capturedRedactionStatus !==
            selected.document.redactionStatus ||
          existing.canonicalText !== canonicalText ||
          existing.canonicalTextSha256 !== sha256(canonicalText) ||
          existing.structuredSnapshot !== structuredText ||
          existing.structuredSnapshotSha256 !==
            (structuredText ? sha256(structuredText) : null)
        ) {
          return { outcome: "conflict" } as const;
        }
        return {
          outcome: "existing",
          value: materialize({
            document: selected.document,
            snapshot: existing,
          }),
        };
      }
      const id = randomUUID();
      const [snapshot] = await transaction
        .insert(documentVersionSnapshots)
        .values({
          id,
          organisationId: actor.organisationId,
          documentVersionId: selected.version.id,
          documentVersionSha256: selected.version.sha256,
          capturedRedactionStatus: selected.document.redactionStatus,
          canonicalText,
          canonicalTextSha256: sha256(canonicalText),
          structuredSnapshot: structuredText,
          structuredSnapshotSha256: structuredText
            ? sha256(structuredText)
            : null,
          extractionMethod: selected.document.extractionMethod!,
          parserVersion: PARSER_VERSION,
          status: "captured",
          capturedByUserId: currentActor.id,
          capturedByName: currentActor.name!,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await this.auditWriter(transaction, {
        user: currentActor,
        organisationId: actor.organisationId,
        projectId: selected.document.projectId,
        eventType: "document_version_snapshot.captured",
        objectType: "document_version_snapshot",
        objectId: id,
        details: JSON.stringify({
          documentId,
          documentVersionId: selected.version.id,
          documentVersionSha256: selected.version.sha256,
          structured: Boolean(structured),
        }),
        createdAt: now,
      });
      return {
        outcome: "created",
        value: materialize({
          document: selected.document,
          snapshot: snapshot!,
        }),
      };
    });
  }

  async review(
    actor: SnapshotActor,
    documentId: string,
    snapshotId: string,
    expectedVersion: number,
    decision: "verified" | "rejected",
    now: Date,
  ): Promise<SnapshotWriteResult> {
    return this.database.transaction(async (transaction) => {
      const currentActor = await requireCurrentAuthority(
        transaction,
        actor,
        REVIEW_PERMISSIONS,
      );
      if (!currentActor) return { outcome: "conflict" } as const;
      const preflight = await exactCurrentVersion(
        transaction,
        actor.organisationId,
        documentId,
        false,
      );
      if (!preflight) return { outcome: "not_found" } as const;
      const [preflightSnapshot] = await transaction
        .select()
        .from(documentVersionSnapshots)
        .where(
          and(
            eq(documentVersionSnapshots.id, snapshotId),
            eq(documentVersionSnapshots.organisationId, actor.organisationId),
            eq(
              documentVersionSnapshots.documentVersionId,
              preflight.version.id,
            ),
          ),
        )
        .limit(1);
      if (!preflightSnapshot) return { outcome: "not_found" } as const;
      const preflightStructured = parseStored(
        preflightSnapshot.structuredSnapshot,
        preflightSnapshot.canonicalText,
        preflight.document.id,
        preflight.version.id,
      );
      if (
        preflightSnapshot.structuredSnapshot !== null &&
        !preflightStructured
      ) {
        return { outcome: "state_conflict" } as const;
      }
      await lockDocumentSnapshotSeries(
        transaction,
        actor.organisationId,
        preflight.document.projectId,
        preflightStructured?.sourceId ?? preflight.document.id,
      );
      const selected = await exactCurrentVersion(
        transaction,
        actor.organisationId,
        documentId,
      );
      if (!selected || selected.version.id !== preflight.version.id) {
        return { outcome: "state_conflict" } as const;
      }
      const [snapshot] = await transaction
        .select()
        .from(documentVersionSnapshots)
        .where(
          and(
            eq(documentVersionSnapshots.id, snapshotId),
            eq(documentVersionSnapshots.organisationId, actor.organisationId),
            eq(documentVersionSnapshots.documentVersionId, selected.version.id),
          ),
        )
        .limit(1)
        .for("update");
      if (!snapshot) return { outcome: "not_found" } as const;
      if (snapshot.version !== expectedVersion) {
        return { outcome: "version_conflict" } as const;
      }
      if (
        snapshot.status !== "captured" ||
        snapshot.capturedByUserId === currentActor.id ||
        snapshot.documentVersionSha256 !== selected.version.sha256 ||
        snapshot.capturedRedactionStatus !==
          selected.document.redactionStatus ||
        snapshot.canonicalText !== selected.document.contentText ||
        sha256(snapshot.canonicalText) !== snapshot.canonicalTextSha256
      ) {
        return { outcome: "state_conflict" } as const;
      }
      const structured = parseStored(
        snapshot.structuredSnapshot,
        snapshot.canonicalText,
        selected.document.id,
        selected.version.id,
      );
      if (
        snapshot.structuredSnapshot !== null &&
        (!structured ||
          sha256(snapshot.structuredSnapshot) !==
            snapshot.structuredSnapshotSha256)
      ) {
        return { outcome: "state_conflict" } as const;
      }
      if (structured?.sourceId !== preflightStructured?.sourceId) {
        return { outcome: "state_conflict" } as const;
      }
      if (decision === "verified") {
        const valid = structured
          ? (await validateProposalLink(
              transaction,
              actor,
              selected.document,
              selected.version,
              structured,
            )) &&
            Boolean(
              await effectiveChain(
                transaction,
                actor,
                selected.document.projectId,
                {
                  document: selected.document,
                  version: selected.version,
                  snapshot,
                  structured,
                },
              ),
            )
          : await isCurrentCompanyEvidence(
              transaction,
              actor.organisationId,
              selected.document.projectId,
              selected.document.id,
              selected.version.id,
              selected.version.sha256,
            );
        if (!valid) return { outcome: "state_conflict" } as const;
      }
      const [updated] = await transaction
        .update(documentVersionSnapshots)
        .set({
          status: decision,
          verifiedByUserId: currentActor.id,
          verifiedByName: currentActor.name!,
          verifiedAt: now,
          version: sql`${documentVersionSnapshots.version} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(documentVersionSnapshots.id, snapshot.id),
            eq(documentVersionSnapshots.status, "captured"),
            eq(documentVersionSnapshots.version, expectedVersion),
          ),
        )
        .returning();
      if (!updated) return { outcome: "version_conflict" } as const;
      await this.auditWriter(transaction, {
        user: currentActor,
        organisationId: actor.organisationId,
        projectId: selected.document.projectId,
        eventType: `document_version_snapshot.${decision}`,
        objectType: "document_version_snapshot",
        objectId: snapshot.id,
        details: JSON.stringify({
          documentId,
          documentVersionId: selected.version.id,
          documentVersionSha256: selected.version.sha256,
          capturedByUserId: snapshot.capturedByUserId,
        }),
        createdAt: now,
      });
      return {
        outcome: "updated",
        value: materialize({ document: selected.document, snapshot: updated }),
      };
    });
  }
}
