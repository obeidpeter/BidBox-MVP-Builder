import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const canonicalRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const configuredOutputRoot = process.env.BIDBOX_CODEGEN_OUTPUT_ROOT?.trim();
const outputRoot = configuredOutputRoot
  ? path.resolve(configuredOutputRoot)
  : canonicalRoot;
const generatedClientPath = path.resolve(
  outputRoot,
  "lib",
  "api-client-react",
  "src",
  "generated",
  "api.ts",
);
const generatedSchemasPath = path.resolve(
  outputRoot,
  "lib",
  "api-client-react",
  "src",
  "generated",
  "api.schemas.ts",
);
const generatedZodPath = path.resolve(
  outputRoot,
  "lib",
  "api-zod",
  "src",
  "generated",
  "api.ts",
);
const generatedZodTypesIndexPath = path.resolve(
  outputRoot,
  "lib",
  "api-zod",
  "src",
  "generated",
  "types",
  "index.ts",
);
const generatedTenderContextCompanyEvidenceOptionPath = path.resolve(
  outputRoot,
  "lib",
  "api-zod",
  "src",
  "generated",
  "types",
  "tenderContextCompanyEvidenceOption.ts",
);

function withTrailingLineFeeds(source, count) {
  return source.replace(/(?:\r?\n)*$/, "\n".repeat(count));
}
const startMarker = "export const submitBidAutopsyRequest = async";
const endMarker = "export const getGetMeUrl";
const generatedClient = readFileSync(generatedClientPath, "utf8");
const start = generatedClient.indexOf(startMarker);
const end = generatedClient.indexOf(endMarker, start);

if (start < 0 || end < 0) {
  throw new Error("Generated Bid Autopsy operation markers were not found");
}

let operation = generatedClient.slice(start, end);

function replaceExact(search, replacement, expectedCount = 1) {
  const count = operation.split(search).length - 1;
  if (count !== expectedCount) {
    throw new Error(
      `Generated Bid Autopsy client drifted: expected ${expectedCount} occurrence(s) of ${JSON.stringify(search)}, found ${count}`,
    );
  }
  operation = operation.split(search).join(replacement);
}

replaceExact(
  "export const submitBidAutopsyRequest = async (bidAutopsyRequestCreate: BidAutopsyRequestCreate, options?: RequestInit)",
  "export const submitBidAutopsyRequest = async (bidAutopsyRequestCreate: BidAutopsyRequestCreate, idempotencyKey: string, options?: RequestInit)",
);
replaceExact(
  "headers: { 'Content-Type': 'application/json', ...options?.headers },",
  "headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey, ...options?.headers },",
);
replaceExact(
  "{data: BodyType<BidAutopsyRequestCreate>}",
  "{data: BodyType<BidAutopsyRequestCreate>; idempotencyKey: string}",
  5,
);
replaceExact(
  "const {data} = props ?? {};",
  "const {data, idempotencyKey} = props ?? {};",
);
replaceExact(
  "submitBidAutopsyRequest(data,requestOptions)",
  "submitBidAutopsyRequest(data,idempotencyKey,requestOptions)",
);

let patchedGeneratedClient =
  generatedClient.slice(0, start) + operation + generatedClient.slice(end);

function patchClientBlock(startMarker, endMarker, patch) {
  const start = patchedGeneratedClient.indexOf(startMarker);
  const end = patchedGeneratedClient.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error(
      `Generated React client markers were not found for ${startMarker}`,
    );
  }
  const source = patchedGeneratedClient.slice(start, end);
  const replacement = patch(source);
  if (replacement === source) {
    throw new Error(
      `Generated React client operation was not patched for ${startMarker}`,
    );
  }
  patchedGeneratedClient =
    patchedGeneratedClient.slice(0, start) +
    replacement +
    patchedGeneratedClient.slice(end);
}

function replaceClientBlockExact(startMarker, endMarker, replacements) {
  patchClientBlock(startMarker, endMarker, (source) => {
    for (const [search, replacement, expectedCount = 1] of replacements) {
      const count = source.split(search).length - 1;
      if (count !== expectedCount) {
        throw new Error(
          `Generated React client drifted for ${startMarker}: expected ${expectedCount} occurrence(s) of ${JSON.stringify(search)}, found ${count}`,
        );
      }
      source = source.split(search).join(replacement);
    }
    return source;
  });
}

function patchRequiredHeaderOperation({
  operationId,
  endMarker,
  bodyVariable,
  bodyType,
  mutationShape,
  destructure,
  call,
  headerVariable,
  headerName,
}) {
  replaceClientBlockExact(`export const ${operationId} = async`, endMarker, [
    [
      `${bodyVariable}: ${bodyType}, options?: RequestInit`,
      `${bodyVariable}: ${bodyType}, ${headerVariable}: string, options?: RequestInit`,
    ],
    [
      "headers: { 'Content-Type': 'application/json', ...options?.headers },",
      `headers: { 'Content-Type': 'application/json', '${headerName}': ${headerVariable}, ...options?.headers },`,
    ],
    [
      mutationShape,
      mutationShape.slice(0, -1) + `;${headerVariable}: string}`,
      5,
    ],
    [destructure, destructure.replace("} =", `,${headerVariable}} =`)],
    [
      call,
      call.replace(",requestOptions)", `,${headerVariable},requestOptions)`),
    ],
  ]);
}

function patchRequiredRetentionHeadersOperation({
  operationId,
  endMarker,
  mutationShape,
  destructure,
  call,
}) {
  replaceClientBlockExact(`export const ${operationId} = async`, endMarker, [
    [
      "retentionCompletionAttestation: RetentionCompletionAttestation, options?: RequestInit",
      "retentionCompletionAttestation: RetentionCompletionAttestation, ifMatch: string, idempotencyKey: string, options?: RequestInit",
    ],
    [
      "headers: { 'Content-Type': 'application/json', ...options?.headers },",
      "headers: { 'Content-Type': 'application/json', 'If-Match': ifMatch, 'Idempotency-Key': idempotencyKey, ...options?.headers },",
    ],
    [
      mutationShape,
      mutationShape.slice(0, -1) + ";ifMatch: string;idempotencyKey: string}",
      5,
    ],
    [destructure, destructure.replace("} =", ",ifMatch,idempotencyKey} =")],
    [
      call,
      call.replace(
        ",requestOptions)",
        ",ifMatch,idempotencyKey,requestOptions)",
      ),
    ],
  ]);
}

function patchRequiredConcurrencyHeadersOperation({
  operationId,
  endMarker,
  bodyVariable,
  bodyType,
  mutationShape,
  destructure,
  call,
}) {
  replaceClientBlockExact(`export const ${operationId} = async`, endMarker, [
    [
      `${bodyVariable}: ${bodyType}, options?: RequestInit`,
      `${bodyVariable}: ${bodyType}, ifMatch: string, idempotencyKey: string, options?: RequestInit`,
    ],
    [
      "headers: { 'Content-Type': 'application/json', ...options?.headers },",
      "headers: { 'Content-Type': 'application/json', 'If-Match': ifMatch, 'Idempotency-Key': idempotencyKey, ...options?.headers },",
    ],
    [
      mutationShape,
      mutationShape.slice(0, -1) + ";ifMatch: string;idempotencyKey: string}",
      5,
    ],
    [destructure, destructure.replace("} =", ",ifMatch,idempotencyKey} =")],
    [
      call,
      call.replace(
        ",requestOptions)",
        ",ifMatch,idempotencyKey,requestOptions)",
      ),
    ],
  ]);
}

patchRequiredHeaderOperation({
  operationId: "promoteFieldDraftToOperationsWorkItem",
  endMarker: "export const getDecideOperationsWorkItemApprovalUrl",
  bodyVariable: "operationsFieldDraftPromotionRequest",
  bodyType: "OperationsFieldDraftPromotionRequest",
  mutationShape:
    "{id: string;recordId: string;data: BodyType<OperationsFieldDraftPromotionRequest>}",
  destructure: "const {id,recordId,data} = props ?? {};",
  call: "promoteFieldDraftToOperationsWorkItem(id,recordId,data,requestOptions)",
  headerVariable: "idempotencyKey",
  headerName: "Idempotency-Key",
});

patchRequiredHeaderOperation({
  operationId: "issueClientActionUploadLease",
  endMarker: "export const getFinalizeClientActionUploadLeaseUrl",
  bodyVariable: "clientActionUploadLeaseRequest",
  bodyType: "ClientActionUploadLeaseRequest",
  mutationShape:
    "{id: string;recordId: string;slotId: string;data: BodyType<ClientActionUploadLeaseRequest>}",
  destructure: "const {id,recordId,slotId,data} = props ?? {};",
  call: "issueClientActionUploadLease(id,recordId,slotId,data,requestOptions)",
  headerVariable: "idempotencyKey",
  headerName: "Idempotency-Key",
});

patchRequiredHeaderOperation({
  operationId: "finalizeClientActionUploadLease",
  endMarker: "export const getAttachClientEvidenceDocumentUrl",
  bodyVariable: "clientActionUploadLeaseRequest",
  bodyType: "ClientActionUploadLeaseRequest",
  mutationShape:
    "{id: string;recordId: string;slotId: string;leaseId: string;data: BodyType<ClientActionUploadLeaseRequest>}",
  destructure: "const {id,recordId,slotId,leaseId,data} = props ?? {};",
  call: "finalizeClientActionUploadLease(id,recordId,slotId,leaseId,data,requestOptions)",
  headerVariable: "idempotencyKey",
  headerName: "Idempotency-Key",
});

patchRequiredHeaderOperation({
  operationId: "confirmOpportunityPursuitHandoff",
  endMarker: "export const getGetEvidenceRenewalSnapshotUrl",
  bodyVariable: "opportunityPursuitHandoffConfirmation",
  bodyType: "OpportunityPursuitHandoffConfirmation",
  mutationShape:
    "{candidateId: string;data: BodyType<OpportunityPursuitHandoffConfirmation>}",
  destructure: "const {candidateId,data} = props ?? {};",
  call: "confirmOpportunityPursuitHandoff(candidateId,data,requestOptions)",
  headerVariable: "idempotencyKey",
  headerName: "Idempotency-Key",
});

patchRequiredHeaderOperation({
  operationId: "stageEvidenceRenewalReplacement",
  endMarker: "export const getReviewEvidenceRenewalReplacementUrl",
  bodyVariable: "evidenceRenewalStageDraft",
  bodyType: "EvidenceRenewalStageDraft",
  mutationShape:
    "{projectId: string;planId: string;data: BodyType<EvidenceRenewalStageDraft>}",
  destructure: "const {projectId,planId,data} = props ?? {};",
  call: "stageEvidenceRenewalReplacement(projectId,planId,data,requestOptions)",
  headerVariable: "ifMatch",
  headerName: "If-Match",
});

patchRequiredHeaderOperation({
  operationId: "reviewEvidenceRenewalReplacement",
  endMarker: "export const getGetReconciledCommunicationsUrl",
  bodyVariable: "evidenceRenewalReviewDraft",
  bodyType: "EvidenceRenewalReviewDraft",
  mutationShape:
    "{projectId: string;planId: string;data: BodyType<EvidenceRenewalReviewDraft>}",
  destructure: "const {projectId,planId,data} = props ?? {};",
  call: "reviewEvidenceRenewalReplacement(projectId,planId,data,requestOptions)",
  headerVariable: "ifMatch",
  headerName: "If-Match",
});

patchRequiredHeaderOperation({
  operationId: "reviewDocumentVersionSnapshot",
  endMarker: "export const getGetTenderContextCentreUrl",
  bodyVariable: "documentVersionSnapshotReviewRequest",
  bodyType: "DocumentVersionSnapshotReviewRequest",
  mutationShape:
    "{id: string;snapshotId: string;data: BodyType<DocumentVersionSnapshotReviewRequest>}",
  destructure: "const {id,snapshotId,data} = props ?? {};",
  call: "reviewDocumentVersionSnapshot(id,snapshotId,data,requestOptions)",
  headerVariable: "ifMatch",
  headerName: "If-Match",
});

patchRequiredHeaderOperation({
  operationId: "reviewTenderContextVersion",
  endMarker: "export const getCreateTenderEligibilityPassportUrl",
  bodyVariable: "tenderNamedReviewRequest",
  bodyType: "TenderNamedReviewRequest",
  mutationShape:
    "{id: string;contextVersionId: string;data: BodyType<TenderNamedReviewRequest>}",
  destructure: "const {id,contextVersionId,data} = props ?? {};",
  call: "reviewTenderContextVersion(id,contextVersionId,data,requestOptions)",
  headerVariable: "ifMatch",
  headerName: "If-Match",
});

patchRequiredHeaderOperation({
  operationId: "reviewTenderEligibilityPassport",
  endMarker: "export const getGetAddendumImpactCentreUrl",
  bodyVariable: "tenderNamedReviewRequest",
  bodyType: "TenderNamedReviewRequest",
  mutationShape:
    "{id: string;passportRecordId: string;data: BodyType<TenderNamedReviewRequest>}",
  destructure: "const {id,passportRecordId,data} = props ?? {};",
  call: "reviewTenderEligibilityPassport(id,passportRecordId,data,requestOptions)",
  headerVariable: "ifMatch",
  headerName: "If-Match",
});

patchRequiredHeaderOperation({
  operationId: "replayStorageDeletionDeadLetter",
  endMarker: "export const getResolveStorageDeletionDeadLetterUrl",
  bodyVariable: "storageDeletionOperatorReason",
  bodyType: "StorageDeletionOperatorReason",
  mutationShape: "{id: string;data: BodyType<StorageDeletionOperatorReason>}",
  destructure: "const {id,data} = props ?? {};",
  call: "replayStorageDeletionDeadLetter(id,data,requestOptions)",
  headerVariable: "ifMatch",
  headerName: "If-Match",
});

patchRequiredHeaderOperation({
  operationId: "resolveStorageDeletionDeadLetter",
  endMarker: "export const getCompleteRetentionRequestUrl",
  bodyVariable: "storageDeletionOperatorReason",
  bodyType: "StorageDeletionOperatorReason",
  mutationShape: "{id: string;data: BodyType<StorageDeletionOperatorReason>}",
  destructure: "const {id,data} = props ?? {};",
  call: "resolveStorageDeletionDeadLetter(id,data,requestOptions)",
  headerVariable: "ifMatch",
  headerName: "If-Match",
});

patchRequiredRetentionHeadersOperation({
  operationId: "completeRetentionRequest",
  endMarker: "export const getReconcileRetentionActionUrl",
  mutationShape: "{id: string;data: BodyType<RetentionCompletionAttestation>}",
  destructure: "const {id,data} = props ?? {};",
  call: "completeRetentionRequest(id,data,requestOptions)",
});

patchRequiredRetentionHeadersOperation({
  operationId: "reconcileRetentionAction",
  endMarker: "export const getCertifyRetentionActionUrl",
  mutationShape: "{id: string;data: BodyType<RetentionCompletionAttestation>}",
  destructure: "const {id,data} = props ?? {};",
  call: "reconcileRetentionAction(id,data,requestOptions)",
});

patchRequiredRetentionHeadersOperation({
  operationId: "certifyRetentionAction",
  endMarker: "export const getGetAppConfigUrl",
  mutationShape: "{id: string;data: BodyType<RetentionCompletionAttestation>}",
  destructure: "const {id,data} = props ?? {};",
  call: "certifyRetentionAction(id,data,requestOptions)",
});

patchRequiredConcurrencyHeadersOperation({
  operationId: "runDeliveryStudioAction",
  endMarker: "export const getGetPortfolioIntelligenceUrl",
  bodyVariable: "deliveryStudioAction",
  bodyType: "DeliveryStudioAction",
  mutationShape: "{projectId: string;data: BodyType<DeliveryStudioAction>}",
  destructure: "const {projectId,data} = props ?? {};",
  call: "runDeliveryStudioAction(projectId,data,requestOptions)",
});

replaceClientBlockExact(
  "export const exportProject = async",
  "export const getGetProjectCostUrl",
  [
    [
      "projectExportRequest: ProjectExportRequest, options?: RequestInit",
      "projectExportRequest: ProjectExportRequest, idempotencyKey: string, ifMatch: string, options?: RequestInit",
    ],
    [
      "headers: { 'Content-Type': 'application/json', ...options?.headers },",
      "headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey, 'If-Match': ifMatch, ...options?.headers },",
    ],
    [
      "{id: string;data: BodyType<ProjectExportRequest>}",
      "{id: string;data: BodyType<ProjectExportRequest>;idempotencyKey: string;ifMatch: string}",
      5,
    ],
    [
      "const {id,data} = props ?? {};",
      "const {id,data,idempotencyKey,ifMatch} = props ?? {};",
    ],
    [
      "exportProject(id,data,requestOptions)",
      "exportProject(id,data,idempotencyKey,ifMatch,requestOptions)",
    ],
  ],
);

writeFileSync(
  generatedClientPath,
  withTrailingLineFeeds(patchedGeneratedClient, 1),
);

let generatedZod = readFileSync(generatedZodPath, "utf8");
const zodStartMarker =
  "export const SubmitBidAutopsyRequestBody = zod.object({";
const zodEndMarker = "export const SubmitBidAutopsyRequestResponse";
const zodStart = generatedZod.indexOf(zodStartMarker);
const zodEnd = generatedZod.indexOf(zodEndMarker, zodStart);

if (zodStart < 0 || zodEnd < 0) {
  throw new Error("Generated Bid Autopsy Zod schema markers were not found");
}

let requestBodySchema = generatedZod.slice(zodStart, zodEnd);

function replaceZodExact(search, replacement, expectedCount = 1) {
  const count = requestBodySchema.split(search).length - 1;
  if (count !== expectedCount) {
    throw new Error(
      `Generated Bid Autopsy Zod schema drifted: expected ${expectedCount} occurrence(s) of ${JSON.stringify(search)}, found ${count}`,
    );
  }
  requestBodySchema = requestBodySchema.split(search).join(replacement);
}

replaceZodExact(
  '"privacyNoticeAcknowledged": zod.boolean(),',
  '"privacyNoticeAcknowledged": zod.literal(true),',
);
replaceZodExact("\n})\n\n", "\n}).strict()\n\n");

generatedZod =
  generatedZod.slice(0, zodStart) +
  requestBodySchema +
  generatedZod.slice(zodEnd);

function patchZodBlock(startMarker, endMarker, patch) {
  const start = generatedZod.indexOf(startMarker);
  const end = generatedZod.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error(
      `Generated Zod operation markers were not found for ${startMarker}`,
    );
  }
  const source = generatedZod.slice(start, end);
  const replacement = patch(source);
  if (replacement === source) {
    throw new Error(
      `Generated Zod operation was not patched for ${startMarker}`,
    );
  }
  generatedZod =
    generatedZod.slice(0, start) + replacement + generatedZod.slice(end);
}

function replaceZodBlockExact(startMarker, endMarker, replacements) {
  patchZodBlock(startMarker, endMarker, (operation) => {
    for (const [search, replacement, expectedCount = 1] of replacements) {
      const count = operation.split(search).length - 1;
      if (count !== expectedCount) {
        throw new Error(
          `Generated Zod contract drifted for ${startMarker}: expected ${expectedCount} occurrence(s) of ${JSON.stringify(search)}, found ${count}`,
        );
      }
      operation = operation.split(search).join(replacement);
    }
    return operation;
  });
}

replaceZodBlockExact(
  "export const ListProjectPackageVersionsResponse = zod.object({",
  "export const ExportProjectParams",
  [
    ['"limit": zod.number(),', '"limit": zod.literal(100),'],
    [
      "}).describe('Metadata-only identity for the current canonical project-export package version. Archive contents and storage locations are excluded.')).max",
      "}).strict().describe('Metadata-only identity for the current canonical project-export package version. Archive contents and storage locations are excluded.')).max",
    ],
    ["\n})\n\n", "\n}).strict()\n\n"],
  ],
);

replaceZodBlockExact(
  "export const ListGrowthLeadsResponse = zod.object({",
  "export const MutateGrowthLeadParams",
  [
    [
      '"contactDataIncluded": zod.boolean(),',
      '"contactDataIncluded": zod.literal(false),',
    ],
  ],
);

replaceZodBlockExact(
  "export const MutateGrowthLeadBody = zod.union([zod.object({",
  "export const mutateGrowthLeadResponseItemIdMax",
  [
    [
      '"assigneeUserId": zod.string().min(1).max(mutateGrowthLeadBodyOneAssigneeUserIdMax)\n}),zod.union',
      '"assigneeUserId": zod.string().min(1).max(mutateGrowthLeadBodyOneAssigneeUserIdMax)\n}).strict(),zod.union',
    ],
    [
      '"reason": zod.string().min(1).max(mutateGrowthLeadBodyTwoOneReasonMax)\n}),zod.object',
      '"reason": zod.string().min(1).max(mutateGrowthLeadBodyTwoOneReasonMax)\n}).strict(),zod.object',
    ],
    [
      '"receiptSha256": zod.string().regex(mutateGrowthLeadBodyTwoTwoReceiptSha256RegExp)\n})]),zod.object',
      '"receiptSha256": zod.string().regex(mutateGrowthLeadBodyTwoTwoReceiptSha256RegExp)\n}).strict()]),zod.object',
    ],
    [
      '"slaDueAt": zod.coerce.date()\n}),zod.object',
      '"slaDueAt": zod.coerce.date()\n}).strict(),zod.object',
    ],
    [
      '"rationale": zod.string().min(1).max(mutateGrowthLeadBodyFourRationaleMax)\n})])',
      '"rationale": zod.string().min(1).max(mutateGrowthLeadBodyFourRationaleMax)\n}).strict()])',
    ],
  ],
);

replaceZodBlockExact(
  "export const OpenGrowthLeadContactHandoffBody = zod.object({",
  "export const openGrowthLeadContactHandoffResponseHandoffOneLeadIdMax",
  [["\n})\n\n", "\n}).strict()\n\n"]],
);

replaceZodBlockExact(
  "export const OpenGrowthLeadContactHandoffResponse = zod.object({",
  "export const listGrowthQuotesQueryLimitDefault",
  [
    [
      '"contactDataIncluded": zod.boolean(),',
      '"contactDataIncluded": zod.literal(true),',
    ],
    [
      '"version": zod.number().min(1)\n}),zod.object',
      '"version": zod.number().min(1)\n}).strict(),zod.object',
    ],
    [
      '"version": zod.number().min(1)\n})]).describe',
      '"version": zod.number().min(1)\n}).strict()]).describe',
    ],
    ["\n})\n\n", "\n}).strict()\n\n"],
  ],
);

patchZodBlock(
  "export const GetOperationsMobileQueueResponse = zod.object({",
  "export const GetOperationsRecordParams",
  (operation) => {
    const replacements = [
      [
        '"restrictedContent": zod.boolean(),',
        '"restrictedContent": zod.literal(true),',
      ],
      ['"maxItems": zod.number(),', '"maxItems": zod.literal(250),'],
      [
        '"restrictedContent": zod.boolean()\n}))',
        '"restrictedContent": zod.literal(true)\n}))',
      ],
    ];
    for (const [search, replacement] of replacements) {
      const count = operation.split(search).length - 1;
      if (count !== 1) {
        throw new Error(
          `Generated mobile-queue Zod contract drifted: expected one ${JSON.stringify(search)}, found ${count}`,
        );
      }
      operation = operation.replace(search, replacement);
    }
    return operation;
  },
);

function requireCancellationReason(startMarker, endMarker, statusField) {
  patchZodBlock(startMarker, endMarker, (operation) => {
    const end = operation.lastIndexOf("}))");
    if (end < 0) {
      throw new Error(
        `Generated cancellation Zod contract drifted for ${startMarker}`,
      );
    }
    return `${operation.slice(0, end + 3)}.superRefine((value, context) => {
  if (value.${statusField} === "cancelled" && !value.reason) {
    context.addIssue({
      code: zod.ZodIssueCode.custom,
      path: ["reason"],
      message: "reason is required when status is cancelled",
    });
  }
})${operation.slice(end + 3)}`;
  });
}

requireCancellationReason(
  "export const UpdateOperationsWorkItemBody =",
  "export const updateOperationsWorkItemResponseTwoTitleMax",
  "status",
);
requireCancellationReason(
  "export const AdvanceOperationsSubmissionWarRoomBody =",
  "export const advanceOperationsSubmissionWarRoomResponseTwoManifestSha256RegExp",
  "toStatus",
);
requireCancellationReason(
  "export const UpdateOperationsMissionBody =",
  "export const updateOperationsMissionResponseTwoTitleMax",
  "status",
);
requireCancellationReason(
  "export const UpdateOperationsPostAwardItemBody =",
  "export const updateOperationsPostAwardItemResponseTwoTitleMax",
  "status",
);

for (const [startMarker, endMarker] of [
  [
    "export const IssueClientActionUploadLeaseResponse = zod.object({",
    "export const FinalizeClientActionUploadLeaseParams",
  ],
  [
    "export const FinalizeClientActionUploadLeaseResponse = zod.object({",
    "export const AttachClientEvidenceDocumentParams",
  ],
]) {
  replaceZodBlockExact(startMarker, endMarker, [
    [
      '"replayed": zod.literal(true),',
      '"replayed": zod.union([zod.literal(true), zod.literal(false)]),',
    ],
  ]);
}

function hardenIntegerOperation(startMarker, endMarker, expectedIntegerCount) {
  patchZodBlock(startMarker, endMarker, (operation) => {
    const rawIntegerCount = operation.split("zod.number()").length - 1;
    if (rawIntegerCount !== expectedIntegerCount) {
      throw new Error(
        `Generated integer contract drifted for ${startMarker}: expected ${expectedIntegerCount} raw number schema(s), found ${rawIntegerCount}`,
      );
    }
    return operation.replaceAll("zod.number()", "zod.number().int().safe()");
  });
}

for (const [startMarker, endMarker, expectedIntegerCount] of [
  [
    "export const GetCurrentDocumentVersionSnapshotParams =",
    "export const CaptureDocumentVersionSnapshotParams =",
    10,
  ],
  [
    "export const CaptureDocumentVersionSnapshotParams =",
    "export const ReviewDocumentVersionSnapshotParams =",
    19,
  ],
  [
    "export const ReviewDocumentVersionSnapshotParams =",
    "export const GetTenderContextCentreParams =",
    10,
  ],
  [
    "export const GetTenderContextCentreParams =",
    "export const CreateTenderContextVersionParams =",
    14,
  ],
  [
    "export const CreateTenderContextVersionParams =",
    "export const ReviewTenderContextVersionParams =",
    6,
  ],
  [
    "export const ReviewTenderContextVersionParams =",
    "export const CreateTenderEligibilityPassportParams =",
    4,
  ],
  [
    "export const CreateTenderEligibilityPassportParams =",
    "export const ReviewTenderEligibilityPassportParams =",
    7,
  ],
  [
    "export const ReviewTenderEligibilityPassportParams =",
    "export const GetAddendumImpactCentreParams =",
    7,
  ],
  [
    "export const GetAddendumImpactCentreParams =",
    "export const ReviewAddendumImpactParams =",
    12,
  ],
  [
    "export const ReviewAddendumImpactParams =",
    "export const ApplyAddendumImpactParams =",
    13,
  ],
  [
    "export const ApplyAddendumImpactParams =",
    "export const SearchProjectIntelligenceEvidenceParams =",
    2,
  ],
  [
    "export const GetDeliveryStudioParams =",
    "export const RunDeliveryStudioActionParams =",
    11,
  ],
  [
    "export const RunDeliveryStudioActionParams =",
    "export const GetPortfolioIntelligenceResponse =",
    26,
  ],
  [
    "export const GetPortfolioIntelligenceResponse =",
    "export const RequestUploadUrlResponse =",
    6,
  ],
]) {
  hardenIntegerOperation(startMarker, endMarker, expectedIntegerCount);
}

const firstWaveDateOnlyFields = new Set([
  "submissionDate",
  "validFrom",
  "validUntil",
]);

function preserveFirstWaveJsonDates(startMarker, endMarker, expectedDateCount) {
  patchZodBlock(startMarker, endMarker, (operation) => {
    let dateCount = 0;
    const replacement = operation.replace(
      /"([A-Za-z0-9]+)": zod\.date\(\)/gu,
      (match, fieldName) => {
        dateCount += 1;
        if (firstWaveDateOnlyFields.has(fieldName)) {
          return `"${fieldName}": zod.string().date()`;
        }
        return `"${fieldName}": zod.string().datetime({ offset: true })`;
      },
    );
    if (dateCount !== expectedDateCount) {
      throw new Error(
        `Generated first-wave JSON date contract drifted for ${startMarker}: expected ${expectedDateCount} date schema(s), found ${dateCount}`,
      );
    }
    return replacement;
  });
}

for (const [startMarker, endMarker, expectedDateCount] of [
  [
    "export const GetCurrentDocumentVersionSnapshotParams =",
    "export const CaptureDocumentVersionSnapshotParams =",
    2,
  ],
  [
    "export const CaptureDocumentVersionSnapshotParams =",
    "export const ReviewDocumentVersionSnapshotParams =",
    2,
  ],
  [
    "export const ReviewDocumentVersionSnapshotParams =",
    "export const GetTenderContextCentreParams =",
    2,
  ],
  [
    "export const GetTenderContextCentreParams =",
    "export const CreateTenderContextVersionParams =",
    16,
  ],
  [
    "export const CreateTenderContextVersionParams =",
    "export const ReviewTenderContextVersionParams =",
    6,
  ],
  [
    "export const ReviewTenderContextVersionParams =",
    "export const CreateTenderEligibilityPassportParams =",
    5,
  ],
  [
    "export const CreateTenderEligibilityPassportParams =",
    "export const ReviewTenderEligibilityPassportParams =",
    9,
  ],
  [
    "export const ReviewTenderEligibilityPassportParams =",
    "export const GetAddendumImpactCentreParams =",
    9,
  ],
  [
    "export const GetAddendumImpactCentreParams =",
    "export const ReviewAddendumImpactParams =",
    4,
  ],
  [
    "export const ReviewAddendumImpactParams =",
    "export const ApplyAddendumImpactParams =",
    4,
  ],
  [
    "export const ApplyAddendumImpactParams =",
    "export const SearchProjectIntelligenceEvidenceParams =",
    1,
  ],
]) {
  preserveFirstWaveJsonDates(startMarker, endMarker, expectedDateCount);
}

function preserveJsonDateTimeOperation(
  startMarker,
  endMarker,
  expectedDateCount,
) {
  patchZodBlock(startMarker, endMarker, (operation) => {
    const rawDateCount = operation.split("zod.date()").length - 1;
    if (rawDateCount !== expectedDateCount) {
      throw new Error(
        `Generated JSON date-time contract drifted for ${startMarker}: expected ${expectedDateCount} date schema(s), found ${rawDateCount}`,
      );
    }
    return operation.replaceAll(
      "zod.date()",
      "zod.string().datetime({ offset: true })",
    );
  });
}

for (const [startMarker, endMarker, expectedDateCount] of [
  [
    "export const GetDeliveryStudioParams =",
    "export const RunDeliveryStudioActionParams =",
    6,
  ],
  [
    "export const RunDeliveryStudioActionParams =",
    "export const GetPortfolioIntelligenceResponse =",
    6,
  ],
  [
    "export const GetPortfolioIntelligenceResponse =",
    "export const RequestUploadUrlResponse =",
    1,
  ],
]) {
  preserveJsonDateTimeOperation(startMarker, endMarker, expectedDateCount);
}

function refineFirstWaveSchemaMatches(
  startMarker,
  endMarker,
  pattern,
  expectedCount,
  refinement,
  contractName,
) {
  patchZodBlock(startMarker, endMarker, (operation) => {
    let count = 0;
    const replacement = operation.replace(pattern, (schema) => {
      count += 1;
      return `${schema}${refinement}`;
    });
    if (count !== expectedCount) {
      throw new Error(
        `Generated ${contractName} contract drifted for ${startMarker}: expected ${expectedCount} schema(s), found ${count}`,
      );
    }
    return replacement;
  });
}

const citationOffsetRefinement = `.superRefine((value, context) => {
  if (
    (value.startOffset === undefined) !== (value.endOffset === undefined) ||
    (value.startOffset !== undefined &&
      value.endOffset !== undefined &&
      value.endOffset <= value.startOffset)
  ) {
    context.addIssue({
      code: zod.ZodIssueCode.custom,
      path: ["endOffset"],
      message: "Citation offsets must be supplied together and end after start",
    });
  }
})`;

refineFirstWaveSchemaMatches(
  "export const RunDeliveryStudioActionParams =",
  "export const GetPortfolioIntelligenceResponse =",
  /"startOffset": [^\n]+\.optional\(\),\n  "endOffset": [^\n]+\.optional\(\)\n\}\)\.strict\(\)/gu,
  1,
  citationOffsetRefinement,
  "Delivery Studio response-citation offsets",
);
refineFirstWaveSchemaMatches(
  "export const RunDeliveryStudioActionParams =",
  "export const GetPortfolioIntelligenceResponse =",
  /"startOffset": [^\n]+,\n  "endOffset": [^\n]+,\n  "quote": [^\n]+,\n  "page": [^\n]+\.optional\(\),\n  "section": [^\n]+\.optional\(\)\n\}\)\.strict\(\)/gu,
  3,
  citationOffsetRefinement,
  "Delivery Studio rehearsal-citation offsets",
);

const responseClaimCitationRefinement = `.superRefine((value, context) => {
  if (value.kind !== "opinion" && value.citations.length === 0) {
    context.addIssue({
      code: zod.ZodIssueCode.custom,
      path: ["citations"],
      message: "Factual and instructional claims require at least one exact source citation",
    });
  }
})`;

refineFirstWaveSchemaMatches(
  "export const RunDeliveryStudioActionParams =",
  "export const GetPortfolioIntelligenceResponse =",
  /"kind": zod\.enum\(\['factual', 'instructional', 'opinion'\]\)(?:\.describe\([^\r\n]+\))?,\r?\n  "supportMode": [^\r\n]+\.optional\(\),\r?\n  "citations": zod\.array\([\s\S]*?\)\.max\([A-Za-z0-9_]+\)(?:\.describe\([^\r\n]+\))?\r?\n\}\)\.strict\(\)/gu,
  1,
  responseClaimCitationRefinement,
  "Delivery Studio response-claim citation requirement",
);

const uniqueValuesRefinement = `.refine(
  (values) => new Set(values).size === values.length,
  { message: "Values must be unique" },
)`;

for (const fieldName of ["entityScopes", "categoryScopes"]) {
  refineFirstWaveSchemaMatches(
    "export const CreateTenderContextVersionParams =",
    "export const ReviewTenderContextVersionParams =",
    new RegExp(
      `("${fieldName}": zod\\.array\\([^\\n]+\\)\\.min\\(1\\)\\.max\\([^\\n]+\\))`,
      "gu",
    ),
    1,
    uniqueValuesRefinement,
    `${fieldName} unique-items`,
  );
}

for (const [startMarker, endMarker] of [
  [
    "export const GetAddendumImpactCentreParams =",
    "export const ReviewAddendumImpactParams =",
  ],
  [
    "export const ReviewAddendumImpactParams =",
    "export const ApplyAddendumImpactParams =",
  ],
]) {
  for (const fieldName of ["changeIds", "fieldExternalIds"]) {
    refineFirstWaveSchemaMatches(
      startMarker,
      endMarker,
      new RegExp(
        `("${fieldName}": zod\\.array\\([^\\n]+\\)\\.max\\([^\\n]+\\))`,
        "gu",
      ),
      1,
      uniqueValuesRefinement,
      `${fieldName} unique-items`,
    );
  }
}

const documentSnapshotAuthorityPattern =
  /"status": zod\.enum\(\['captured', 'verified', 'rejected'\]\),\n  "capturedByUserId": zod\.string\(\)\.uuid\(\),\n  "capturedByName": zod\.string\(\)\.min\(1\)\.max\([^\n]+\),\n  "verifiedByUserId": zod\.string\(\)\.uuid\(\)\.nullable\(\),\n  "verifiedByName": zod\.string\(\)\.max\([^\n]+\)\.nullable\(\),\n  "verifiedAt": zod\.string\(\)\.datetime\(\{ offset: true \}\)\.nullable\(\),\n  "version": zod\.number\(\)\.int\(\)\.safe\(\)\.min\(1\),\n  "createdAt": zod\.string\(\)\.datetime\(\{ offset: true \}\)\n\}\)\.strict\(\)/gu;
const documentSnapshotAuthorityRefinement = `.superRefine((value, context) => {
  const captured = value.status === "captured";
  const completeVerificationStamp =
    value.verifiedByUserId !== null &&
    value.verifiedByName !== null &&
    value.verifiedByName.length > 0 &&
    value.verifiedAt !== null;
  if (
    (captured &&
      (value.verifiedByUserId !== null ||
        value.verifiedByName !== null ||
        value.verifiedAt !== null)) ||
    (!captured &&
      (!completeVerificationStamp ||
        value.verifiedByUserId === value.capturedByUserId))
  ) {
    context.addIssue({
      code: zod.ZodIssueCode.custom,
      path: ["status"],
      message: "Snapshot status and named verification stamp are inconsistent",
    });
  }
})`;

for (const [startMarker, endMarker] of [
  [
    "export const GetCurrentDocumentVersionSnapshotParams =",
    "export const CaptureDocumentVersionSnapshotParams =",
  ],
  [
    "export const CaptureDocumentVersionSnapshotParams =",
    "export const ReviewDocumentVersionSnapshotParams =",
  ],
  [
    "export const ReviewDocumentVersionSnapshotParams =",
    "export const GetTenderContextCentreParams =",
  ],
]) {
  refineFirstWaveSchemaMatches(
    startMarker,
    endMarker,
    documentSnapshotAuthorityPattern,
    1,
    documentSnapshotAuthorityRefinement,
    "document snapshot authority",
  );
}

const tenderNamedReviewPattern =
  /"state": zod\.enum\(\['pending_review', 'accepted', 'needs_changes', 'rejected'\]\),\n  "reviewedByUserId": zod\.string\(\)\.uuid\(\)\.nullable\(\),\n  "reviewedByName": zod\.string\(\)\.max\([^\n]+\)\.nullable\(\),\n  "reviewedAt": zod\.string\(\)\.datetime\(\{ offset: true \}\)\.nullable\(\),\n  "note": zod\.string\(\)\.max\([^\n]+\)\.nullable\(\)\n\}\)\.strict\(\)/gu;
const tenderNamedReviewRefinement = `.superRefine((value, context) => {
  const pending = value.state === "pending_review";
  const completeReviewStamp =
    value.reviewedByUserId !== null &&
    value.reviewedByName !== null &&
    value.reviewedByName.length > 0 &&
    value.reviewedAt !== null;
  if (
    (pending &&
      (value.reviewedByUserId !== null ||
        value.reviewedByName !== null ||
        value.reviewedAt !== null)) ||
    (!pending && !completeReviewStamp)
  ) {
    context.addIssue({
      code: zod.ZodIssueCode.custom,
      path: ["state"],
      message: "Review state and named reviewer stamp are inconsistent",
    });
  }
})`;

for (const [startMarker, endMarker, expectedCount] of [
  [
    "export const GetTenderContextCentreParams =",
    "export const CreateTenderContextVersionParams =",
    2,
  ],
  [
    "export const CreateTenderContextVersionParams =",
    "export const ReviewTenderContextVersionParams =",
    1,
  ],
  [
    "export const ReviewTenderContextVersionParams =",
    "export const CreateTenderEligibilityPassportParams =",
    1,
  ],
  [
    "export const CreateTenderEligibilityPassportParams =",
    "export const ReviewTenderEligibilityPassportParams =",
    1,
  ],
  [
    "export const ReviewTenderEligibilityPassportParams =",
    "export const GetAddendumImpactCentreParams =",
    1,
  ],
]) {
  refineFirstWaveSchemaMatches(
    startMarker,
    endMarker,
    tenderNamedReviewPattern,
    expectedCount,
    tenderNamedReviewRefinement,
    "named-review authority",
  );
}

const tenderHumanReviewPattern =
  /"state": zod\.enum\(\['unreviewed', 'accepted', 'rejected', 'needs_changes'\]\),\n  "reviewerId": [^\n]+\.optional\(\),\n  "reviewedAt": zod\.string\(\)\.datetime\(\{ offset: true \}\)\.optional\(\),\n  "note": zod\.string\(\)\.max\([^\n]+\)\.optional\(\)\n\}\)\.strict\(\)/gu;
const tenderHumanReviewRefinement = `.superRefine((value, context) => {
  if (
    value.state !== "unreviewed" &&
    (!value.reviewerId || !value.reviewedAt)
  ) {
    context.addIssue({
      code: zod.ZodIssueCode.custom,
      path: ["state"],
      message: "A recorded decision requires its reviewer and review time",
    });
  }
})`;

for (const [startMarker, endMarker, expectedCount] of [
  [
    "export const GetTenderContextCentreParams =",
    "export const CreateTenderContextVersionParams =",
    3,
  ],
  [
    "export const CreateTenderEligibilityPassportParams =",
    "export const ReviewTenderEligibilityPassportParams =",
    3,
  ],
  [
    "export const ReviewTenderEligibilityPassportParams =",
    "export const GetAddendumImpactCentreParams =",
    3,
  ],
]) {
  refineFirstWaveSchemaMatches(
    startMarker,
    endMarker,
    tenderHumanReviewPattern,
    expectedCount,
    tenderHumanReviewRefinement,
    "human-review authority",
  );
}

writeFileSync(generatedZodPath, withTrailingLineFeeds(generatedZod, 1));

let generatedZodTypesIndex = readFileSync(generatedZodTypesIndexPath, "utf8");
const collidingQueryParamsExport =
  "export * from './getAddendumImpactCentreParams';\n";
const collidingQueryParamsExportCount =
  generatedZodTypesIndex.split(collidingQueryParamsExport).length - 1;
if (collidingQueryParamsExportCount !== 1) {
  throw new Error(
    `Generated Zod type index drifted: expected one colliding GetAddendumImpactCentreParams export, found ${collidingQueryParamsExportCount}`,
  );
}
generatedZodTypesIndex = generatedZodTypesIndex.replace(
  collidingQueryParamsExport,
  "",
);
writeFileSync(
  generatedZodTypesIndexPath,
  withTrailingLineFeeds(generatedZodTypesIndex, 1),
);

let generatedTenderContextCompanyEvidenceOption = readFileSync(
  generatedTenderContextCompanyEvidenceOptionPath,
  "utf8",
);
for (const fieldName of ["validFrom", "validUntil"]) {
  const generatedDate = `  ${fieldName}: Date | null;`;
  const occurrenceCount =
    generatedTenderContextCompanyEvidenceOption.split(generatedDate).length - 1;
  if (occurrenceCount !== 1) {
    throw new Error(
      `Generated Tender Context company-evidence type drifted: expected one ${fieldName} Date field, found ${occurrenceCount}`,
    );
  }
  generatedTenderContextCompanyEvidenceOption =
    generatedTenderContextCompanyEvidenceOption.replace(
      generatedDate,
      `  ${fieldName}: string | null;`,
    );
}
writeFileSync(
  generatedTenderContextCompanyEvidenceOptionPath,
  withTrailingLineFeeds(generatedTenderContextCompanyEvidenceOption, 1),
);

const generatedSchemas = readFileSync(generatedSchemasPath, "utf8");
writeFileSync(generatedSchemasPath, withTrailingLineFeeds(generatedSchemas, 1));
