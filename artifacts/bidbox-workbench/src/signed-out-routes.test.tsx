import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import SignedOutRoutes from "./signed-out-routes";
import {
  BID_AUTOPSY_OPERATION_STORAGE_KEY,
  loadBidAutopsyOperationState,
} from "./lib/public-bid-autopsy";

const INVALID_STORED_OPERATION_ID = [
  "00000000",
  "0000",
  "4000",
  "8000",
  "000000000001",
].join("-");

function renderAt(path: string) {
  const { hook } = memoryLocation({ path, record: true });
  return render(
    <Router hook={hook}>
      <SignedOutRoutes />
    </Router>,
  );
}

async function completeRequestForm() {
  const user = userEvent.setup();
  await screen.findByRole("heading", {
    level: 1,
    name: /^request a bid autopsy$/i,
  });
  fireEvent.change(screen.getByLabelText(/contact name/i), {
    target: { value: "Amina Bello" },
  });
  fireEvent.change(screen.getByLabelText(/^company/i), {
    target: { value: "Northstar Projects Ltd" },
  });
  fireEvent.change(screen.getByLabelText(/business email/i), {
    target: { value: "amina@northstar.example" },
  });
  fireEvent.change(screen.getByLabelText(/business telephone/i), {
    target: { value: "+234 801 234 5678" },
  });
  fireEvent.change(screen.getByLabelText(/tender category/i), {
    target: { value: "federal_public" },
  });
  fireEvent.change(screen.getByLabelText(/bid stage/i), {
    target: { value: "live" },
  });
  fireEvent.change(screen.getByLabelText(/preferred contact method/i), {
    target: { value: "email" },
  });
  fireEvent.click(screen.getByLabelText(/i have read the privacy notice/i));
  return user;
}

afterEach(() => {
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("public routing", () => {
  it.each([
    ["/", /find the problems before submission/i],
    ["/request-bid-autopsy", /^request a bid autopsy$/i],
    ["/product", /one organised workspace for complex bids/i],
    ["/solutions", /one trusted record, with clear access for each role/i],
    ["/how-it-works", /a clear path from first contact to final review/i],
    ["/security", /see the safeguards that protect each step/i],
    ["/about", /better tender work starts with a clear record/i],
    ["/contact", /start with a bid autopsy request/i],
    ["/privacy", /^privacy notice$/i],
    ["/terms", /service terms notice/i],
  ])("renders the canonical public page at %s", async (path, heading) => {
    renderAt(path);
    expect(
      await screen.findByRole("heading", { level: 1, name: heading }),
    ).toBeInTheDocument();
  });

  it("explains necessary tender and security terms in plain language", async () => {
    const workflow = renderAt("/how-it-works");
    await screen.findByRole("heading", {
      level: 1,
      name: /a clear path from first contact to final review/i,
    });

    expect(
      screen.getAllByText(/non-disclosure agreement \(NDA\)/i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/bill of quantities \(BOQ\)/i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/checks for a file's real type and contents/i),
    ).toBeInTheDocument();

    workflow.unmount();
    renderAt("/security");
    await screen.findByRole("heading", {
      level: 1,
      name: /see the safeguards that protect each step/i,
    });
    expect(
      screen.getByText(/links cryptographically to the one before it/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/malware inspection is not yet an approved/i),
    ).toBeInTheDocument();
  });

  it("sends every primary landing action to the same request journey", async () => {
    const user = userEvent.setup();
    renderAt("/");

    const primaryActions = screen.getAllByRole("link", {
      name: /^request a bid autopsy$/i,
    });
    expect(primaryActions.length).toBeGreaterThanOrEqual(4);
    expect(
      primaryActions.every(
        (link) => link.getAttribute("href") === "/request-bid-autopsy",
      ),
    ).toBe(true);

    await user.click(primaryActions[0]);
    const destinationHeading = await screen.findByRole("heading", {
      level: 1,
      name: /^request a bid autopsy$/i,
    });
    await waitFor(() => expect(destinationHeading).toHaveFocus());
    expect(
      document.getElementById("public-route-announcement"),
    ).toHaveTextContent(/navigated to request a bid autopsy/i);
  });

  it("does not move focus to the heading on an initial public page load", async () => {
    renderAt("/request-bid-autopsy");
    const heading = await screen.findByRole("heading", {
      level: 1,
      name: /^request a bid autopsy$/i,
    });

    expect(heading).not.toHaveFocus();
    expect(
      document.getElementById("public-route-announcement"),
    ).toBeEmptyDOMElement();
  });

  it("keeps FAQ, header and footer controls visibly focusable and at least 44px tall", async () => {
    renderAt("/");
    await screen.findByRole("heading", {
      level: 1,
      name: /find the problems before submission/i,
    });

    const faqSummary = screen
      .getByText("What is a Bid Autopsy?")
      .closest("summary");
    expect(faqSummary).not.toBeNull();
    expect(faqSummary).toHaveClass("min-h-11", "focus-visible:ring-2");
    expect(faqSummary).not.toHaveClass("focus-visible:outline-none");
    faqSummary?.focus();
    expect(faqSummary).toHaveFocus();

    expect(screen.getByRole("link", { name: "Valo home" })).toHaveClass(
      "min-h-11",
      "min-w-11",
    );
    expect(
      screen.getByRole("link", { name: "Security and trust" }),
    ).toHaveClass("min-h-11");
  });

  it("closes the mobile navigation with Escape and restores trigger focus", async () => {
    const user = userEvent.setup();
    renderAt("/");

    const menuButton = screen.getByRole("button", { name: /open menu/i });
    await user.click(menuButton);
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("link", { name: /what we check/i })
          .some((link) => link === document.activeElement),
      ).toBe(true),
    );
    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("button", { name: /close menu/i }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(menuButton).toHaveFocus());
  });

  it("returns a real public 404 for an unknown address", async () => {
    renderAt("/no/such/route");
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: /this page is not available/i,
      }),
    ).toBeInTheDocument();
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
  });

  it("noindexes and removes canonical metadata on an unapproved host", async () => {
    const canonical = document.createElement("link");
    canonical.rel = "canonical";
    canonical.href = "http://localhost:3000/";
    document.head.appendChild(canonical);
    const openGraphUrl = document.createElement("meta");
    openGraphUrl.setAttribute("property", "og:url");
    openGraphUrl.content = "http://localhost:3000/";
    document.head.appendChild(openGraphUrl);

    renderAt("/");
    await screen.findByRole("heading", {
      level: 1,
      name: /find the problems before submission/i,
    });

    await waitFor(() =>
      expect(
        document.head.querySelector('meta[name="robots"]'),
      ).toHaveAttribute("content", "noindex, nofollow"),
    );
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.head.querySelector('meta[property="og:url"]')).toBeNull();
  });
});

describe("Bid Autopsy request", () => {
  it("opens the required privacy notice without discarding the form", async () => {
    renderAt("/request-bid-autopsy");
    await screen.findByRole("heading", {
      level: 1,
      name: /^request a bid autopsy$/i,
    });

    const privacyLink = screen.getByRole("link", {
      name: /privacy notice \(opens in a new tab\)/i,
    });
    expect(privacyLink).toHaveAttribute("href", "/privacy");
    expect(privacyLink).toHaveAttribute("target", "_blank");
    expect(privacyLink).toHaveAttribute("rel", "noreferrer");
  });

  it("shows an accessible summary and field errors without sending", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderAt("/request-bid-autopsy");
    await screen.findByRole("heading", {
      level: 1,
      name: /^request a bid autopsy$/i,
    });

    await user.click(
      screen.getByRole("button", { name: /^request a bid autopsy$/i }),
    );

    const summary = screen.getByRole("alert", {
      name: /check the information below/i,
    });
    expect(summary).toHaveFocus();
    expect(
      screen.getAllByText(/enter a valid business email address/i),
    ).toHaveLength(2);
    expect(screen.getByLabelText(/business email/i)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits the bounded non-document payload and shows a confirmed next step", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          requestId: "5180ab46-ee3c-49a4-94ca-bc8e229c075a",
          status: "accepted",
          replayed: false,
          acceptedAt: "2026-08-10T12:00:00.000Z",
          nextStep:
            "The enquiry will be reviewed before any document intake is arranged.",
        }),
        { status: 202, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderAt("/request-bid-autopsy");
    const user = await completeRequestForm();

    expect(screen.queryByLabelText(/upload/i)).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /^request a bid autopsy$/i }),
    );

    const successHeading = await screen.findByRole("heading", {
      name: /your request has been received/i,
    });
    expect(successHeading).toBeInTheDocument();
    await waitFor(() => expect(successHeading).toHaveFocus());
    expect(
      screen.getByText(/enquiry will be reviewed before any document intake/i),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/public/bid-autopsy-requests");
    expect(request.method).toBe("POST");
    expect(request.credentials).toBe("same-origin");
    expect(request.headers).toMatchObject({
      "Content-Type": "application/json",
      "Idempotency-Key": expect.stringMatching(/^[0-9a-f-]{36}$/i),
    });
    expect(JSON.parse(String(request.body))).toMatchObject({
      contactName: "Amina Bello",
      companyName: "Northstar Projects Ltd",
      businessEmail: "amina@northstar.example",
      businessTelephone: "+234 801 234 5678",
      tenderCategory: "federal_public",
      bidStage: "live",
      preferredContactMethod: "email",
      privacyNoticeAcknowledged: true,
      website: "",
      formStartedAt: expect.any(String),
    });
    expect(JSON.parse(String(request.body))).not.toHaveProperty(
      "serviceContext",
    );
    expect(
      window.sessionStorage.getItem(BID_AUTOPSY_OPERATION_STORAGE_KEY),
    ).toBeNull();
  });

  it("reuses the idempotency key when an unchanged failed request is retried", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            requestId: "5180ab46-ee3c-49a4-94ca-bc8e229c075a",
            status: "accepted",
            replayed: false,
            acceptedAt: "2026-08-10T12:00:00.000Z",
            nextStep: "The enquiry will be reviewed.",
          }),
          { status: 202, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    renderAt("/request-bid-autopsy");
    const user = await completeRequestForm();

    await user.click(
      screen.getByRole("button", { name: /^request a bid autopsy$/i }),
    );
    expect(
      await screen.findByRole("alert", {
        name: /we could not confirm your request/i,
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(
      await screen.findByRole("heading", {
        name: /your request has been received/i,
      }),
    ).toBeInTheDocument();

    const firstHeaders = fetchMock.mock.calls[0][1].headers as Record<
      string,
      string
    >;
    const secondHeaders = fetchMock.mock.calls[1][1].headers as Record<
      string,
      string
    >;
    expect(firstHeaders["Idempotency-Key"]).toBe(
      secondHeaders["Idempotency-Key"],
    );
  });

  it("honours rate-limit wait guidance without misreporting a connection failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "RATE_LIMITED" } }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "90" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderAt("/request-bid-autopsy");
    await completeRequestForm();

    fireEvent.click(
      screen.getByRole("button", { name: /^request a bid autopsy$/i }),
    );

    const alert = await screen.findByRole("alert", {
      name: /please wait before trying again/i,
    });
    expect(alert).toHaveTextContent(/wait at least 90 seconds/i);
    expect(alert).not.toHaveTextContent(/check your connection/i);
  });

  it("does not offer an immediate retry when the page cannot accept the request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "FORBIDDEN" } }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    renderAt("/request-bid-autopsy");
    await completeRequestForm();

    fireEvent.click(
      screen.getByRole("button", { name: /^request a bid autopsy$/i }),
    );

    expect(
      await screen.findByRole("alert", {
        name: /this page cannot accept your request/i,
      }),
    ).toHaveTextContent(/do not keep retrying/i);
    expect(
      screen.getByRole("button", { name: /request unavailable/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("link", { name: /return to valo/i }),
    ).toHaveAttribute("href", "https://valo-mvp-builder.replit.app/");
    fireEvent.change(screen.getByLabelText(/^company/i), {
      target: { value: "Edited company" },
    });
    expect(
      screen.getByRole("button", { name: /request unavailable/i }),
    ).toBeDisabled();
  });

  it("refreshes an expired mounted request before any network disclosure", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderAt("/request-bid-autopsy");
    await completeRequestForm();
    const currentTime = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(
      currentTime + 24 * 60 * 60 * 1_000 + 1,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /^request a bid autopsy$/i }),
    );

    expect(
      await screen.findByRole("alert", {
        name: /this request page was refreshed/i,
      }),
    ).toHaveTextContent(/page was open for too long/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("persists only retry metadata across reloads, reuses equivalent requests and rotates material ones", async () => {
    const acceptedResponse = () =>
      new Response(
        JSON.stringify({
          requestId: "5180ab46-ee3c-49a4-94ca-bc8e229c075a",
          status: "accepted",
          replayed: false,
          acceptedAt: "2026-08-10T12:00:00.000Z",
          nextStep: "The enquiry will be reviewed.",
        }),
        { status: 202, headers: { "Content-Type": "application/json" } },
      );
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(acceptedResponse());
    vi.stubGlobal("fetch", fetchMock);
    const firstView = renderAt("/request-bid-autopsy");
    await completeRequestForm();

    fireEvent.click(
      screen.getByRole("button", { name: /^request a bid autopsy$/i }),
    );
    await screen.findByRole("alert", {
      name: /we could not confirm your request/i,
    });

    const persistedAfterFailure = window.sessionStorage.getItem(
      BID_AUTOPSY_OPERATION_STORAGE_KEY,
    );
    expect(persistedAfterFailure).not.toBeNull();
    expect(persistedAfterFailure).not.toMatch(
      /Amina|Northstar|amina@|234 801|contactName|companyName|businessEmail|businessTelephone/i,
    );
    expect(JSON.parse(persistedAfterFailure!)).toEqual({
      version: 1,
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      formStartedAt: expect.any(String),
      payloadDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });

    firstView.unmount();
    const equivalentView = renderAt("/request-bid-autopsy");
    await completeRequestForm();
    const email = screen.getByLabelText(/business email/i);
    fireEvent.change(email, { target: { value: "AMINA@NORTHSTAR.EXAMPLE" } });
    fireEvent.click(
      screen.getByRole("button", { name: /^request a bid autopsy$/i }),
    );
    await screen.findByRole("alert", {
      name: /we could not confirm your request/i,
    });

    equivalentView.unmount();
    renderAt("/request-bid-autopsy");
    await completeRequestForm();
    const company = screen.getByLabelText(/^company/i);
    fireEvent.change(company, {
      target: { value: "Northstar Projects Nigeria Ltd" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /^request a bid autopsy$/i }),
    );
    await screen.findByRole("heading", {
      name: /your request has been received/i,
    });

    const headers = fetchMock.mock.calls.map(
      (call) => (call[1] as RequestInit).headers as Record<string, string>,
    );
    expect(headers[0]["Idempotency-Key"]).toBe(headers[1]["Idempotency-Key"]);
    expect(headers[2]["Idempotency-Key"]).not.toBe(
      headers[1]["Idempotency-Key"],
    );

    const payloads = fetchMock.mock.calls.map((call) =>
      JSON.parse(String((call[1] as RequestInit).body)),
    );
    expect(payloads[0].formStartedAt).toBe(payloads[1].formStartedAt);
    expect(payloads[1].formStartedAt).toBe(payloads[2].formStartedAt);
    expect(
      window.sessionStorage.getItem(BID_AUTOPSY_OPERATION_STORAGE_KEY),
    ).toBeNull();
  }, 10_000);

  it("discards corrupt or PII-bearing retry state", async () => {
    window.sessionStorage.setItem(
      BID_AUTOPSY_OPERATION_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        idempotencyKey: INVALID_STORED_OPERATION_ID,
        formStartedAt: "2026-08-10T12:00:00.000Z",
        payloadDigest: null,
        businessEmail: "do-not-retain@example.test",
      }),
    );

    renderAt("/request-bid-autopsy");
    await screen.findByRole("heading", {
      level: 1,
      name: /^request a bid autopsy$/i,
    });

    const replacement = window.sessionStorage.getItem(
      BID_AUTOPSY_OPERATION_STORAGE_KEY,
    );
    expect(replacement).not.toContain("do-not-retain@example.test");
    expect(Object.keys(JSON.parse(replacement!)).sort()).toEqual([
      "formStartedAt",
      "idempotencyKey",
      "payloadDigest",
      "version",
    ]);
  });

  it.each([
    ["stale", "2000-01-01T00:00:00.000Z"],
    ["future", new Date(Date.now() + 60_000).toISOString()],
  ])(
    "replaces %s retry state outside the server form-age window",
    (_label, formStartedAt) => {
      window.sessionStorage.setItem(
        BID_AUTOPSY_OPERATION_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          idempotencyKey: INVALID_STORED_OPERATION_ID,
          formStartedAt,
          payloadDigest: null,
        }),
      );

      const replacement = loadBidAutopsyOperationState(window.sessionStorage);

      expect(replacement.formStartedAt).not.toBe(formStartedAt);
      expect(Date.parse(replacement.formStartedAt)).toBeLessThanOrEqual(
        Date.now(),
      );
      expect(replacement.payloadDigest).toBeNull();
    },
  );
});
