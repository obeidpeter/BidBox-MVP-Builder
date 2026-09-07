# State and journey matrix

Status: UI mapping for the current deterministic workflow. Server state, version checks, permissions, and readiness results are authoritative; client summaries are explanatory only.

## Engagement lifecycle

| Phase                     | Authoritative stages                                                 | Primary surface                                   | Exit evidence                                                   |
| ------------------------- | -------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------- |
| Access and onboarding     | `organisation_onboarding`, `identity_verification`, `nda_privacy`    | Identity, organisation settings, client workspace | Active membership/role, privacy/NDA state                       |
| Tender governance         | `tender_identification`, `conflict_review`, `entitlement_validation` | Pursuit overview/governance                       | Tender/lot, conflict clear/consented, payment/entitlement gate  |
| Intake and processing     | `secure_intake`, `document_processing`                               | Documents                                         | Storage receipt, SHA-256, inspection verdict, extraction state  |
| Review and assignment     | `requirement_review`, `work_assignment`                              | Requirements and operations                       | Named-human rulings, citations, owners/deadlines                |
| Resolution and production | `remediation`, `grounded_drafting`, `boq_verification`               | Evidence, defects, BOQ, future drafting surface   | Approved evidence, resolved material defects, BOQ result        |
| Independent challenge     | `red_team_review`, `reviewer_approval`                               | Defects, readiness, reports                       | Red-team result and independent approval                        |
| Release                   | `package_assembly`, `named_signoff`, `export_delivery`               | Reports/package controls                          | Server readiness pass, signer, immutable export record/manifest |
| Close                     | `outcome_capture`, `archived`                                        | Overview/audit                                    | Outcome, retention/legal-hold instruction, approved archive     |

Terminal alternatives are `withdrawn` and `cancelled`. Terminal records cannot be mutated.

## Transition events

| Event              | Allowed transition                                   | Required UI inputs and result                                                         |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `progress`         | Exactly one lifecycle stage forward                  | Current version; named sign-off additionally requires the full server readiness gate. |
| `retry_processing` | `document_processing` to itself                      | Reconciliation/recovery complete; preserve prior attempt and show new version.        |
| `replace_document` | `document_processing` to `secure_intake`             | Reason; new integrity/version checks; prior document remains attributable.            |
| `apply_addendum`   | Active review/release stages to `requirement_review` | Reason and source version; mark downstream approvals/packages stale.                  |
| `reopen`           | Eligible downstream stage to `remediation`           | Authorised owner and reason; invalidate downstream approval/export state.             |
| `withdraw`         | Any non-terminal stage to `withdrawn`                | Owner approval and reason.                                                            |
| `cancel`           | Any non-terminal stage to `cancelled`                | Owner approval and reason.                                                            |
| `archive`          | `outcome_capture` to `archived`                      | Owner approval; retention and legal hold remain in force.                             |

Every transition uses optimistic version matching. Stale versions prompt reload/compare; they never auto-retry a material decision.

## Domain states

| Domain             | States                                                                         | UI rule                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Secure intake      | ready, quarantined, rejected, duplicate; provider unavailable                  | No unsafe preview; name the finding class and retained/purged disposition.                                                                                               |
| Document inclusion | `excluded`, `redacted`, `included`                                             | New uploads begin excluded; only reviewed included/redacted content can process.                                                                                         |
| Extraction         | `pending`, `extracting`, `extracted`, `failed`, `skipped`, `quarantined`       | Show method/confidence/notes; failed/skipped is never complete. Quarantined is excluded, not generically downloadable, and has no ordinary release or extraction action. |
| Requirement review | `suggested`, `pending`, `confirmed`, `edited`, `rejected`                      | Suggested/pending needs human ruling; only confirmed/edited are authoritative requirements.                                                                              |
| Evidence           | `pending`, `present`, `missing`, `expired`, `unclear`, `not_applicable`        | Mandatory evidence resolves only through approved `present`/`not_applicable`, not a suggestion.                                                                          |
| Defect severity    | fatal, likely-fatal, scoring-risk, cosmetic                                    | Never collapse severity into color or award probability.                                                                                                                 |
| Defect status      | suggested, open, remediated, waived                                            | Suggested needs review; open fatal/likely-fatal blocks release; downgrade/waiver is governed.                                                                            |
| BOQ check          | ok, flagged, pushed-to-defect                                                  | Flagged blocks when applicable; never generate or recommend a rate.                                                                                                      |
| Report             | draft, signed-off                                                              | Signer must have permission and satisfy independent/readiness rules.                                                                                                     |
| Pursuit summary    | intake, extraction, review, defects, reporting, signed-off, exported, archived | Summary is compatible UI grouping, not a substitute for the full workflow state.                                                                                         |
| Feature            | active, pending activation, denied                                             | UI flag does not grant permission, provider readiness, or server activation.                                                                                             |

## End-to-end journey coverage

| Journey                                   | Primary roles                             | Current UI coverage             | Required truthful state                                                                                    |
| ----------------------------------------- | ----------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Join and select organisation              | All authenticated                         | Implemented                     | provider loading/error, disabled account, no role, direct or verified projected selection required         |
| Create client/pursuit and assign reviewer | COO/CAD/BMG/VAN/VOA as permitted          | Implemented/partial             | conflict, NDA, payment, reviewer gaps visible before upload                                                |
| Upload and inspect documents              | Assigned client/BidBox/partner roles      | Implemented, provider-backed    | transfer, quarantine, duplicate, provider outage, extraction progress/failure                              |
| Review requirements and citations         | CRA/VAN/VQA/CPR as permitted              | Implemented/partial             | suggestion, confidence, source, confirm/edit/reject, stale version                                         |
| Map/approve evidence                      | BMG/CRA/VAN/VQA and bounded partner roles | Implemented/partial             | validity, expiry, restriction, approval history, unresolved mandatory blocker                              |
| Verify BOQ                                | BMG/VAN/VQA/CPR as permitted              | Implemented/partial             | deterministic exception, rule version, no pricing advice                                                   |
| Remediate defects and red-team            | BMG/CRA/VAN/VQA/CPR as permitted          | Implemented/partial             | independent fatal decision and red-team completion                                                         |
| Sign and export                           | CRA/VQA/authorised client roles           | Implemented/partial             | server blockers, signer identity, archive instruction, immutable version/manifest gap                      |
| Client status and renewal                 | Client roles                              | Implemented, commercially gated | read-only/allowed actions, expiry, unavailable provider actions                                            |
| Partner-managed work                      | Partner roles                             | Implemented, commercially gated | server-discovered relationship context, projected permission ceiling, co-sign unavailable where incomplete |
| Order, invoice, payment reconciliation    | COO/CAD/VOA/CPA                           | Control surface only            | unavailable; project payment gate is not a ledger                                                          |
| Notification delivery                     | Eligible workspace roles                  | Manual record/control surface   | queued is not delivered; adapters/failure queue unavailable                                                |

## Recovery presentation

| Condition                     | Preserve                                             | Disable                                          | Recovery action                                                      |
| ----------------------------- | ---------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| Offline                       | Last verified non-sensitive shell data and timestamp | Writes, approvals, tenant switch during mutation | Reconnect, refresh authority, then retry explicitly                  |
| Partial API failure           | Successful sections and their timestamps             | Conclusions based on missing sources             | Retry failed source; do not render missing as zero                   |
| Provider outage               | Upload/job ID and provider-neutral state             | Dependent processing/delivery                    | Automatic bounded retry or operator reconciliation                   |
| Stale version/concurrent edit | User draft and server version metadata               | Blind overwrite                                  | Reload, compare, reapply, and resubmit with new version              |
| Addendum/replacement          | Prior immutable source/version                       | Existing approvals/export eligibility            | Return to review/intake and recompute downstream state               |
| Expired evidence              | Prior version and usage history                      | Claimability/release where material              | Upload replacement to quarantine, verify, approve, relink explicitly |
| Failed export/render          | Signed source state and attempt record               | “Delivered” claim                                | Reconcile artefact/manifest, rerun render and visual QA              |

## Known state gaps

Dedicated finance/signatory roles, complete billing ledger, external notification delivery, configured OCR, durable job orchestration, partner co-sign workflow, and complete persisted package lifecycle are not UI-complete. Their states remain `unavailable`, `pending`, or `partial`; do not simulate success with optimistic copy or disabled buttons that appear actionable.
