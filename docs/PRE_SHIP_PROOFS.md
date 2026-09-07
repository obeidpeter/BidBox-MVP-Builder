# Pre-ship AI proof gates

The deterministic verification stack (typecheck, unit and database tests, both
builds, and the **offline** doctrine, injection, and evaluation checks) runs in
CI. These checks establish code and fixture integrity. They do not authorize a
provider, establish data residency, approve a budget, or prove production model
quality.

Possessing a model API key is not provider approval. Production AI remains
disabled until BidBox records the provider/privacy decision, rate card and budget,
an authorized representative corpus, an independently adjudicated live
production-profile evaluation, and staged-rollout evidence.

## When to run

Run the compatibility proofs for every model, prompt, schema, grounding, or
retrieval change. Model provenance is declared in
`artifacts/api-server/src/lib/provenance.ts`; prompt text and strict output
schemas are versioned in `artifacts/api-server/src/lib/aiPromptRegistry.ts`.

## Gate-0 compatibility checks

The historical convenience command now runs only the offline doctrine,
structural-injection, and Gate-0 evaluation checks in sequence:

```bash
pnpm --filter @workspace/api-server prove:ship
```

This is a **Gate-0 compatibility check only**. It is not a production-promotion
command and makes no provider calls. The offline injection suite proves
sanitizer and structural containment against synthetic fixtures; it does not
prove behavioral non-deviation by a live model.

## Production-profile evaluation

Production promotion requires the production profile explicitly:

```bash
EVAL_PROFILE=production pnpm --filter @workspace/api-server eval:harness
```

The production profile is fail-closed and cannot be weakened with
`EVAL_RECALL_TARGET`. It requires an authorized and adjudicated representative
holdout corpus, a recorded live run, exact version/hash alignment, at least 95%
overall and mandatory recall, at least 98% citation correctness, full support
coverage, and zero fatal misses or unsupported claims. The current repository
contains only 14 synthetic cases, so this command is expected to fail until the
production evidence contract is completed.

No current repository command can create admissible production evidence. The
retired live paths do not derive a reviewed tenant context, cannot bind an
authorized manifest to actual gateway telemetry, and would be circular under
the production release gate. A controlled shadow/evaluation runner must be
built and independently approved before live evidence can be supplied.

The runtime release gate independently replays and verifies the evidence file
before any production model call. A report that merely claims success, is tied
to different model/prompt/schema/retrieval versions, or omits the required
rollout and governance decisions is rejected.

## Reading the output

Each proof prints a result per assertion and exits non-zero on failure. Treat
all logs and generated evidence as controlled operational artifacts: do not
commit client documents, model inputs, model outputs, credentials, or provider
verifiers to the repository.

The 85% target remains available only for the named Gate-0 non-production
profile and historical regression comparison. It must never be cited as the
BidBox production acceptance threshold.
