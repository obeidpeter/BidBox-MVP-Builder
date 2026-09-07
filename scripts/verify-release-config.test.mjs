import assert from "node:assert/strict";
import test from "node:test";

import {
  assertReleaseIdentityIsDeploymentOnly,
  RELEASE_IDENTITY_SOURCE_CONFIG_PATHS,
} from "./release-config-policy.mjs";

const cleanConfigurations = () =>
  Object.fromEntries(
    RELEASE_IDENTITY_SOURCE_CONFIG_PATHS.map((relativePath) => [
      relativePath,
      'run = "node server.mjs"\nPORT = "8080"',
    ]),
  );

test("release identity remains absent from every checked-in Replit deployment surface", () => {
  assert.deepEqual(RELEASE_IDENTITY_SOURCE_CONFIG_PATHS, [
    ".replit",
    "artifacts/api-server/.replit-artifact/artifact.toml",
    "artifacts/mockup-sandbox/.replit-artifact/artifact.toml",
    "artifacts/bidbox-workbench/.replit-artifact/artifact.toml",
  ]);
  assert.doesNotThrow(() =>
    assertReleaseIdentityIsDeploymentOnly(cleanConfigurations()),
  );
});

for (const [caseName, tamperedSource] of [
  ["bare assignment", 'VALO_RELEASE_SHA256 = "a"'],
  ["quoted TOML key", '"VALO_RELEASE_SHA256" = "a"'],
  ["inline run assignment", 'run = "VALO_RELEASE_SHA256=a node server.mjs"'],
  ["inline environment map", 'env = { VALO_RELEASE_SHA256 = "a" }'],
]) {
  test(`rejects a ${caseName} on every checked-in Replit deployment surface`, () => {
    for (const relativePath of RELEASE_IDENTITY_SOURCE_CONFIG_PATHS) {
      const configurations = cleanConfigurations();
      configurations[relativePath] = tamperedSource;
      assert.throws(
        () => assertReleaseIdentityIsDeploymentOnly(configurations),
        (error) =>
          error instanceof assert.AssertionError &&
          error.message.includes(relativePath),
      );
    }
  });
}

test("rejects an incomplete deployment-surface inventory", () => {
  const configurations = cleanConfigurations();
  delete configurations[RELEASE_IDENTITY_SOURCE_CONFIG_PATHS.at(-1)];
  assert.throws(
    () => assertReleaseIdentityIsDeploymentOnly(configurations),
    /must cover every checked-in Replit deployment surface/,
  );
});
