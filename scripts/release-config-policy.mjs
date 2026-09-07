import assert from "node:assert/strict";

export const RELEASE_IDENTITY_SOURCE_CONFIG_PATHS = Object.freeze([
  ".replit",
  "artifacts/api-server/.replit-artifact/artifact.toml",
  "artifacts/mockup-sandbox/.replit-artifact/artifact.toml",
  "artifacts/bidbox-workbench/.replit-artifact/artifact.toml",
]);

const releaseIdentityToken = /\bVALO_RELEASE_SHA256\b/u;

export function assertReleaseIdentityIsDeploymentOnly(configurations) {
  assert.deepEqual(
    Object.keys(configurations).sort(),
    [...RELEASE_IDENTITY_SOURCE_CONFIG_PATHS].sort(),
    "Release-identity verification must cover every checked-in Replit deployment surface",
  );

  for (const relativePath of RELEASE_IDENTITY_SOURCE_CONFIG_PATHS) {
    const source = configurations[relativePath];
    assert.equal(
      typeof source,
      "string",
      `Expected text for Replit deployment surface ${relativePath}`,
    );
    assert.doesNotMatch(
      source,
      releaseIdentityToken,
      `Release identity must be injected through the target deployment environment, never pinned in ${relativePath}`,
    );
  }
}
