# User and reviewer guide for AI-assisted work

Status: **guide for bounded draft workflows; production AI is disabled**.

## 1. What AI means in BidBox

AI creates first-pass suggestions. It does not approve a requirement, prove
evidence, establish a defect, sign a report, change project status or predict a
tender outcome. A suggestion can be useful and still be incomplete or wrong.

Look for the suggestion/origin state and source disclosure before acting. If a
screen does not make AI origin and review status clear, do not treat the content
as approved; report the issue.

## 2. Before requesting assistance

1. Confirm you are in the correct organisation, project and lot.
2. Confirm conflict/Restricted Mode and document access rules permit processing.
3. Include only the intended, current document versions.
4. Check extraction/OCR status and compare low-confidence scans with originals.
5. Do not upload extra personal/commercial data “to help the AI.”
6. Expect an explicit safe denial when a capability, governance, budget,
   provider or release gate is unavailable.

Restricted Mode projects are not eligible for the current externally hosted
OpenAI adapter. A manual workflow is required unless a separately approved
Restricted-Mode-eligible provider is introduced.

## 3. Reviewing extracted requirements

For every suggested requirement:

- open the named source document;
- compare the displayed exact source quote to the original page;
- verify page/clause references and document version when available;
- ensure the text is one discrete, checkable obligation;
- decide mandatory status, category and expected evidence yourself;
- watch for tables, appendices, addenda, definitions, exceptions and duplicated
  requirements;
- edit, reject or merge duplicates; confirm only after source verification.

The server currently checks exact quote containment after narrow normalisation.
That does not prove page coordinates, OCR fidelity or legal meaning. A missing
quote means the candidate should not persist, but a matching quote can still be
misinterpreted.

If selected source text exceeds the current safe bound, BidBox fails rather than
silently reading only part of it. Narrow the document selection without
omitting relevant sources, or use the manual workflow. Do not split a document
in a way that hides cross-references.

## 4. Reviewing evidence suggestions

For each mapping:

1. verify it points to the correct reviewed requirement;
2. open the named document and locate the exact excerpt;
3. verify the document belongs to this client/project/lot and current version;
4. verify dates, issuer, signatory, scope, amount, validity and applicability;
5. resolve conflicts with other evidence;
6. choose the status and add reviewer notes;
7. confirm only with the required authority.

The server downgrades unsupported `present` or `expired` suggestions to
`unclear`. It does not determine whether a date is legally valid or whether a
document is sufficient. `Not applicable` is a human ruling and should carry a
reason and grounded scope evidence.

## 5. Reviewing defect suggestions

AI defect candidates use reviewed requirements and confirmed evidence. Check
the underlying state and decide type, severity, description, remediation,
owner and lifecycle. A suggested fatal defect is not automatically an open
finding, but it must not be ignored simply because it is suggested. AI may not
close, waive or downgrade a finding.

## 6. Reviewing a responsiveness narrative

The draft is based on supplied reviewed state and remains marked
AI-suggested. Compare every factual statement to reviewed requirements,
evidence and defects. Remove unsupported statements, uncertainty disguised as
fact and any award prediction. A user with `report:sign_off` authority must
edit/confirm it; that action clears the suggestion marker and is audited. Do not
sign off while the release-readiness check reports the draft as suggested.

## 7. Reviewing multimodal transcription

Multimodal output is an unverified transcription aid. Compare it page by page,
especially signatures, stamps, dates, tables, amounts, footnotes, handwritten
text and poor scans. Empty or uncertain text is safer than invented text. Do not
use it as a citation source until verified against the original.

## 8. Responding to safe errors

| Error family                                          | Meaning                                                              | User action                                                                           |
| ----------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Global/capability/release disabled                    | The capability is not authorised for this environment/tenant/release | Continue manually; do not seek a bypass; contact operations if unexpected             |
| Input limit/invalid request                           | Source selection or request exceeds the bounded contract             | Review/narrow scope safely or work manually; never omit relevant pages merely to pass |
| Model configuration/provider/privacy/region/retention | Approved processing could not be proven                              | Stop; privacy/operations owner resolves the decision/configuration                    |
| Restricted Mode denied                                | Current provider cannot process this project's classification        | Use manual workflow; do not turn off Restricted Mode to get an answer                 |
| Budget unavailable/exceeded                           | Approved cost authority is missing or exhausted                      | Continue manually; budget owner decides, not the user                                 |
| Provider unhealthy/failed/cancelled                   | No safe result was completed                                         | Retry only when UI permits; verify no duplicate suggestion; use manual workflow       |
| Usage/schema/internal failure                         | Output/provenance could not be validated safely                      | Do not use partial text; report with safe error code and run ID only                  |

Never paste client content into tickets or chat to explain an AI error. Supply
the project/run ID, time, capability and safe error code through the approved
support channel.

## 9. Operations reviewer checklist

An authorised operations/evaluation reader should verify:

- `productionAiEnabled` is false until formal acceptance;
- release-gate blockers and expected versions are understood;
- no capability is unexpectedly enabled for a tenant;
- model, prompt and schema versions match the intended candidate;
- provider/privacy/budget fields reference approved decisions;
- recent runs contain only safe errors/metadata;
- token, latency and cost behaviour is within the approved envelope;
- evaluations are live/authorised and not synthetic self-checks;
- kill switch, rollback and alert delivery have recent retained evidence.

The operations view is a status aid, not an approval workflow. Do not equate a
green field with named sign-off unless the retained evidence reference is
present and valid.

## 10. Incident cues

Immediately stop and report if you see another organisation's data, unexplained
source content, AI text marked as human-approved, a bypassed review, a model
changing project status, an unsupported released claim, provider content in
logs, or output after a kill switch. Operations should engage the emergency
disable runbook before investigating with sensitive data.

## 11. Feedback and corrections

Record acceptance/edit/rejection reasons using the approved taxonomy. Do not
copy raw source passages into free-form telemetry. Corrections may improve
evaluation and prompts only when the data has a separate authorisation basis;
ordinary workflow use is not consent for model training or evaluation reuse.
