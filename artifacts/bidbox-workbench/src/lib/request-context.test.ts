import { afterEach, describe, expect, it, vi } from "vitest";
import {
  customFetch,
  setRequestContextGetter,
} from "@workspace/api-client-react";

afterEach(() => {
  setRequestContextGetter(null);
  vi.unstubAllGlobals();
});

describe("API request organisation context", () => {
  it("attaches the selected organisation to generated API requests", async () => {
    let observedHeaders = new Headers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        observedHeaders = new Headers(init?.headers);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    setRequestContextGetter(() => ({ organisationId: "org-verified" }));

    await customFetch("/api/context-check", { responseType: "json" });

    expect(observedHeaders.get("x-valo-organisation-id")).toBe("org-verified");
  });

  it("does not retain an organisation header after context is cleared", async () => {
    let observedHeaders = new Headers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        observedHeaders = new Headers(init?.headers);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    setRequestContextGetter(() => ({ organisationId: null }));

    await customFetch("/api/context-check", { responseType: "json" });

    expect(observedHeaders.has("x-valo-organisation-id")).toBe(false);
  });

  it("does not disclose organisation context to an external URL", async () => {
    let observedHeaders = new Headers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        observedHeaders = new Headers(init?.headers);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    setRequestContextGetter(() => ({ organisationId: "org-sensitive" }));

    await customFetch("https://objects.example.test/signed-upload", {
      responseType: "json",
    });

    expect(observedHeaders.has("x-valo-organisation-id")).toBe(false);
  });
});
