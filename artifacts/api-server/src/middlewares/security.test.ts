import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseAllowedOrigins } from "./security";

describe("CORS origin policy", () => {
  test("production defaults to no browser origins", () => {
    assert.deepEqual([...parseAllowedOrigins(undefined, "production")], []);
  });

  test("uses an exact, trimmed allowlist and refuses credentialed wildcard", () => {
    assert.deepEqual(
      [
        ...parseAllowedOrigins(
          " https://portal.bidbox.ng/,*,https://partner.bidbox.ng ",
          "production",
        ),
      ],
      ["https://portal.bidbox.ng", "https://partner.bidbox.ng"],
    );
  });

  test("development receives only explicit local defaults", () => {
    const origins = parseAllowedOrigins(undefined, "development");
    assert.equal(origins.has("http://localhost:5173"), true);
    assert.equal(origins.has("https://untrusted.example"), false);
  });
});
