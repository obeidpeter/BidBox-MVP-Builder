import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  auditEvents,
  consentRecords,
  crossBorderTransfers,
  dataSubjectRequests,
  db,
  deletionCertificates,
  legalHolds,
  organisationMemberships,
  retentionActions,
  roleGrants,
  subprocessors,
  users,
  withTenantDatabase,
} from "@workspace/db";
import { writeAuditTx } from "../audit";
import {
  PRIVACY_OPERATIONS_MAX_ASSIGNEES,
  PrivacyOperationsRepositoryUnavailableError,
  type PrivacyConsentWithdrawalCommand,
  type PrivacyDsrTriageCommand,
  type PrivacyHoldReviewCommand,
  type PrivacyMutationOutcome,
  type PrivacyOperationsRawDashboard,
  type PrivacyOperationsRepository,
  type PrivacyOperationsScope,
} from "./contracts";
import { createPrivacyWorkflowAuditDetails } from "./service";

const WORKFLOW_EVENT_TYPES = [
  "privacy.dsr_triage_recorded",
  "privacy.consent_withdrawal_recorded",
  "privacy.legal_hold_review_recorded",
] as const;

const SHA256_SQL_PATTERN = "^[0-9a-f]{64}$";
const PRIVACY_MANAGE_ROLES = [
  "client_organisation_owner",
  "client_administrator",
  "valo_operations_administrator",
  "consultancy_partner_administrator",
] as const;

type PrivacyTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Serialises privacy management writes with membership and role-grant writers.
 * The transaction-scoped lock is held through the outer tenant request commit.
 */
async function lockPrivacyMembershipAdministration(
  transaction: PrivacyTransaction,
  organisationId: string,
): Promise<void> {
  await transaction.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(
        ${`bidbox.membership-administration:${organisationId}`},
        0
      )
    )
  `);
}

async function actorForAudit(
  transaction: PrivacyTransaction,
  organisationId: string,
  actorUserId: string,
  now = new Date(),
) {
  const memberships = await transaction
    .select({ membershipId: organisationMemberships.id, actor: users })
    .from(organisationMemberships)
    .innerJoin(users, eq(organisationMemberships.userId, users.id))
    .where(
      and(
        eq(organisationMemberships.organisationId, organisationId),
        eq(organisationMemberships.userId, actorUserId),
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
      ),
    )
    .limit(2);
  const membership = memberships[0];
  if (
    memberships.length !== 1 ||
    !membership?.actor.name ||
    membership.actor.name !== membership.actor.name.trim() ||
    membership.actor.name.length > 512 ||
    /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(membership.actor.name)
  ) {
    throw new PrivacyOperationsRepositoryUnavailableError(
      "Authenticated privacy actor is unavailable",
    );
  }
  const grants = await transaction
    .select({ id: roleGrants.id })
    .from(roleGrants)
    .where(
      and(
        eq(roleGrants.membershipId, membership.membershipId),
        inArray(roleGrants.role, [...PRIVACY_MANAGE_ROLES]),
        isNull(roleGrants.revokedAt),
        or(isNull(roleGrants.startsAt), lte(roleGrants.startsAt, now)),
        or(isNull(roleGrants.expiresAt), gt(roleGrants.expiresAt, now)),
      ),
    )
    .limit(PRIVACY_MANAGE_ROLES.length + 1);
  if (grants.length < 1 || grants.length > PRIVACY_MANAGE_ROLES.length) {
    throw new PrivacyOperationsRepositoryUnavailableError(
      "Authenticated privacy actor is unavailable",
    );
  }
  return membership.actor;
}

async function mutationMiss(
  transaction: PrivacyTransaction,
  table: typeof dataSubjectRequests | typeof consentRecords | typeof legalHolds,
  organisationId: string,
  id: string,
  expectedVersion: number,
): Promise<PrivacyMutationOutcome> {
  const [existing] = await transaction
    .select({ version: table.version })
    .from(table)
    .where(and(eq(table.organisationId, organisationId), eq(table.id, id)))
    .limit(1);
  return !existing
    ? { outcome: "not_found" }
    : existing.version !== expectedVersion
      ? { outcome: "version_conflict" }
      : { outcome: "state_conflict" };
}

export class PostgresPrivacyOperationsRepository implements PrivacyOperationsRepository {
  async listAssignees(scope: PrivacyOperationsScope, limit: number) {
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > PRIVACY_OPERATIONS_MAX_ASSIGNEES + 1
    ) {
      throw new PrivacyOperationsRepositoryUnavailableError();
    }
    return withTenantDatabase(scope.organisationId, () =>
      db.transaction(
        async (transaction) => {
          await actorForAudit(
            transaction,
            scope.organisationId,
            scope.actorUserId,
          );
          const now = new Date();
          const rawLimit = limit * PRIVACY_MANAGE_ROLES.length + 1;
          const rows = await transaction
            .select({
              userId: users.id,
              name: users.name,
              grantId: roleGrants.id,
            })
            .from(organisationMemberships)
            .innerJoin(users, eq(organisationMemberships.userId, users.id))
            .innerJoin(
              roleGrants,
              eq(roleGrants.membershipId, organisationMemberships.id),
            )
            .where(
              and(
                eq(
                  organisationMemberships.organisationId,
                  scope.organisationId,
                ),
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
                inArray(roleGrants.role, [...PRIVACY_MANAGE_ROLES]),
                isNull(roleGrants.revokedAt),
                or(isNull(roleGrants.startsAt), lte(roleGrants.startsAt, now)),
                or(isNull(roleGrants.expiresAt), gt(roleGrants.expiresAt, now)),
              ),
            )
            .orderBy(asc(users.name), asc(users.id), asc(roleGrants.id))
            .limit(rawLimit);
          if (rows.length >= rawLimit) {
            throw new PrivacyOperationsRepositoryUnavailableError();
          }
          const unique = new Map<string, string>();
          for (const row of rows) {
            if (
              !row.name ||
              row.name !== row.name.trim() ||
              row.name.length > 512 ||
              /[\p{Cc}\p{Cf}\p{Cs}]/u.test(row.name) ||
              !/[^\s\p{Cf}]/u.test(row.name)
            ) {
              throw new PrivacyOperationsRepositoryUnavailableError();
            }
            unique.set(row.userId, row.name);
          }
          if (unique.size > PRIVACY_OPERATIONS_MAX_ASSIGNEES) {
            throw new PrivacyOperationsRepositoryUnavailableError();
          }
          return [...unique]
            .slice(0, limit)
            .map(([userId, name]) => ({ userId, name }));
        },
        { isolationLevel: "read committed" },
      ),
    );
  }

  async readDashboard(
    scope: PrivacyOperationsScope,
    limit: number,
  ): Promise<PrivacyOperationsRawDashboard> {
    return withTenantDatabase(scope.organisationId, async () => {
      const rowLimit = limit + 1;
      const [
        [dsrTotal],
        [consentTotal],
        [holdTotal],
        [subprocessorTotal],
        [transferTotal],
        [deletionTotal],
      ] = await Promise.all([
        db
          .select({ value: count() })
          .from(dataSubjectRequests)
          .where(eq(dataSubjectRequests.organisationId, scope.organisationId)),
        db
          .select({ value: count() })
          .from(consentRecords)
          .where(eq(consentRecords.organisationId, scope.organisationId)),
        db
          .select({ value: count() })
          .from(legalHolds)
          .where(eq(legalHolds.organisationId, scope.organisationId)),
        db
          .select({ value: count() })
          .from(subprocessors)
          .where(eq(subprocessors.organisationId, scope.organisationId)),
        db
          .select({ value: count() })
          .from(crossBorderTransfers)
          .where(eq(crossBorderTransfers.organisationId, scope.organisationId)),
        db
          .select({ value: count() })
          .from(retentionActions)
          .where(
            and(
              eq(retentionActions.organisationId, scope.organisationId),
              eq(retentionActions.action, "delete"),
            ),
          ),
      ]);

      const dataSubjectRequestRows = await db
        .select({
          organisationId: dataSubjectRequests.organisationId,
          id: dataSubjectRequests.id,
          requestType: sql<string>`left(${dataSubjectRequests.requestType}, 64)`,
          identityVerificationStatus: sql<string>`left(${dataSubjectRequests.identityVerificationStatus}, 64)`,
          receivedAt: dataSubjectRequests.receivedAt,
          dueAt: dataSubjectRequests.dueAt,
          status: sql<string>`left(${dataSubjectRequests.status}, 64)`,
          assignedToUserId: dataSubjectRequests.assignedToUserId,
          responseEvidencePresent: sql<boolean>`${dataSubjectRequests.responseEvidence} IS NOT NULL`,
          responseEvidenceSha256: sql<
            string | null
          >`CASE WHEN ${dataSubjectRequests.responseEvidence} ~ ${SHA256_SQL_PATTERN} THEN ${dataSubjectRequests.responseEvidence} ELSE NULL END`,
          completedAt: dataSubjectRequests.completedAt,
          version: dataSubjectRequests.version,
          updatedAt: dataSubjectRequests.updatedAt,
        })
        .from(dataSubjectRequests)
        .where(eq(dataSubjectRequests.organisationId, scope.organisationId))
        .orderBy(asc(dataSubjectRequests.dueAt), desc(dataSubjectRequests.id))
        .limit(rowLimit);

      const consentRows = await db
        .select({
          organisationId: consentRecords.organisationId,
          id: consentRecords.id,
          privacyRecordId: consentRecords.privacyRecordId,
          capturedAt: consentRecords.capturedAt,
          withdrawnAt: consentRecords.withdrawnAt,
          evidenceHash: sql<string>`CASE WHEN ${consentRecords.evidenceHash} ~ ${SHA256_SQL_PATTERN} THEN ${consentRecords.evidenceHash} ELSE '' END`,
          version: consentRecords.version,
          updatedAt: consentRecords.updatedAt,
        })
        .from(consentRecords)
        .where(eq(consentRecords.organisationId, scope.organisationId))
        .orderBy(desc(consentRecords.capturedAt), desc(consentRecords.id))
        .limit(rowLimit);

      const legalHoldRows = await db
        .select({
          organisationId: legalHolds.organisationId,
          id: legalHolds.id,
          projectId: legalHolds.projectId,
          status: sql<string>`left(${legalHolds.status}, 64)`,
          placedByUserId: legalHolds.placedByUserId,
          releasedByUserId: legalHolds.releasedByUserId,
          releasedAt: legalHolds.releasedAt,
          version: legalHolds.version,
          createdAt: legalHolds.createdAt,
          updatedAt: legalHolds.updatedAt,
        })
        .from(legalHolds)
        .where(eq(legalHolds.organisationId, scope.organisationId))
        .orderBy(desc(legalHolds.updatedAt), desc(legalHolds.id))
        .limit(rowLimit);

      const subprocessorRows = await db
        .select({
          organisationId: subprocessors.organisationId,
          id: subprocessors.id,
          legalName: sql<string>`left(${subprocessors.legalName}, 160)`,
          service: sql<string>`left(${subprocessors.service}, 160)`,
          countryCode: sql<string>`left(${subprocessors.countryCode}, 8)`,
          dpaStatus: sql<string>`left(${subprocessors.dpaStatus}, 64)`,
          securityReviewStatus: sql<string>`left(${subprocessors.securityReviewStatus}, 64)`,
          approvedAt: subprocessors.approvedAt,
          nextReviewAt: subprocessors.nextReviewAt,
          version: subprocessors.version,
          updatedAt: subprocessors.updatedAt,
        })
        .from(subprocessors)
        .where(eq(subprocessors.organisationId, scope.organisationId))
        .orderBy(asc(subprocessors.nextReviewAt), desc(subprocessors.id))
        .limit(rowLimit);

      const transferRows = await db
        .select({
          organisationId: crossBorderTransfers.organisationId,
          id: crossBorderTransfers.id,
          subprocessorId: crossBorderTransfers.subprocessorId,
          originCountry: sql<string>`left(${crossBorderTransfers.originCountry}, 8)`,
          destinationCountry: sql<string>`left(${crossBorderTransfers.destinationCountry}, 8)`,
          transferBasis: sql<string>`left(${crossBorderTransfers.transferBasis}, 128)`,
          approvalEvidencePresent: sql<boolean>`${crossBorderTransfers.approvalEvidence} IS NOT NULL`,
          approvalEvidenceSha256: sql<
            string | null
          >`CASE WHEN ${crossBorderTransfers.approvalEvidence} ~ ${SHA256_SQL_PATTERN} THEN ${crossBorderTransfers.approvalEvidence} ELSE NULL END`,
          legalReviewStatus: sql<string>`left(${crossBorderTransfers.legalReviewStatus}, 64)`,
          nextReviewAt: crossBorderTransfers.nextReviewAt,
          version: crossBorderTransfers.version,
          updatedAt: crossBorderTransfers.updatedAt,
        })
        .from(crossBorderTransfers)
        .where(eq(crossBorderTransfers.organisationId, scope.organisationId))
        .orderBy(
          asc(crossBorderTransfers.nextReviewAt),
          desc(crossBorderTransfers.id),
        )
        .limit(rowLimit);

      const deletionRows = await db
        .select({
          organisationId: retentionActions.organisationId,
          id: retentionActions.id,
          status: sql<string>`left(${retentionActions.status}, 64)`,
          legalHoldId: retentionActions.legalHoldId,
          executedByUserId: retentionActions.executedByUserId,
          executedAt: retentionActions.executedAt,
          version: retentionActions.version,
          updatedAt: retentionActions.updatedAt,
        })
        .from(retentionActions)
        .where(
          and(
            eq(retentionActions.organisationId, scope.organisationId),
            eq(retentionActions.action, "delete"),
          ),
        )
        .orderBy(desc(retentionActions.updatedAt), desc(retentionActions.id))
        .limit(rowLimit);

      const deletionIds = deletionRows.map(({ id }) => id);
      const certificateRows =
        deletionIds.length === 0
          ? []
          : await db
              .select({
                organisationId: deletionCertificates.organisationId,
                retentionActionId: deletionCertificates.retentionActionId,
                scopeManifestHash: deletionCertificates.scopeManifestHash,
                completedAt: deletionCertificates.completedAt,
                signedByUserId: deletionCertificates.signedByUserId,
                signatureEvidencePresent: sql<boolean>`${deletionCertificates.signatureEvidence} IS NOT NULL AND length(${deletionCertificates.signatureEvidence}) > 0`,
              })
              .from(deletionCertificates)
              .where(
                and(
                  eq(deletionCertificates.organisationId, scope.organisationId),
                  inArray(deletionCertificates.retentionActionId, deletionIds),
                ),
              );

      const auditRows = await db
        .select({
          organisationId: auditEvents.organisationId,
          objectId: auditEvents.objectId,
          eventType: auditEvents.eventType,
          details: sql<
            string | null
          >`CASE WHEN length(${auditEvents.details}) <= 4000 THEN ${auditEvents.details} ELSE NULL END`,
          seq: auditEvents.seq,
          hash: auditEvents.hash,
          createdAt: auditEvents.createdAt,
        })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.organisationId, scope.organisationId),
            inArray(auditEvents.eventType, [...WORKFLOW_EVENT_TYPES]),
          ),
        )
        .orderBy(desc(auditEvents.seq))
        .limit(Math.min((limit + 1) * 4, 204));

      return {
        totals: {
          dataSubjectRequests: Number(dsrTotal?.value ?? 0),
          consentRecords: Number(consentTotal?.value ?? 0),
          legalHolds: Number(holdTotal?.value ?? 0),
          subprocessors: Number(subprocessorTotal?.value ?? 0),
          crossBorderTransfers: Number(transferTotal?.value ?? 0),
          deletionActions: Number(deletionTotal?.value ?? 0),
        },
        dataSubjectRequests: dataSubjectRequestRows,
        consentRecords: consentRows,
        legalHolds: legalHoldRows,
        subprocessors: subprocessorRows,
        crossBorderTransfers: transferRows,
        deletionActions: deletionRows.map((row) => ({
          ...row,
          certificates: certificateRows
            .filter(
              (certificate) =>
                certificate.organisationId === scope.organisationId &&
                certificate.retentionActionId === row.id,
            )
            .map(
              ({
                scopeManifestHash,
                completedAt,
                signedByUserId,
                signatureEvidencePresent,
              }) => ({
                scopeManifestHash,
                completedAt,
                signedByUserId,
                signatureEvidencePresent,
              }),
            ),
        })),
        auditRows,
      };
    });
  }

  async triageDataSubjectRequest(
    scope: PrivacyOperationsScope,
    command: PrivacyDsrTriageCommand,
  ): Promise<PrivacyMutationOutcome> {
    return withTenantDatabase(scope.organisationId, () =>
      db.transaction(
        async (transaction) => {
          await lockPrivacyMembershipAdministration(
            transaction,
            scope.organisationId,
          );
          const authorityNow = new Date();
          const actor = await actorForAudit(
            transaction,
            scope.organisationId,
            scope.actorUserId,
            authorityNow,
          );
          const recordedAt = new Date(command.recordedAt);
          const assignees = await transaction
            .select({
              membershipId: organisationMemberships.id,
              name: users.name,
            })
            .from(organisationMemberships)
            .innerJoin(users, eq(organisationMemberships.userId, users.id))
            .where(
              and(
                eq(
                  organisationMemberships.organisationId,
                  scope.organisationId,
                ),
                eq(organisationMemberships.userId, command.assignedToUserId),
                eq(organisationMemberships.status, "active"),
                isNull(organisationMemberships.delegatedByMembershipId),
                or(
                  isNull(organisationMemberships.accessStartsAt),
                  lte(organisationMemberships.accessStartsAt, authorityNow),
                ),
                or(
                  isNull(organisationMemberships.accessExpiresAt),
                  gt(organisationMemberships.accessExpiresAt, authorityNow),
                ),
                eq(users.status, "active"),
              ),
            )
            .limit(2);
          const assignee = assignees[0];
          if (
            assignees.length !== 1 ||
            !assignee?.name ||
            assignee.name !== assignee.name.trim() ||
            assignee.name.length > 512 ||
            /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(assignee.name)
          )
            return { outcome: "assignee_unavailable" };
          const assigneeGrants = await transaction
            .select({ id: roleGrants.id })
            .from(roleGrants)
            .where(
              and(
                eq(roleGrants.membershipId, assignee.membershipId),
                inArray(roleGrants.role, [...PRIVACY_MANAGE_ROLES]),
                isNull(roleGrants.revokedAt),
                or(
                  isNull(roleGrants.startsAt),
                  lte(roleGrants.startsAt, authorityNow),
                ),
                or(
                  isNull(roleGrants.expiresAt),
                  gt(roleGrants.expiresAt, authorityNow),
                ),
              ),
            )
            .limit(PRIVACY_MANAGE_ROLES.length + 1);
          if (
            assigneeGrants.length < 1 ||
            assigneeGrants.length > PRIVACY_MANAGE_ROLES.length
          ) {
            return { outcome: "assignee_unavailable" };
          }

          const [existing] = await transaction
            .select({
              version: dataSubjectRequests.version,
              status: dataSubjectRequests.status,
            })
            .from(dataSubjectRequests)
            .where(
              and(
                eq(dataSubjectRequests.organisationId, scope.organisationId),
                eq(dataSubjectRequests.id, command.id),
              ),
            )
            .limit(1);
          if (!existing) return { outcome: "not_found" };
          if (existing.version !== command.expectedVersion) {
            return { outcome: "version_conflict" };
          }
          if (
            ["completed", "cancelled", "rejected"].includes(existing.status)
          ) {
            return { outcome: "state_conflict" };
          }

          const [updated] = await transaction
            .update(dataSubjectRequests)
            .set({
              status: command.status,
              identityVerificationStatus: command.identityVerificationStatus,
              assignedToUserId: command.assignedToUserId,
              version: sql`${dataSubjectRequests.version} + 1`,
              updatedAt: recordedAt,
            })
            .where(
              and(
                eq(dataSubjectRequests.organisationId, scope.organisationId),
                eq(dataSubjectRequests.id, command.id),
                eq(dataSubjectRequests.version, command.expectedVersion),
              ),
            )
            .returning({ version: dataSubjectRequests.version });
          if (!updated) {
            return mutationMiss(
              transaction,
              dataSubjectRequests,
              scope.organisationId,
              command.id,
              command.expectedVersion,
            );
          }
          const workflow = createPrivacyWorkflowAuditDetails({
            eventType: "privacy.dsr_triage_recorded",
            objectId: command.id,
            actorUserId: scope.actorUserId,
            recordedAt: command.recordedAt,
            resultingVersion: updated.version,
            payload: {
              assignedToUserId: command.assignedToUserId,
              decisionEvidenceSha256: command.decisionEvidenceSha256,
              expectedVersion: command.expectedVersion,
              identityVerificationStatus: command.identityVerificationStatus,
              reasonCode: command.reasonCode,
              status: command.status,
            },
          });
          await writeAuditTx(transaction, {
            user: actor,
            organisationId: scope.organisationId,
            eventType: workflow.receipt.eventType,
            objectType: "data_subject_request",
            objectId: command.id,
            details: workflow.details,
          });
          return {
            outcome: "updated",
            resultingVersion: updated.version,
            receipt: workflow.receipt,
          };
        },
        { isolationLevel: "read committed" },
      ),
    );
  }

  async recordConsentWithdrawal(
    scope: PrivacyOperationsScope,
    command: PrivacyConsentWithdrawalCommand,
  ): Promise<PrivacyMutationOutcome> {
    return withTenantDatabase(scope.organisationId, () =>
      db.transaction(
        async (transaction) => {
          await lockPrivacyMembershipAdministration(
            transaction,
            scope.organisationId,
          );
          const authorityNow = new Date();
          const actor = await actorForAudit(
            transaction,
            scope.organisationId,
            scope.actorUserId,
            authorityNow,
          );
          const [existing] = await transaction
            .select({
              version: consentRecords.version,
              withdrawnAt: consentRecords.withdrawnAt,
              capturedAt: consentRecords.capturedAt,
            })
            .from(consentRecords)
            .where(
              and(
                eq(consentRecords.organisationId, scope.organisationId),
                eq(consentRecords.id, command.id),
              ),
            )
            .limit(1);
          if (!existing) return { outcome: "not_found" };
          if (existing.version !== command.expectedVersion) {
            return { outcome: "version_conflict" };
          }
          if (existing.withdrawnAt) return { outcome: "state_conflict" };
          if (new Date(command.withdrawnAt) < existing.capturedAt) {
            return { outcome: "state_conflict" };
          }

          const recordedAt = new Date(command.recordedAt);
          const [updated] = await transaction
            .update(consentRecords)
            .set({
              withdrawnAt: new Date(command.withdrawnAt),
              version: sql`${consentRecords.version} + 1`,
              updatedAt: recordedAt,
            })
            .where(
              and(
                eq(consentRecords.organisationId, scope.organisationId),
                eq(consentRecords.id, command.id),
                eq(consentRecords.version, command.expectedVersion),
                isNull(consentRecords.withdrawnAt),
              ),
            )
            .returning({ version: consentRecords.version });
          if (!updated) {
            return mutationMiss(
              transaction,
              consentRecords,
              scope.organisationId,
              command.id,
              command.expectedVersion,
            );
          }
          const workflow = createPrivacyWorkflowAuditDetails({
            eventType: "privacy.consent_withdrawal_recorded",
            objectId: command.id,
            actorUserId: scope.actorUserId,
            recordedAt: command.recordedAt,
            resultingVersion: updated.version,
            payload: {
              evidenceSha256: command.evidenceSha256,
              expectedVersion: command.expectedVersion,
              withdrawnAt: command.withdrawnAt,
            },
          });
          await writeAuditTx(transaction, {
            user: actor,
            organisationId: scope.organisationId,
            eventType: workflow.receipt.eventType,
            objectType: "consent_record",
            objectId: command.id,
            details: workflow.details,
          });
          return {
            outcome: "updated",
            resultingVersion: updated.version,
            receipt: workflow.receipt,
          };
        },
        { isolationLevel: "read committed" },
      ),
    );
  }

  async recordLegalHoldReview(
    scope: PrivacyOperationsScope,
    command: PrivacyHoldReviewCommand,
  ): Promise<PrivacyMutationOutcome> {
    return withTenantDatabase(scope.organisationId, () =>
      db.transaction(
        async (transaction) => {
          await lockPrivacyMembershipAdministration(
            transaction,
            scope.organisationId,
          );
          const authorityNow = new Date();
          const actor = await actorForAudit(
            transaction,
            scope.organisationId,
            scope.actorUserId,
            authorityNow,
          );
          const [existing] = await transaction
            .select({ version: legalHolds.version, status: legalHolds.status })
            .from(legalHolds)
            .where(
              and(
                eq(legalHolds.organisationId, scope.organisationId),
                eq(legalHolds.id, command.id),
              ),
            )
            .limit(1);
          if (!existing) return { outcome: "not_found" };
          if (existing.version !== command.expectedVersion) {
            return { outcome: "version_conflict" };
          }
          if (existing.status !== "active")
            return { outcome: "state_conflict" };

          const recordedAt = new Date(command.recordedAt);
          const [updated] = await transaction
            .update(legalHolds)
            .set({
              version: sql`${legalHolds.version} + 1`,
              updatedAt: recordedAt,
            })
            .where(
              and(
                eq(legalHolds.organisationId, scope.organisationId),
                eq(legalHolds.id, command.id),
                eq(legalHolds.version, command.expectedVersion),
                eq(legalHolds.status, "active"),
              ),
            )
            .returning({ version: legalHolds.version });
          if (!updated) {
            return mutationMiss(
              transaction,
              legalHolds,
              scope.organisationId,
              command.id,
              command.expectedVersion,
            );
          }
          const workflow = createPrivacyWorkflowAuditDetails({
            eventType: "privacy.legal_hold_review_recorded",
            objectId: command.id,
            actorUserId: scope.actorUserId,
            recordedAt: command.recordedAt,
            resultingVersion: updated.version,
            payload: {
              evidenceSha256: command.evidenceSha256,
              expectedVersion: command.expectedVersion,
              nextReviewAt: command.nextReviewAt,
              reviewOutcome: command.reviewOutcome,
            },
          });
          await writeAuditTx(transaction, {
            user: actor,
            organisationId: scope.organisationId,
            eventType: workflow.receipt.eventType,
            objectType: "legal_hold",
            objectId: command.id,
            details: workflow.details,
          });
          return {
            outcome: "updated",
            resultingVersion: updated.version,
            receipt: workflow.receipt,
          };
        },
        { isolationLevel: "read committed" },
      ),
    );
  }
}

export const postgresPrivacyOperationsRepository =
  new PostgresPrivacyOperationsRepository();
