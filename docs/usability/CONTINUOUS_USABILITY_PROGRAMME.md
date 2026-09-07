# BidBox continuous usability programme

This programme turns usability and interaction-design quality into release evidence. It does not claim that a planned study happened: only observed sessions, expert-review records, and checked-in findings count as evidence.

The machine-readable contract is [`config/product/usability-programme.v1.json`](../../config/product/usability-programme.v1.json). CI verifies its role coverage, critical workflows, safeguards, and release gates.

Release evidence is recorded separately in [`config/product/usability-release-evidence.v1.json`](../../config/product/usability-release-evidence.v1.json). The checked-in manifest currently says `missing`; that is an intentional truthful state, not approval. Ordinary developer checks validate the manifest shape, while the release-candidate workflow runs `verify:usability-release` and fails until observed, privacy-reviewed evidence satisfies the configured thresholds.

## What the programme must answer

Every round must determine whether authorised users can:

- understand the pursuit workflow map, distinguish the stage in view from recorded status or an absent authoritative stage, and identify deadline context, blockers, and the next permitted action;
- distinguish loading, empty, denied, unavailable, and failed states;
- trace requirements and response content to their sources and recognise the boundary between generated assistance and human authority;
- review side by side, choose permission-scoped records by name and version, and understand calculated or blocked statuses;
- recover from mistakes without losing valid input;
- inspect the exact scope, consequences, authority, and blockers before sign-off, deletion, package export, or rehearsal;
- get contextual help without leaving or resetting the task.

## Participants and contexts

Recruit across bid leads, bid analysts, reviewers, administrators, partners, and occasional executive observers. Do not treat one role as a proxy for another. Quarterly coverage review must identify roles, assistive-technology needs, and operating contexts not represented in recent rounds.

Run representative tasks on a standard desktop and a narrow mobile viewport. Include low-bandwidth behaviour, an interruption near a deadline, and Africa/Lagos time display. Include keyboard-only and screen-reader walkthroughs in accessibility review. Use synthetic tender data by default; live bids, credentials, secrets, and personal data do not belong in research materials.

## Evaluation sequence

1. Before each release, run an expert heuristic walkthrough and accessibility review against the critical tasks in the contract.
2. Monthly, run moderated sessions with the roles most affected by recent changes. Ask participants to think aloud, but do not teach the interface during the task.
3. Observe completion, abandonment, time, interaction count, errors and recovery, assistance requests, and confidence. Collect SUS, UEQ-S, and NASA-TLX after the task set; never substitute survey scores for observed behaviour.
4. Triangulate observations with support themes and privacy-safe production feedback. Analytics may identify where to investigate, but cannot explain intent on their own.
5. Classify each finding by affected role, environment, task, severity, evidence, and authority boundary. Name an owner and a retest condition.
6. Re-test critical fixes with the original task or a stricter equivalent before closing the finding.

## Session protocol

Use a consented session record containing only a participant code, role, environment, task identifiers, observations, measures, and findings. Recording is opt-in. Redact names and organisation details from clips or notes. Stop the session if real tender content, credentials, or another person's private data appears.

Start each task from the state described in the contract and state the outcome, not the clicks. Avoid leading language such as naming the control to use. Record where the participant expected an action to be, what system state they believed they were in, whether the result matched that belief, and how they recovered.

For an interrupted task, pause after valid input exists, move the participant to another permitted surface, then ask them to resume. For low bandwidth, throttle the connection and verify that progress, loading, failure, retry, and saved-state feedback remain truthful.

## Finding record

Each checked-in finding should contain:

- a stable finding ID and canonical observed instant;
- participant role and environment, without identity;
- task ID and starting state;
- observed behaviour and expected outcome;
- severity: critical, high, medium, or low;
- the violated usability principle or interaction-design quality;
- evidence location and privacy review status;
- named owner, intended change, and retest status; fixed findings also record a canonical retest instant that cannot predate the observation.

Critical findings include an unrecoverable destructive action, an incorrect claim of readiness or success, inaccessible authority information, exposure across a permission boundary, or inability to complete a critical task. They are release blockers.

The evidence manifest also carries two cadence records that session results cannot substitute for: bounded weekly production-feedback triage records and one named, privacy-reviewed quarterly role/environment coverage review. Each triage names its owner, approved privacy-safe sources, evidence location, and number of research questions recorded. The coverage review must explicitly cover every configured role and environment and record any remaining gaps.

## Release decision

The release gate is fail closed. Critical-task completion must meet the threshold in the contract, and there may be no unrecovered critical error, critical accessibility violation, or critical truthfulness defect. Every critical fix requires retest evidence and a named owner. If representative sessions were not run, report coverage as missing rather than assuming success.

Do not change `coverageStatus` to `complete` merely to unblock a build. A complete manifest must cover every configured role, environment, and critical task; identify consented pseudonymous sessions; name review and finding owners; record privacy review; and bind fixed findings to retest evidence. The verifier also rejects stale before-release reviews, stale quarterly coverage, and a missing monthly moderated session.

All evidence must fall inside the declared evidence window. Weekly triage may leave no gap longer than seven calendar days, including the interval from the final triage to the approval decision. The window must end before the approval decision, the decision must follow every recorded review, session, triage, finding observation, and fixed-finding retest, and neither evidence nor the decision may be future-dated. This chronology is enforced from the records themselves rather than inferred from a filename or planned date.

An expert walkthrough can block a release, but it cannot satisfy the user-session cadence. Synthetic automation can protect interaction contracts, but it cannot be reported as participant evidence.

## Cadence and ownership

- Before each release: product, design, accessibility, and engineering complete the critical-task walkthrough.
- Weekly: product and support triage privacy-safe feedback into research questions.
- Monthly: the research owner runs moderated role sessions and publishes redacted findings.
- Quarterly: product leadership reviews role and environment coverage, recurring themes, and whether thresholds still detect material risk.

The product owner owns prioritisation, the research owner owns evidence quality and consent, engineering owns reproducible fixes and automated contracts, and the release owner records the gate decision.
