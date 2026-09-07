import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clerkProxyHostsFromOrigins,
  getClerkProxyHost,
} from "./clerkProxyMiddleware";

describe("Clerk proxy public-host boundary", () => {
  const origins = new Set([
    "https://bidbox-mvp-builder.replit.app",
    "https://bids.bidbox.example",
  ]);
  const hosts = clerkProxyHostsFromOrigins(origins);

  it("derives only exact host values from configured origins", () => {
    assert.deepEqual([...hosts].sort(), [
      "bidbox-mvp-builder.replit.app",
      "bids.bidbox.example",
    ]);
    assert.deepEqual(
      [
        ...clerkProxyHostsFromOrigins(
          new Set(["not an origin", "javascript:alert(1)"]),
        ),
      ],
      [],
    );
  });

  it("accepts the first forwarded hop only when it is allowlisted", () => {
    assert.equal(
      getClerkProxyHost(
        {
          headers: {
            "x-forwarded-host": "bidbox-mvp-builder.replit.app, internal.proxy",
            host: "internal.proxy",
          },
        },
        hosts,
      ),
      "bidbox-mvp-builder.replit.app",
    );
  });

  it("does not fall through to an allowed Host after a spoofed forwarded host", () => {
    assert.equal(
      getClerkProxyHost(
        {
          headers: {
            "x-forwarded-host": "attacker.example",
            host: "bidbox-mvp-builder.replit.app",
          },
        },
        hosts,
      ),
      undefined,
    );
  });

  it("uses an allowlisted Host only when no forwarded host exists", () => {
    assert.equal(
      getClerkProxyHost({ headers: { host: "BIDS.BIDBOX.EXAMPLE" } }, hosts),
      "bids.bidbox.example",
    );
    assert.equal(
      getClerkProxyHost({ headers: { host: "attacker.example/path" } }, hosts),
      undefined,
    );
  });

  it("keeps both rename origins usable for identity without accepting lookalikes", () => {
    const transitionHosts = clerkProxyHostsFromOrigins(
      new Set([
        "https://bidbox-mvp-builder.replit.app",
        "https://valo-mvp-builder.replit.app",
      ]),
    );
    for (const host of transitionHosts) {
      assert.equal(
        getClerkProxyHost({ headers: { host } }, transitionHosts),
        host,
      );
      assert.equal(
        getClerkProxyHost(
          { headers: { "x-forwarded-host": `${host}, internal.proxy` } },
          transitionHosts,
        ),
        host,
      );
      assert.equal(
        getClerkProxyHost(
          { headers: { host: `${host}.attacker.invalid` } },
          transitionHosts,
        ),
        undefined,
      );
    }
  });
});
