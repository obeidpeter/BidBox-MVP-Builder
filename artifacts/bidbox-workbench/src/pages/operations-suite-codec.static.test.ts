import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  resolve(import.meta.dirname, "pursuit-operations-suite-route.tsx"),
  "utf8",
);
const codecSource = readFileSync(
  resolve(import.meta.dirname, "operations-suite-codec.ts"),
  "utf8",
);

describe("operations-suite codec boundary", () => {
  it("keeps payload parsing and adapters outside the React route", () => {
    expect(routeSource).toContain('from "./operations-suite-codec"');
    expect(routeSource).not.toMatch(/function parseSnapshot\(/u);
    expect(routeSource).not.toMatch(/function parseRecord\(/u);
    expect(routeSource).not.toMatch(
      /export function adaptOperationsSuitePayload\(/u,
    );
    expect(codecSource).toMatch(/function parseSnapshot\(/u);
    expect(codecSource).toMatch(
      /export function adaptOperationsSuitePayload\(/u,
    );
  });

  it("keeps the codec pure of React and network dependencies", () => {
    expect(codecSource).not.toMatch(/from ["']react["']/u);
    expect(codecSource).not.toContain("customFetch");
    expect(codecSource).not.toContain("useQuery");
    expect(codecSource).not.toContain("useMutation");
  });
});
