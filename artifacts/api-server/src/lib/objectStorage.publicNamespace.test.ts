import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertPublicSearchPathsDisjointFromPrivateDir,
  isServablePublicObjectKey,
} from "./objectStorage";

const libSource = readFileSync(
  new URL("./objectStorage.ts", import.meta.url),
  "utf8",
);
const routeSource = readFileSync(
  new URL("../routes/storage.ts", import.meta.url),
  "utf8",
);

test("servable public keys are bounded normalised relative paths", () => {
  assert.equal(isServablePublicObjectKey("logo.png"), true);
  assert.equal(isServablePublicObjectKey("brand/2026/logo-dark.svg"), true);
  assert.equal(isServablePublicObjectKey("fonts/Inter_Variable.woff2"), true);
  assert.equal(isServablePublicObjectKey("a".repeat(512)), true);
});

test("traversal, absolute, doubled and exotic keys fail closed", () => {
  assert.equal(isServablePublicObjectKey(""), false);
  assert.equal(isServablePublicObjectKey("/etc/passwd"), false);
  assert.equal(isServablePublicObjectKey("../private/doc"), false);
  assert.equal(isServablePublicObjectKey("brand/../../tenants/x"), false);
  assert.equal(isServablePublicObjectKey("brand//logo.png"), false);
  assert.equal(isServablePublicObjectKey("brand/./logo.png"), false);
  assert.equal(isServablePublicObjectKey("."), false);
  assert.equal(isServablePublicObjectKey(".."), false);
  assert.equal(isServablePublicObjectKey("..."), false);
  assert.equal(isServablePublicObjectKey("brand\\logo.png"), false);
  assert.equal(isServablePublicObjectKey("brand/logo.png\n"), false);
  assert.equal(isServablePublicObjectKey("brand/logo .png"), false);
  assert.equal(isServablePublicObjectKey("brand/%2e%2e/x"), false);
  assert.equal(isServablePublicObjectKey("a".repeat(513)), false);
});

test("public search paths overlapping the private dir are rejected", () => {
  const privateDir = "/bidbox-bucket/.private";
  assert.doesNotThrow(() =>
    assertPublicSearchPathsDisjointFromPrivateDir(
      ["/bidbox-bucket/public", "/bidbox-bucket/assets"],
      privateDir,
    ),
  );
  for (const overlapping of [
    "/bidbox-bucket/.private",
    "/bidbox-bucket/.private/",
    "/bidbox-bucket/.private/published",
    "/bidbox-bucket",
    "/",
  ]) {
    assert.throws(
      () =>
        assertPublicSearchPathsDisjointFromPrivateDir(
          ["/bidbox-bucket/public", overlapping],
          privateDir,
        ),
      /must be disjoint/u,
      overlapping,
    );
  }
});

test("sibling prefixes sharing a name stem are not false positives", () => {
  assert.doesNotThrow(() =>
    assertPublicSearchPathsDisjointFromPrivateDir(
      ["/bidbox-bucket/.private-assets"],
      "/bidbox-bucket/.private",
    ),
  );
});

test("public lookups validate the key and assert namespace disjointness", () => {
  const searchAt = libSource.indexOf("async searchPublicObject(");
  const validateAt = libSource.indexOf("isServablePublicObjectKey(filePath)");
  const lookupAt = libSource.indexOf("getPublicObjectSearchPaths()", searchAt);
  assert.ok(searchAt >= 0 && validateAt > searchAt);
  assert.ok(
    lookupAt > validateAt,
    "key validation must precede any provider lookup",
  );

  const pathsAt = libSource.indexOf("getPublicObjectSearchPaths(): Array");
  const disjointAt = libSource.indexOf(
    "assertPublicSearchPathsDisjointFromPrivateDir(",
    pathsAt,
  );
  const returnAt = libSource.indexOf("return paths;", pathsAt);
  assert.ok(pathsAt >= 0 && disjointAt > pathsAt);
  assert.ok(
    returnAt > disjointAt,
    "search paths must be proven disjoint from the private dir before use",
  );
});

test("the public route serves only via the validated search helper", () => {
  const routeAt = routeSource.indexOf('"/storage/public-objects/*filePath"');
  assert.ok(routeAt >= 0);
  const handler = routeSource.slice(
    routeAt,
    routeSource.indexOf('"/storage/objects/*path"'),
  );
  assert.match(handler, /searchPublicObject\(/u);
  assert.doesNotMatch(handler, /getObjectEntityFile|bucket\(|\.file\(/u);
  assert.doesNotMatch(
    routeSource.slice(routeAt - 700, routeAt),
    /unconditionally public — no authentication/u,
    "the stale docstring claiming an unauthenticated mount must not return",
  );
});
