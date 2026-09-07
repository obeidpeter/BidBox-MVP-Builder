# API specification

`@workspace/api-spec` owns BidBox's HTTP transport contract. [`openapi.yaml`](openapi.yaml) is the source for the generated React Query client in `lib/api-client-react` and generated Zod validators in `lib/api-zod`.

## Boundary and generation rules

- [`orval.config.ts`](orval.config.ts) configures both outputs and strict schemas for governed operations.
- [`patch-generated-client.mjs`](patch-generated-client.mjs) applies a deterministic, tested generator compatibility patch.
- [`check-generated.mjs`](check-generated.mjs) regenerates in isolation and rejects committed drift.

This package may use code-generation tooling but must not depend on the API server, database, or Workbench implementation. Generated packages depend on this contract directionally; do not hand-edit their generated operations as a second source of truth. Runtime-only rules that cannot be expressed by OpenAPI still require server enforcement and focused tests.

## Commands

```sh
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/api-spec run codegen:check
pnpm --filter @workspace/api-spec run test
```

After changing `openapi.yaml`, regenerate and commit both outputs, then run `codegen:check` and relevant API/Workbench tests.

Architecture: [contract component](../../docs/architecture/COMPONENTS.md#api-component-responsibilities), [workspace dependency direction](../../docs/architecture/COMPONENT_MAP.md#workspace-dependency-direction), and [guidebook](../../docs/architecture/README.md).
