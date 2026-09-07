import { afterEach, describe, expect, it, vi } from "vitest";
import {
  customFetch,
  setRequestContextGetter,
} from "@workspace/api-client-react";

describe("report download tenant context", () => {
  afterEach(() => {
    setRequestContextGetter(null);
    vi.unstubAllGlobals();
  });

  it.each([
    ["a selected direct membership", "direct-client-2"],
    ["a selected partner-projected client", "projected-client-7"],
  ])(
    "attaches the selected organisation for %s",
    async (_label, organisationId) => {
      setRequestContextGetter(() => ({ organisationId }));
      const fetchMock = vi.fn().mockResolvedValue(
        new Response("report", {
          status: 200,
          headers: { "content-type": "application/pdf" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await customFetch<Blob>(
        "/api/reports/report-1/download-pdf",
        { responseType: "blob" },
      );

      expect(result.size).toBe(6);
      expect(result.type).toBe("application/pdf");
      expect(await result.text()).toBe("report");
      const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect(
        new Headers(requestInit.headers).get("x-valo-organisation-id"),
      ).toBe(organisationId);
    },
  );
});
