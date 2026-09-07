# Valo Nigeria v2.5 implementation dossier

Status: **implementation in progress; not accepted for production**
Baseline date: 2026-08-08
Scope: Nigeria releases v0.1 through v2.5; GCC localisation is explicitly out of scope.

This directory is the controlled specification and handover set for upgrading BidBox from the observed repository baseline. It separates intended behaviour, observed implementation, and verified evidence. A requirement is not complete merely because it appears in a document, route, schema, or interface.

## Evidence vocabulary

- **Observed**: source exists and was inspected.
- **Implemented**: code appears to implement the requirement, but the relevant verification may still be pending.
- **Verified**: the named automated or operational evidence was run successfully against the stated environment and is retained.
- **Partial**: some acceptance conditions are implemented or evidenced.
- **Planned**: target and acceptance criteria are defined; implementation is not evidenced.
- **Blocked**: owner action or unavailable infrastructure prevents safe completion.

Only `Verified` may be treated as release evidence. Commercial outcomes are never software-test evidence.

## Document map

| Area                                       | Authority                                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Baseline and gaps                          | [BASELINE_AUDIT.md](BASELINE_AUDIT.md)                                                             |
| Product contract                           | [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md)                                                 |
| Requirement-to-code/test evidence          | [REQUIREMENTS_TRACEABILITY.md](REQUIREMENTS_TRACEABILITY.md)                                       |
| Roles and segregation                      | [PERMISSIONS_MATRIX.md](PERMISSIONS_MATRIX.md)                                                     |
| Journeys, IA, screens, design system       | [UX_SPECIFICATION.md](UX_SPECIFICATION.md)                                                         |
| Technical design / updated TRD             | [ARCHITECTURE.md](ARCHITECTURE.md)                                                                 |
| Logical/physical data design               | [DATA_MODEL.md](DATA_MODEL.md)                                                                     |
| Threat model, privacy, Nigeria rule packs  | [SECURITY_PRIVACY.md](SECURITY_PRIVACY.md)                                                         |
| AI orchestration and evaluation            | [AI_ORCHESTRATION_EVALUATION.md](AI_ORCHESTRATION_EVALUATION.md)                                   |
| Verification strategy                      | [TEST_STRATEGY.md](TEST_STRATEGY.md)                                                               |
| Monitoring and alerting                    | [MONITORING_ALERTING.md](MONITORING_ALERTING.md) and `../../config/observability/alerts.v2.5.json` |
| Dependency-ordered releases                | [ROADMAP_V2_5.md](ROADMAP_V2_5.md)                                                                 |
| Business-plan changes                      | [BUSINESS_PLAN_IMPACT.md](BUSINESS_PLAN_IMPACT.md)                                                 |
| Retain/redesign/add/remove/defer decisions | [DECISION_LOG.md](DECISION_LOG.md) and [adrs/](adrs/)                                              |
| Operations                                 | [runbooks/](runbooks/)                                                                             |
| Role guidance                              | [guides/](guides/)                                                                                 |
| Release delta                              | [RELEASE_NOTES.md](RELEASE_NOTES.md)                                                               |
| Deployment evidence                        | [DEPLOYMENT_RECORD.md](DEPLOYMENT_RECORD.md)                                                       |
| Final gate                                 | [ACCEPTANCE_REPORT.md](ACCEPTANCE_REPORT.md)                                                       |

## Document precedence

1. Binding product and integrity invariants in `PRODUCT_REQUIREMENTS.md`.
2. Accepted ADRs in `adrs/`.
3. `SECURITY_PRIVACY.md`, including a currently effective signed Nigeria rule pack.
4. `ARCHITECTURE.md`, `DATA_MODEL.md`, `PERMISSIONS_MATRIX.md`, and `UX_SPECIFICATION.md`.
5. Release scope in `ROADMAP_V2_5.md`.
6. Existing documentation where it does not conflict with the above.

Conflicts require an ADR and traceability update; undocumented exceptions are not permitted.

## Source baseline and discrepancy

The supplied source set is Business Plan **v1.1**, Product Roadmap **v1.0**, and TRD **v1.0**. The TRD cover says it is aligned to Business Plan **v1.2** and Product Roadmap **v1.1**, but those newer files were not found in the supplied repository archive. Until an owner supplies and approves them, the supplied v1.1/v1.0 files remain the baseline and this discrepancy remains open as `DOC-001`.

## Release rule

Technical release and commercial activation are separate decisions. Later capabilities may be technically complete behind disabled, server-enforced feature flags. No v2.5 capability is commercially activated from this dossier alone.
