# BidBox AI overhaul control pack

Status: **not accepted for production; production AI remains disabled**.

This pack is the implementation and assurance baseline for BidBox's bounded AI
assistance. It separates source code that exists in the working tree from
controls that have been validated in a production-like environment and from
future architecture that has not been built.

## Source authority warning

The requested Business Plan v1.2 and Product Roadmap v1.1 were not supplied.
The material available for this overhaul was Business Plan v1.1, Product
Roadmap v1.0 and TRD v1.0. No missing requirements have been inferred. Product
owners must reconcile the requested versions before treating this pack as a
complete business baseline.

## Current implementation boundary

The working tree contains five Level-2, human-reviewed AI capabilities, a
central fail-closed gateway, versioned prompts and strict schemas, exact source
quote checks, suggestion-state workflows, safe-error telemetry, and an
organisation-scoped AI operations API. Validation and deployment evidence are
still in progress. There is no production retrieval/indexing pipeline,
Copilot/chat agent, long-term AI memory, AI queue worker, transactional AI
outbox, or general-purpose tool-execution plane.

Production activation remains blocked by undecided provider, processing-region,
retention and budget approvals; an authorised live holdout evaluation; tenant
isolation proof; shadow/pilot/canary evidence; alert delivery evidence; and
deployment/rollback acceptance.

## Deliverables

- [Baseline audit](BASELINE_AUDIT.md)
- [Updated product requirements](UPDATED_PRODUCT_REQUIREMENTS.md)
- [TRD and roadmap update](TRD_ROADMAP_UPDATE.md)
- [Twenty-two intelligence capabilities and implementation boundary](FUTURE_CAPABILITIES_IMPLEMENTATION.md)
- [Provider-free AI platform foundation implementation](PLATFORM_FOUNDATION_IMPLEMENTATION.md)
- [Business-rule traceability](BUSINESS_RULE_TRACEABILITY.md)
- [Capability and autonomy matrix](CAPABILITY_AUTONOMY_MATRIX.md)
- [Tool catalogue](TOOL_CATALOGUE.md)
- [Prompt and schema registry](PROMPT_SCHEMA_REGISTRY.md)
- [Target architecture](TARGET_ARCHITECTURE.md)
- [Retrieval design](RETRIEVAL_DESIGN.md)
- [Data-model gap analysis](DATA_MODEL_GAP.md)
- [Threat and privacy model](THREAT_PRIVACY_MODEL.md)
- [Provider decision template](PROVIDER_DECISION_TEMPLATE.md)
- [Evaluation and annotation plan](EVALUATION_ANNOTATION_PLAN.md)
- [Operations and observability](OPERATIONS_OBSERVABILITY.md)
- [User and reviewer guide](USER_REVIEWER_GUIDE.md)
- [Rollout and incident runbooks](ROLLOUT_RUNBOOKS.md)
- [Deployment and acceptance plan](DEPLOYMENT_ACCEPTANCE.md)
- [Final acceptance matrix](FINAL_ACCEPTANCE_MATRIX.md)

## Status vocabulary

| Term                | Meaning                                                                               |
| ------------------- | ------------------------------------------------------------------------------------- |
| Implemented         | Source exists in this working tree; it may still be unvalidated or undeployed.        |
| Tested              | A named automated or manual check has retained evidence.                              |
| Operational         | Deployed, monitored and exercised in the target environment.                          |
| Approved            | A named owner has retained a dated decision reference.                                |
| Production eligible | Every release gate is satisfied for the exact model/prompt/schema/data configuration. |

No document in this directory should be read as provider approval, production
quality evidence, customer-data authorisation, or permission to enable AI.
