import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import {
  REQUIRED_ARCHITECTURE_CONFIGS,
  REQUIRED_ARCHITECTURE_DOCUMENTS,
  parseOpenApiOperations,
  validateArchitectureDecisionRecords,
  validateArchitectureDocuments,
  validateModuleBoundaries,
  verifyArchitectureRepository,
} from "./verify-architecture.mjs";

const REVIEW_DATE = "2026-08-31";

async function put(root, path, source) {
  const target = resolve(root, ...path.split("/"));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, source, "utf8");
}

async function json(root, path, value) {
  await put(root, path, `${JSON.stringify(value, null, 2)}\n`);
}

function metadata(body) {
  return `**Current:** Current source is identified and bounded.

**Target:** Target changes require a named decision.

**Deployed:** Deployment remains separately evidenced.

**Verified:** Verification names the exact automated evidence.

Last reviewed: **${REVIEW_DATE}**

${body.trim()}
`;
}

function diagram(title, body = 'flowchart LR\n  A["A"] --> B["B"]') {
  return metadata(`# ${title}\n\n\`\`\`mermaid\n${body}\n\`\`\``);
}

function architectureDocuments() {
  const links = REQUIRED_ARCHITECTURE_DOCUMENTS.filter(
    (path) => !path.endsWith("/README.md"),
  )
    .map((path) => {
      const name = path.split("/").at(-1);
      return `- [${name}](${name})`;
    })
    .join("\n");
  const configLinks = REQUIRED_ARCHITECTURE_CONFIGS.map((path) => {
    const name = path.split("/").at(-1);
    return `- [${name}](../../${path})`;
  }).join("\n");
  return new Map([
    [
      "docs/architecture/README.md",
      metadata(`# Architecture guidebook\n\n${links}\n\n${configLinks}`),
    ],
    [
      "docs/architecture/CONTEXT.md",
      diagram(
        "System context",
        'flowchart LR\n  Person["Person"] --> BidBox["BidBox system"]',
      ),
    ],
    [
      "docs/architecture/CONTAINERS.md",
      diagram(
        "Container responsibilities",
        'flowchart LR\n  Browser["Browser responsibility"] --> API["API container"]',
      ),
    ],
    [
      "docs/architecture/COMPONENTS.md",
      diagram(
        "Component responsibilities",
        'flowchart LR\n  Route["Route component responsibility"] --> Domain["Domain component"]',
      ),
    ],
    [
      "docs/architecture/DEPLOYMENT.md",
      diagram(
        "Deployment trust boundaries",
        'flowchart LR\n  Runtime["Deployment runtime"] --> Trust["Trust boundary"]',
      ),
    ],
    [
      "docs/architecture/DYNAMIC_FLOWS.md",
      diagram(
        "Dynamic flows",
        "sequenceDiagram\n  participant User\n  participant API\n  User->>API: Request",
      ),
    ],
    [
      "docs/architecture/COMPONENT_MAP.md",
      metadata(
        `# Component map\n\n- artifacts/api-server\n- artifacts/bidbox-workbench\n- lib/db\n- lib/api-spec`,
      ),
    ],
    [
      "docs/architecture/GLOSSARY.md",
      metadata("# Glossary\n\nBidBox: platform boundary."),
    ],
    [
      "docs/architecture/QUALITY_ATTRIBUTES.md",
      metadata(
        "# Quality attributes\n\n| Stimulus | Environment | Response | Measure |\n| --- | --- | --- | --- |\n| Request | Peak | Deny unsafe state | Exact result |",
      ),
    ],
    [
      "docs/architecture/RISK_REGISTER.md",
      metadata(
        "# Risk register\n\n| Owner | Likelihood | Impact | Mitigation |\n| --- | --- | --- | --- |\n| Platform | Medium | High | Fitness gate |",
      ),
    ],
  ]);
}

function drivers() {
  return {
    schemaVersion: 1,
    catalogueId: "valo.architecture.drivers/v1",
    lastReviewed: REVIEW_DATE,
    sourceReviewedThrough: REVIEW_DATE,
    drivers: [
      {
        id: "AD-001",
        category: "functional",
        title: "Evidence-led project workflow",
        owner: "Product architecture",
        priority: "critical",
        status: "active",
        decisionRefs: [],
        evidence: ["docs/architecture/CONTEXT.md"],
      },
      {
        id: "AD-002",
        category: "quality_attribute",
        title: "Tenant isolation and release integrity",
        owner: "Security architecture",
        priority: "critical",
        status: "active",
        decisionRefs: [],
        evidence: ["docs/architecture/QUALITY_ATTRIBUTES.md"],
      },
      {
        id: "AD-003",
        category: "constraint",
        title: "TypeScript modular monorepo constraint",
        owner: "Platform architecture",
        priority: "high",
        status: "active",
        decisionRefs: [],
        evidence: ["artifacts/app/package.json"],
      },
      {
        id: "AD-004",
        category: "principle",
        title: "Incremental modular monolith principle",
        owner: "Platform architecture",
        priority: "high",
        status: "active",
        decisionRefs: ["ADR-0001"],
        evidence: ["docs/implementation-v2.5/adrs/0001-modular-monolith.md"],
      },
    ],
  };
}

function moduleBoundaries() {
  return {
    schemaVersion: 1,
    catalogueId: "valo.architecture.module-boundaries/v1",
    lastReviewed: REVIEW_DATE,
    sourceReviewedThrough: REVIEW_DATE,
    modules: [
      {
        id: "app",
        package: "@workspace/app",
        roots: ["artifacts/app/src"],
        mayDependOn: ["database"],
      },
      {
        id: "database",
        package: "@workspace/db",
        roots: ["lib/db/src"],
        mayDependOn: [],
      },
    ],
    internalBoundaries: [
      {
        id: "app-domain",
        module: "app",
        roots: ["artifacts/app/src/domain"],
        mayDependOn: [],
      },
      {
        id: "app-routes",
        module: "app",
        roots: ["artifacts/app/src/routes"],
        mayDependOn: ["app-domain"],
      },
      {
        id: "database-core",
        module: "database",
        roots: ["lib/db/src"],
        mayDependOn: [],
      },
    ],
    hotspotPolicy: {
      defaultMaxLines: 30,
      excludedPaths: [],
      exceptions: [],
    },
  };
}

function risks() {
  return {
    schemaVersion: 1,
    catalogueId: "valo.architecture.risks/v1",
    lastReviewed: REVIEW_DATE,
    sourceReviewedThrough: REVIEW_DATE,
    risks: [
      {
        id: "AR-001",
        title: "Cross-boundary policy drift",
        owner: "Platform architecture",
        likelihood: "medium",
        impact: "high",
        status: "mitigating",
        mitigation: "Run the executable architecture verification gate.",
        driverIds: ["AD-002"],
        evidence: ["docs/architecture/RISK_REGISTER.md"],
        reviewBy: "2026-11-30",
      },
    ],
  };
}

function routePolicies() {
  const controls = {
    authentication: "required",
    tenantScope: "required",
    transactionMode: "request_transaction",
  };
  return {
    schemaVersion: 1,
    catalogueId: "valo.architecture.route-policies/v1",
    lastReviewed: REVIEW_DATE,
    sourceReviewedThrough: REVIEW_DATE,
    statusVocabulary: ["implemented", "activation_gated"],
    defaults: [
      {
        module: "app",
        pathPrefix: "/",
        status: "implemented",
        controls,
      },
    ],
    overrides: [
      {
        id: "project-package-export",
        module: "app",
        method: "POST",
        path: "/projects/{id}/export",
        status: "implemented",
        controls: {
          ...controls,
          permission: "report:export",
          releasedProjectPolicy: "governed_export",
          idempotency: "required",
          concurrency: "if_match_and_project_lock",
          audit: "project.exported",
        },
      },
    ],
  };
}

async function createFixture(root) {
  for (const [path, source] of architectureDocuments())
    await put(root, path, source);
  await json(root, "config/architecture/drivers.v1.json", drivers());
  await json(
    root,
    "config/architecture/module-boundaries.v1.json",
    moduleBoundaries(),
  );
  await json(
    root,
    "config/architecture/route-policies.v1.json",
    routePolicies(),
  );
  await json(root, "config/architecture/risks.v1.json", risks());

  await put(
    root,
    "docs/implementation-v2.5/adrs/0001-modular-monolith.md",
    `# ADR-0001: Modular monolith

Status: Accepted
Decision date: 2026-08-08
Last reviewed: ${REVIEW_DATE}
Next review: 2026-11-30
Owner: Platform architecture
Backup owner: Platform operations
Reviewers: Security and operations
Drivers: \`AD-004\`
Evidence: \`artifacts/app/package.json\`
Supersedes: None
Superseded by: None

## Context
The repository needs a bounded architecture.

## Decision
Use a modular monolith.

## Consequences
Dependencies remain explicit.

## Rejected
Unmeasured services.
`,
  );
  await json(root, "artifacts/app/package.json", {
    name: "@workspace/app",
    dependencies: { "@workspace/db": "workspace:*" },
  });
  await json(root, "artifacts/app/tsconfig.json", {
    compilerOptions: { paths: { "@/*": ["./src/*"] } },
  });
  await json(root, "lib/db/package.json", { name: "@workspace/db" });
  await put(
    root,
    "artifacts/app/src/index.ts",
    'import { db } from "@workspace/db";\nexport const app = db;\n',
  );
  await put(
    root,
    "artifacts/app/src/domain/index.ts",
    '// import { routes } from "../routes/index";\nexport const domain = true;\n',
  );
  await put(
    root,
    "artifacts/app/src/routes/index.ts",
    'import { domain } from "../domain/index";\nexport const routes = domain;\n',
  );
  await put(root, "lib/db/src/index.ts", "export const db = {};\n");
  await put(
    root,
    "lib/api-spec/openapi.yaml",
    `openapi: 3.1.0
paths:
  /projects/{id}/export:
    post:
      operationId: exportProject
      responses:
        "200":
          description: Exported
`,
  );
  await put(
    root,
    "artifacts/api-server/src/lib/projectRoutePolicy.ts",
    'const policy = (value: unknown) => value;\nexport const PROJECT_ROUTE_POLICIES = [policy({ id: "project-package-export" })];\n',
  );
  await put(
    root,
    ".github/pull_request_template.md",
    `## Architecture impact
- Architecture driver:
- ADR / decision record:
- Module boundary or component map:
- Architecture risk register:
- Route policy:
- C4, dynamic flow, or deployment view:
`,
  );
}

async function withFixture(name, callback) {
  const root = await mkdtemp(join(tmpdir(), `bidbox-architecture-${name}-`));
  try {
    await createFixture(root);
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("accepts a complete, internally linked architecture fixture", async () => {
  await withFixture("valid", async (root) => {
    const result = await verifyArchitectureRepository(root);
    assert.equal(result.documentCount, 10);
    assert.equal(result.adrCount, 1);
    assert.equal(result.driverCount, 4);
    assert.equal(result.riskCount, 1);
    assert.equal(result.moduleCount, 2);
    assert.equal(result.internalComponentCount, 3);
    assert.equal(result.routeOperationCount, 1);
    assert.deepEqual(result.moduleDependencyEdges, ["app -> database"]);
    assert.deepEqual(result.componentDependencyEdges, [
      "app-routes -> app-domain",
    ]);
  });
});

test("rejects broken local Markdown links and unbalanced Mermaid fences", async () => {
  await withFixture("markdown", async (root) => {
    const contextPath = resolve(root, "docs/architecture/CONTEXT.md");
    const context = await readFile(contextPath, "utf8");
    await writeFile(contextPath, `${context}\n[missing](MISSING.md)\n`, "utf8");
    await assert.rejects(
      validateArchitectureDocuments(root),
      /broken Markdown link/u,
    );

    await writeFile(contextPath, context.replace(/```\s*$/u, ""), "utf8");
    await assert.rejects(
      validateArchitectureDocuments(root),
      /unclosed mermaid fence/u,
    );
  });
});

test("rejects incomplete or stale architecture document metadata", async () => {
  await withFixture("metadata", async (root) => {
    const path = resolve(root, "docs/architecture/GLOSSARY.md");
    const source = await readFile(path, "utf8");
    await writeFile(
      path,
      source.replace("**Verified:**", "**Evidence:**"),
      "utf8",
    );
    await assert.rejects(
      verifyArchitectureRepository(root),
      /missing verified metadata/u,
    );

    await writeFile(path, source.replace(REVIEW_DATE, "2026-08-30"), "utf8");
    await assert.rejects(
      verifyArchitectureRepository(root),
      /before the architecture source review/u,
    );
  });
});

test("enforces ADR identity, metadata, sections, and supersession lifecycle", async () => {
  await withFixture("adr", async (root) => {
    const path = resolve(
      root,
      "docs/implementation-v2.5/adrs/0001-modular-monolith.md",
    );
    const source = await readFile(path, "utf8");
    await writeFile(
      path,
      source.replace("Status: Accepted", "Status: Superseded"),
      "utf8",
    );
    await assert.rejects(
      validateArchitectureDecisionRecords(root),
      /must name exactly one successor/u,
    );

    await writeFile(
      path,
      source.replace("## Consequences", "## Results"),
      "utf8",
    );
    await assert.rejects(
      validateArchitectureDecisionRecords(root),
      /must document Consequences/u,
    );

    await writeFile(
      path,
      source.replace("Backup owner: Platform operations\n", ""),
      "utf8",
    );
    await assert.rejects(
      validateArchitectureDecisionRecords(root),
      /Backup owner must be a string/u,
    );

    await writeFile(path, source.replace("Supersedes: None\n", ""), "utf8");
    await assert.rejects(
      validateArchitectureDecisionRecords(root),
      /Supersedes must be a string/u,
    );

    await writeFile(
      path,
      source.replace(
        `Last reviewed: ${REVIEW_DATE}`,
        "Last reviewed: 2026-08-30",
      ),
      "utf8",
    );
    await assert.rejects(
      verifyArchitectureRepository(root),
      /ADR-0001 was last reviewed 2026-08-30, before the architecture source review/u,
    );
  });
});

test("fails forbidden workspace imports and dependency cycles", async () => {
  await withFixture("boundaries", async (root) => {
    const path = resolve(root, "config/architecture/module-boundaries.v1.json");
    const value = JSON.parse(await readFile(path, "utf8"));
    value.modules[0].mayDependOn = [];
    await writeFile(path, JSON.stringify(value), "utf8");
    await assert.rejects(
      validateModuleBoundaries(root, value),
      /package\.json dependency database is not in mayDependOn/u,
    );

    const cyclic = moduleBoundaries();
    cyclic.modules[1].mayDependOn = ["app"];
    await assert.rejects(
      validateModuleBoundaries(root, cyclic),
      /module dependency cycle detected/u,
    );

    const invalidBudget = moduleBoundaries();
    invalidBudget.modules[0].maxSourceFileLines = "not-a-number";
    await assert.rejects(
      validateModuleBoundaries(root, invalidBudget),
      /maxSourceFileLines must be a positive integer/u,
    );
  });
});

test("resolves relative imports and rejects internal or workspace implementation crossings", async () => {
  await withFixture("internal-boundaries", async (root) => {
    const catalogue = moduleBoundaries();
    await put(
      root,
      "artifacts/app/src/domain/forbidden.ts",
      'import {\n  routes,\n} from "../routes/index";\nexport const forbidden = routes;\n',
    );
    await assert.rejects(
      validateModuleBoundaries(root, catalogue),
      /imports forbidden internal component app-routes/u,
    );
    catalogue.internalBoundaryExceptions = [
      {
        id: "legacy-domain-route-edge",
        from: "app-domain",
        to: "app-routes",
        importers: ["artifacts/app/src/domain/forbidden.ts"],
        owner: "Platform architecture",
        reason: "Legacy edge is frozen until the domain contract is extracted.",
        reviewBy: "2026-11-30",
      },
    ];
    const excepted = await validateModuleBoundaries(root, catalogue);
    assert.equal(excepted.internalExceptionCount, 1);

    catalogue.internalBoundaryExceptions = [];
    await put(
      root,
      "artifacts/app/src/domain/forbidden.ts",
      'import { routes } from "@/routes/index";\nexport const forbidden = routes;\n',
    );
    await assert.rejects(
      validateModuleBoundaries(root, catalogue),
      /imports forbidden internal component app-routes/u,
    );

    await put(
      root,
      "artifacts/app/src/domain/forbidden.ts",
      'export const forbidden = import("../routes/index", { with: { type: "json" } });\n',
    );
    await assert.rejects(
      validateModuleBoundaries(root, catalogue),
      /imports forbidden internal component app-routes/u,
    );

    await put(
      root,
      "artifacts/app/src/domain/forbidden.ts",
      'import { db } from "../../../../lib/db/src/index";\nexport const forbidden = db;\n',
    );
    await assert.rejects(
      validateModuleBoundaries(root, catalogue),
      /crosses into database; workspace implementations must be consumed through their declared package boundary/u,
    );

    catalogue.internalBoundaries[0].mayDependOn = ["app-routes"];
    await assert.rejects(
      validateModuleBoundaries(root, catalogue),
      /internal component dependency cycle detected/u,
    );
  });
});

test("requires explicit, bounded and reviewed hotspot exceptions", async () => {
  await withFixture("hotspot", async (root) => {
    const largeSource = Array.from(
      { length: 40 },
      (_, index) => `export const value${index} = ${index};`,
    ).join("\n");
    await put(root, "artifacts/app/src/large.ts", `${largeSource}\n`);
    const catalogue = moduleBoundaries();
    await assert.rejects(
      validateModuleBoundaries(root, catalogue),
      /exceeds its 30-line architectural hotspot budget/u,
    );

    catalogue.hotspotPolicy.exceptions.push({
      path: "artifacts/app/src/large.ts",
      maxLines: 45,
      owner: "Platform architecture",
      reason: "Temporary decomposition seam with an assigned owner.",
      reviewBy: "2026-11-30",
    });
    const result = await validateModuleBoundaries(root, catalogue);
    assert.equal(result.hotspotExceptionCount, 1);

    catalogue.hotspotPolicy.exceptions[0].reviewBy = "2026-08-30";
    await assert.rejects(
      validateModuleBoundaries(root, catalogue),
      /hotspot exception review must not predate/u,
    );
  });
});

test("requires route defaults, exact runtime IDs, and truthful non-OpenAPI classifications", async () => {
  await withFixture("routes", async (root) => {
    const path = resolve(root, "config/architecture/route-policies.v1.json");
    const missing = routePolicies();
    missing.overrides = [];
    await writeFile(path, JSON.stringify(missing), "utf8");
    await assert.rejects(
      verifyArchitectureRepository(root),
      /must declare high-risk overrides/u,
    );

    const invalidStatus = routePolicies();
    invalidStatus.overrides[0].status = "implemented_typo";
    await writeFile(path, JSON.stringify(invalidStatus), "utf8");
    await assert.rejects(
      verifyArchitectureRepository(root),
      /implemented_typo is not declared in route policy statusVocabulary/u,
    );

    const internal = routePolicies();
    internal.overrides.push({
      ...internal.overrides[0],
      id: "internal-activation-command",
      path: "/internal/not-mounted",
    });
    await writeFile(path, JSON.stringify(internal), "utf8");
    await assert.rejects(
      verifyArchitectureRepository(root),
      /must match an OpenAPI operation or declare/u,
    );

    internal.overrides[1].classification = "activation_gated";
    await writeFile(path, JSON.stringify(internal), "utf8");
    const result = await verifyArchitectureRepository(root);
    assert.equal(result.routePolicyOverrideCount, 2);

    const invalidControls = routePolicies();
    invalidControls.defaults[0].controls.authentication = "";
    await writeFile(path, JSON.stringify(invalidControls), "utf8");
    await assert.rejects(
      verifyArchitectureRepository(root),
      /authentication must be meaningful/u,
    );

    const nearPrefix = routePolicies();
    nearPrefix.defaults = [
      { ...nearPrefix.defaults[0], pathPrefix: "/projects" },
      { ...nearPrefix.defaults[0], pathPrefix: "/me" },
    ];
    await writeFile(path, JSON.stringify(nearPrefix), "utf8");
    await put(
      root,
      "lib/api-spec/openapi.yaml",
      `openapi: 3.1.0
paths:
  /projects/{id}/export:
    post:
      responses: {}
  /meow:
    get:
      responses: {}
`,
    );
    await assert.rejects(
      verifyArchitectureRepository(root),
      /GET \/meow has no route-policy default/u,
    );

    await put(
      root,
      "lib/api-spec/openapi.yaml",
      `openapi: 3.1.0
paths:
  /projects/{id}/export:
    post:
      responses: {}
`,
    );
    await writeFile(path, JSON.stringify(routePolicies()), "utf8");
    await put(
      root,
      "artifacts/api-server/src/lib/projectRoutePolicy.ts",
      'const runtimeId = "project-package-export";\nconst policy = (value: unknown) => value;\nexport const PROJECT_ROUTE_POLICIES = [policy({ id: runtimeId })];\n',
    );
    await assert.rejects(
      verifyArchitectureRepository(root),
      /policy id must be a string literal/u,
    );
  });
});

test("requires the architecture-impact prompts in the pull request template", async () => {
  await withFixture("pr-template", async (root) => {
    await put(
      root,
      ".github/pull_request_template.md",
      "## Architecture impact\nArchitecture driver and ADR.\n",
    );
    await assert.rejects(
      verifyArchitectureRepository(root),
      /must prompt for module boundary/u,
    );
  });
});

test("parses each OpenAPI operation deterministically", () => {
  assert.deepEqual(
    parseOpenApiOperations(`paths:
  /readyz:
    get:
      responses: {}
  /projects/{id}:
    patch:
      responses: {}
`),
    [
      { method: "GET", path: "/readyz" },
      { method: "PATCH", path: "/projects/{id}" },
    ],
  );
});
