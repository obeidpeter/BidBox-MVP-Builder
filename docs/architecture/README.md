# BidBox living architecture guidebook

**Current:** This guidebook describes the source-controlled platform reviewed on 2026-08-31.

**Target:** Planned architecture is identified explicitly and linked to its governing decision or design; it is never presented as current.

**Deployed:** The repository proves a Replit deployment configuration and release-verification mechanism, not the live state of any environment. A deployment is “deployed” here only when an immutable external deployment record identifies the release and provider deployment.

**Verified:** “Verified” means the named automated or operational evidence passed for the stated scope. Source presence, configuration, or a diagram is not verification.

Last reviewed: **2026-08-31**

## Purpose

This directory is the shortest reliable path from BidBox’s product intent to its current code and runtime boundaries. It complements the controlled [Nigeria v2.5 dossier](../implementation-v2.5/README.md); it does not replace product requirements, accepted ADRs, security policy, OpenAPI, migration sources, or retained release evidence.

The guidebook has four rules:

1. Separate current source, target design, deployed state, and verified evidence.
2. Link to authoritative code and controls instead of copying volatile detail.
3. Show trust, authority, data, and failure boundaries—not just boxes.
4. Update the affected view and decision record whenever an architectural boundary changes.

## Status vocabulary

| Label        | Meaning                                                                                                 | Does not mean                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Current**  | Present in the reviewed source tree or an explicitly current source contract.                           | Running or enabled in production.                                                |
| **Target**   | Approved or proposed intended design that is not fully current.                                         | Implemented, activated, funded, or accepted.                                     |
| **Deployed** | Bound to an immutable provider deployment identifier and exact release evidence outside the repository. | Merely configured in `.replit`, merged, built, or published without attestation. |
| **Verified** | Supported by named, retained evidence for a stated environment and scope.                               | Inferred from code, a passing unrelated test, or a status total.                 |

When a row has mixed maturity, the text beside the label is authoritative. “Configured; deployment not verified” is deliberately different from “Deployed.”

## Guidebook map

| View                                             | Question answered                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| [System context](CONTEXT.md)                     | Who uses BidBox, which external systems touch it, and where authority stops?                     |
| [Current containers](CONTAINERS.md)              | Which runtime/data containers exist now, and which target containers remain inactive?            |
| [Selected components](COMPONENTS.md)             | How do the API and Workbench enforce their main boundaries?                                      |
| [Deployment and trust boundaries](DEPLOYMENT.md) | How is the configured Replit runtime built, started, promoted, and verified?                     |
| [Dynamic flows](DYNAMIC_FLOWS.md)                | How do authentication, sign-off, export, jobs, retention, startup, and release behave over time? |
| [Component-to-code map](COMPONENT_MAP.md)        | Where is each responsibility implemented and what may it depend on?                              |
| [Quality attributes](QUALITY_ATTRIBUTES.md)      | Which measurable scenarios shape architecture and where is the evidence?                         |
| [Architecture risk register](RISK_REGISTER.md)   | Which material architectural gaps remain open and who owns the next decision?                    |
| [Glossary](GLOSSARY.md)                          | What do BidBox-specific terms mean?                                                              |

## Current architecture in one minute

- BidBox is a TypeScript/pnpm modular monorepo. The production build combines a React Workbench and an Express API.
- The configured production topology is one Replit Autoscale Node deployment. The Express process serves `/api` and the built Workbench assets; the SPA then runs in the user’s browser.
- Clerk supplies session identity. BidBox resolves the local user, selected organisation, access source, roles, and permissions server-side.
- PostgreSQL is the system of record. Tenant requests run in a transaction with a transaction-local organisation context and FORCE RLS as defence in depth.
- Private object storage holds uploaded and generated artefacts. Database metadata and governed hashes bind those artefacts to tenant records.
- OpenAPI is the transport contract. Generated React Query and Zod packages are reproducibility-checked.
- A durable job/outbox foundation exists in source, but its human-session worker control route and external effects are intentionally inactive until workload-identity and operational gates pass.
- Provider-backed AI and other external effects remain separately activation-gated. Deterministic and human-authority paths remain the recovery boundary.

See [containers](CONTAINERS.md) and [deployment](DEPLOYMENT.md) for evidence links and qualifications.

## Governing sources and precedence

For conflicts, use the precedence defined by the [implementation dossier](../implementation-v2.5/README.md#document-precedence). The primary architecture sources are:

- [accepted ADRs](../implementation-v2.5/adrs/);
- [technical target architecture](../implementation-v2.5/ARCHITECTURE.md);
- [logical data model](../implementation-v2.5/DATA_MODEL.md) and current [Drizzle schema](../../lib/db/src/schema/index.ts);
- [security and privacy plan](../implementation-v2.5/SECURITY_PRIVACY.md);
- [OpenAPI contract](../../lib/api-spec/openapi.yaml);
- [Replit runtime configuration](../../.replit), [startup wrapper](../../scripts/start-replit-production.mjs), and [release provenance](../implementation-v2.5/RELEASE_PROVENANCE.md);
- [runtime reliability](../implementation-v2.5/RUNTIME_RELIABILITY.md), [test strategy](../implementation-v2.5/TEST_STRATEGY.md), and [operational runbooks](../implementation-v2.5/runbooks/);
- capability-specific implementation documents under `docs/`.

The older target architecture remains valuable, but its target statements do not override current source evidence and must not be read as a current deployment diagram.

## Executable catalogues

The guidebook explains intent; the versioned catalogues below are the machine-checked source for identifiers, ownership, evidence paths, dependency allowlists, and review dates:

- [architecture drivers](../../config/architecture/drivers.v1.json);
- [module boundaries and hotspot policy](../../config/architecture/module-boundaries.v1.json);
- [cross-cutting route policies](../../config/architecture/route-policies.v1.json);
- [architecture risks](../../config/architecture/risks.v1.json).

CI validates the catalogues, referenced evidence, ADR driver links, package dependency direction, selected high-risk route classifications, and this guidebook's local links. A passing source gate still does not prove a control is deployed or activated in an external environment.

## Maintenance rule

An architectural change is complete only when the change also does the applicable work below:

- updates a current view and its component map;
- adds or amends an ADR for a lasting trade-off, trust boundary, data-ownership rule, deployment topology, or external dependency;
- links the exact source, contract, migration, and test evidence;
- updates a quality scenario and risk when its response or measure changes;
- records a review date and leaves deployment/verification status truthful;
- avoids storing secrets, client content, private evidence, or live production identifiers in these documents.

The architecture owner reviews this index each release. Domain owners review affected component rows; security/privacy and operations owners review trust or deployment changes.
