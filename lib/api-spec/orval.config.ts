import { defineConfig, InputTransformerFn } from "orval";
import path from "path";

const canonicalRoot = path.resolve(__dirname, "..", "..");
const configuredOutputRoot = process.env.BIDBOX_CODEGEN_OUTPUT_ROOT?.trim();
const root = configuredOutputRoot
  ? path.resolve(configuredOutputRoot)
  : canonicalRoot;
const apiClientReactSrc = path.resolve(root, "lib", "api-client-react", "src");
const apiZodSrc = path.resolve(root, "lib", "api-zod", "src");
const customFetchPath = configuredOutputRoot
  ? process.env.BIDBOX_CODEGEN_MUTATOR_PATH?.trim() ||
    path.resolve(root, "mutators", "custom-fetch.ts")
  : path.resolve(
      canonicalRoot,
      "lib",
      "api-client-react",
      "src",
      "custom-fetch.ts",
    );
const configuredMutatorPath = configuredOutputRoot
  ? path.relative(apiClientReactSrc, customFetchPath).split(path.sep).join("/")
  : customFetchPath;
const mutatorPath =
  configuredOutputRoot && !configuredMutatorPath.startsWith(".")
    ? `./${configuredMutatorPath}`
    : configuredMutatorPath;

const strictRoadmapOperationIds = [
  "readinessCheck",
  "getWorkInbox",
  "createRetentionRequest",
  "listRetentionRequests",
  "getRetentionCompletionReadiness",
  "getRetentionRequestCompletion",
  "completeRetentionRequest",
  "reconcileRetentionAction",
  "certifyRetentionAction",
  "getCurrentDocumentVersionSnapshot",
  "captureDocumentVersionSnapshot",
  "reviewDocumentVersionSnapshot",
  "getTenderContextCentre",
  "createTenderContextVersion",
  "reviewTenderContextVersion",
  "createTenderEligibilityPassport",
  "reviewTenderEligibilityPassport",
  "getAddendumImpactCentre",
  "reviewAddendumImpact",
  "applyAddendumImpact",
  "listCanonicalEvidenceOptions",
  "getProductionAcceptanceSnapshot",
  "listProductionAcceptanceAuthorities",
  "recordProductionAcceptanceEvidence",
  "getClientActionSnapshot",
  "listClientActionAuthorities",
  "createClientEvidenceRequest",
  "acknowledgeClientEvidenceRequest",
  "createClientUploadIntent",
  "issueClientActionUploadLease",
  "finalizeClientActionUploadLease",
  "attachClientEvidenceDocument",
  "reviewClientEvidenceSlot",
  "acknowledgeClientEvidenceCorrection",
  "createClientPackageDelivery",
  "acknowledgeClientPackageDelivery",
  "listOpportunitySourceCandidates",
  "getOpportunitySourceCandidate",
  "recordManualOpportunitySource",
  "decideOpportunitySourceCandidate",
  "prepareOpportunityPursuitHandoff",
  "confirmOpportunityPursuitHandoff",
  "getEvidenceRenewalSnapshot",
  "listEvidenceRenewalAuthorities",
  "createEvidenceRenewalPlan",
  "stageEvidenceRenewalReplacement",
  "reviewEvidenceRenewalReplacement",
  "getReconciledCommunications",
  "listProjectCommunicationReferences",
  "queueCommunicationIntent",
  "recordCommunicationAttempt",
  "reconcileCommunicationReceipt",
  "getCommercialRetainerManifest",
  "getCommercialRetainerSnapshot",
  "createCommercialQuote",
  "approveCommercialQuote",
  "createCommercialInvoice",
  "recordCommercialPayment",
  "verifyCommercialPayment",
  "createRetainerRequest",
  "mutateRetainerRequest",
  "getPartnerConsortiumRoom",
  "listConsortiumRoomParticipants",
  "initializePartnerConsortiumRoom",
  "addConsortiumResponsibility",
  "reviseConsortiumResponsibility",
  "decideConsortiumResponsibility",
  "prepareConsortiumQaItem",
  "decideConsortiumQaItem",
  "getAiShadowProgramme",
  "createAiShadowPlan",
  "recordAiShadowObservation",
  "closeAiShadowPlan",
  "getPrivacyOperations",
  "listPrivacyOperationsAssignees",
  "triagePrivacyDataSubjectRequest",
  "recordPrivacyConsentWithdrawal",
  "recordPrivacyLegalHoldReview",
  "getClaimsDesk",
  "createClaimsDeskRecord",
  "transitionClaimsDeskRecord",
  "getDeliveryStudio",
  "runDeliveryStudioAction",
  "getPortfolioIntelligence",
  "promoteFieldDraftToOperationsWorkItem",
] as const;

const strictRoadmapOperations = Object.fromEntries(
  strictRoadmapOperationIds.map((operationId) => [
    operationId,
    { zod: { strict: { body: true, response: true } } },
  ]),
);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function resolveLocalReference(
  rootDocument: Record<string, unknown>,
  reference: string,
): unknown {
  if (!reference.startsWith("#/")) return undefined;
  return reference
    .slice(2)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce<unknown>(
      (current, part) => asRecord(current)?.[part],
      rootDocument,
    );
}

/**
 * Orval 8.18 emits Zod literals for string constants but widens boolean and
 * numeric `const` values. A one-value enum is JSON-Schema-equivalent and is
 * emitted as an exact Zod literal. Limit this normalization to schemas
 * reachable from the frozen roadmap operations so legacy generated contracts
 * and their deterministic post-patches remain byte-stable.
 */
function preserveRoadmapScalarLiterals(config: Record<string, unknown>): void {
  const visited = new Set<unknown>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object" || visited.has(value)) {
      return;
    }
    visited.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.$ref === "string") {
      visit(resolveLocalReference(config, record.$ref));
    }
    if (
      Object.hasOwn(record, "const") &&
      (typeof record.const === "boolean" || typeof record.const === "number")
    ) {
      record.enum = [record.const];
      delete record.const;
    }
    Object.values(record).forEach(visit);
  };

  const paths = asRecord(config.paths) ?? {};
  const roadmapIds = new Set<string>(strictRoadmapOperationIds);
  for (const pathItem of Object.values(paths)) {
    const item = asRecord(pathItem);
    if (!item) continue;
    for (const operation of Object.values(item)) {
      const candidate = asRecord(operation);
      if (
        candidate &&
        typeof candidate.operationId === "string" &&
        roadmapIds.has(candidate.operationId)
      ) {
        visit(candidate);
      }
    }
  }
}

// Our exports make assumptions about the title of the API being "Api" (i.e. generated output is `api.ts`).
const titleTransformer: InputTransformerFn = (config) => {
  config.info ??= {};
  config.info.title = "Api";
  preserveRoadmapScalarLiterals(config as unknown as Record<string, unknown>);

  return config;
};

export default defineConfig({
  "api-client-react": {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiClientReactSrc,
      target: "generated",
      client: "react-query",
      mode: "split",
      baseUrl: "/api",
      clean: true,
      prettier: true,
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          path: mutatorPath,
          name: "customFetch",
        },
      },
    },
  },
  zod: {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiZodSrc,
      client: "zod",
      target: "generated",
      schemas: { path: "generated/types", type: "typescript" },
      mode: "split",
      clean: true,
      prettier: true,
      override: {
        zod: {
          coerce: {
            query: ["boolean", "number", "string"],
            param: ["boolean", "number", "string"],
            body: ["bigint", "date"],
            response: ["bigint", "date"],
          },
        },
        operations: strictRoadmapOperations,
        useDates: true,
        useBigInt: true,
      },
    },
  },
});
