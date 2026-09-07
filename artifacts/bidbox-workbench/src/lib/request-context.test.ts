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
  it.each(["X-BidBox-Organisation-Id", "X-Valo-Organisation-Id"])(
    "preserves an explicit %s selection instead of the ambient organisation",
    async (header) => {
      const fetchMock = vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Response(null, { status: 204 }),
      );
      const contextGetter = vi.fn(() => ({ organisationId: "org-ambient" }));
      vi.stubGlobal("fetch", fetchMock);
      setRequestContextGetter(contextGetter);

      await customFetch("/api/context-check", {
        headers: { [header]: "org-explicit" },
      });

      const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
      expect(headers.get(header)).toBe("org-explicit");
      const otherHeader =
        header === "X-Valo-Organisation-Id"
          ? "X-BidBox-Organisation-Id"
          : "X-Valo-Organisation-Id";
      expect(headers.has(otherHeader)).toBe(false);
      expect(contextGetter).not.toHaveBeenCalled();
    },
  );

  it("preserves a legacy tenant selection supplied on a Request", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const contextGetter = vi.fn(() => ({ organisationId: "org-ambient" }));
    setRequestContextGetter(contextGetter);

    await customFetch(
      new Request(`${window.location.origin}/api/context-check`, {
        headers: { "X-Valo-Organisation-Id": "org-explicit" },
      }),
    );

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("X-Valo-Organisation-Id")).toBe("org-explicit");
    expect(headers.has("X-BidBox-Organisation-Id")).toBe(false);
    expect(contextGetter).not.toHaveBeenCalled();
  });

  it("allows matching explicit tenant aliases", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const contextGetter = vi.fn(() => ({ organisationId: "org-ambient" }));
    setRequestContextGetter(contextGetter);

    await customFetch("/api/context-check", {
      headers: {
        "X-Valo-Organisation-Id": "org-explicit",
        "X-BidBox-Organisation-Id": "org-explicit",
      },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(contextGetter).not.toHaveBeenCalled();
  });

  it("rejects conflicting tenant aliases before sending a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      customFetch("/api/context-check", {
        headers: {
          "X-Valo-Organisation-Id": "org-first",
          "X-BidBox-Organisation-Id": "org-second",
        },
      }),
    ).rejects.toThrow(/must select the same organisation/u);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects conflicting aliases merged from Request and options headers", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      customFetch(
        new Request(`${window.location.origin}/api/context-check`, {
          headers: { "X-Valo-Organisation-Id": "org-first" },
        }),
        {
          headers: { "X-BidBox-Organisation-Id": "org-second" },
        },
      ),
    ).rejects.toThrow(/must select the same organisation/u);

    expect(fetchMock).not.toHaveBeenCalled();
  });

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

    expect(observedHeaders.get("x-bidbox-organisation-id")).toBe(
      "org-verified",
    );
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

    expect(observedHeaders.has("x-bidbox-organisation-id")).toBe(false);
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

    expect(observedHeaders.has("x-bidbox-organisation-id")).toBe(false);
  });
});
