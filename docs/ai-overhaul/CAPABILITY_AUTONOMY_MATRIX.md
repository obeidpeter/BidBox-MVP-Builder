# Capability and autonomy matrix

Status: **current source policy; production activation not approved**.

## Autonomy scale

| Level | Definition                                                        | Current use                            |
| ----- | ----------------------------------------------------------------- | -------------------------------------- |
| 0     | Deterministic feature; no model output                            | Existing non-AI controls               |
| 1     | AI preview with no persistence                                    | Available for future low-risk previews |
| 2     | Reversible, visibly AI-generated draft persisted for human review | All five current capabilities          |
| 3     | Bounded action after explicit human approval                      | Not authorised                         |
| 4     | Autonomous consequential action                                   | Prohibited for BidBox's current scope  |

Level 2 does not mean “usually reviewed.” It means the model is technically
unable to establish authoritative state. The reviewer named in the policy is a
required control, not an escalation option.

## Current capability matrix

| Capability ID            | Purpose and bounded input                                                        | Draft output                                   | Approval authority      | Input/output limit                                                                 | Timeout/retry/fallback                   | Per-run safety ceiling  |
| ------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------- |
| `extract_pdf_multimodal` | Transcribe an in-scope PDF when embedded text is insufficient                    | Unverified transcription text                  | Named document reviewer | 50 MiB / 8,192 tokens                                                              | 60 s / 1 retry per provider / 1 fallback | NGN 500,000 minor units |
| `extract_requirements`   | Propose discrete requirements from the complete selected document corpus         | Suggested requirements with exact source quote | `requirement:review`    | 60,000 bytes at gateway plus complete-corpus 60,000-character guard / 8,192 tokens | 45 s / 1 / 1                             | NGN 300,000 minor units |
| `map_evidence`           | Propose evidence status/excerpt for reviewed requirements and selected documents | Suggested evidence rows                        | `evidence:approve`      | 60,000 bytes plus complete-corpus guard / 8,192 tokens                             | 45 s / 1 / 1                             | NGN 300,000 minor units |
| `suggest_defects`        | Propose review findings from reviewed requirements and confirmed evidence        | Suggested defects                              | `defect:review`         | 60,000 bytes / 4,096 tokens                                                        | 45 s / 1 / 1                             | NGN 200,000 minor units |
| `responsiveness_review`  | Draft a responsiveness narrative from reviewed state                             | AI-suggested preview                           | `report:sign_off`       | 60,000 bytes / 2,048 tokens                                                        | 45 s / 1 / 1                             | NGN 150,000 minor units |

The monetary values above are hard defensive ceilings in code. They are not
approved spend, are not a monthly/engagement budget and must not be interpreted
as commercial authority. The approved budget decision is still missing.

## Advanced deterministic Intelligence Centre engines

The following engines are now implemented as provider-free Level-0 domain
projections. Their catalogue ceiling describes a possible future reviewed
preview/draft, not current runtime autonomy. None is registered as a model
capability or production feature flag by this work.

| Capability ID                 | Current level | Target ceiling | Authority that remains unavailable                                                   |
| ----------------------------- | ------------: | -------------: | ------------------------------------------------------------------------------------ |
| `evaluation_score_planner`    |             0 |              1 | Award prediction, hidden evaluator inference or automatic score acceptance           |
| `bid_security_integrity`      |             0 |              1 | Validity representation, bank instruction or instrument correction                   |
| `regulatory_watchtower`       |             0 |              1 | Legal interpretation activation or automatic control/template change                 |
| `consortium_responsibility`   |             0 |              2 | Partner commitment, credential transfer or JV-term change                            |
| `portal_submission_rehearsal` |             0 |              1 | Portal login, declaration acknowledgement, upload or submission                      |
| `commercial_exposure`         |             0 |              1 | Price/rate selection, financing decision or external commitment                      |
| `nigerian_content_composer`   |             0 |              2 | Availability assertion or local-content commitment without named owner review        |
| `personnel_tailoring`         |             0 |              2 | Credential embellishment, availability assertion or employment decision              |
| `contract_deviation`          |             0 |              1 | Term acceptance, legal conclusion or external redline communication                  |
| `critical_path_simulator`     |             0 |              1 | Authoritative owner, task or date mutation                                           |
| `integrity_sentinel`          |             0 |              1 | Misconduct determination, accusation or external report                              |
| `outcome_learning`            |             0 |              2 | Model training, cross-tenant reuse or lesson publication without governance approval |

All twelve require bounded inputs, deterministic identities and subject-bound
named reviews. The connected project snapshot remains descriptive and never
marks these advanced engines `review_ready` merely because loosely related
records exist.

## Authority boundaries

Every current capability has the following invariant policy:

- autonomy level 2;
- action class `reversible_draft`;
- output state `non_authoritative_draft`;
- authoritative mutation is forbidden;
- a named human is required;
- AI self-approval is forbidden;
- partial output persistence is forbidden;
- failure is fail-closed with manual recovery;
- fallback is limited to an equivalent-or-stronger approved provider.

No current capability requires two-person approval in the source policy. That
is a policy fact, not a conclusion that one-person approval is sufficient for
all production or customer contexts. Owners must decide whether high-risk
sign-off needs dual control.

## State and release effects

| AI output                | Initial state                            | Can it affect deterministic risk/release?                    | Human action                                               |
| ------------------------ | ---------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- |
| Requirement              | `suggested`                              | It is a review queue item, not a confirmed obligation        | Confirm/edit/reject/merge; provenance retained             |
| Evidence                 | `suggested = true`                       | Cannot satisfy a reviewed requirement                        | Verify document, excerpt, validity/status; confirm         |
| Defect                   | `status = suggested`, `suggested = true` | Does not become an open finding automatically                | Confirm/edit/reject and assign status/owner                |
| Responsiveness narrative | `responsivenessSuggested = true`         | Blocks release/sign-off readiness                            | `report:sign_off` user edits/confirms; audit clears marker |
| PDF transcription        | Extraction aid, not source truth         | Must not be treated as verified citation text without review | Compare to original pages and record extraction quality    |

AI never advances project status. The deterministic readiness engine uses only
the reviewed states appropriate to each workflow.

## Production activation formula

A capability is effectively enabled in production only when all of the
following are true:

1. `VALO_AI_KILL_SWITCH` is not `true`;
2. `VALO_AI_GLOBAL_ENABLED=true`;
3. `VALO_AI_<CAPABILITY>_ENABLED=true`;
4. the organisation feature flag `ai_<capability>` is enabled;
5. the model configuration is promoted and evaluation-approved;
6. approved budget and rate-card evidence is present;
7. at least one provider passes capability, approval, governance, region,
   retention, Restricted Mode and health checks;
8. the request is within input/output/cost bounds.

Any missing or failed condition denies execution before provider disclosure.
This source policy still requires deployed concurrency and negative-path proof.

## Explicitly unauthorised capabilities

| Proposed capability                                  | Decision                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| Bid/award prediction or evaluator simulation         | Prohibited                                                  |
| Automatic evidence approval                          | Prohibited                                                  |
| Automatic defect closure or fatality downgrade       | Prohibited                                                  |
| Automatic pricing/BOQ modification                   | Prohibited                                                  |
| Report signature or submission approval              | Prohibited                                                  |
| Email, portal upload or tender submission            | Prohibited                                                  |
| General database/object-store/shell/network tool use | Prohibited                                                  |
| Cross-client learning or long-term tender memory     | Not implemented; separate approval required                 |
| Conversational Copilot                               | Not implemented; separate product/security/evaluation scope |

Changing a capability's autonomy level, approval authority, schema, allowed
tools, provider, or data scope is a release-significant change and requires a
new threat assessment and evaluation.
