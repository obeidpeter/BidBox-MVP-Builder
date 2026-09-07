// Replaced by the API build after checking committed source. Direct TypeScript
// execution deliberately has no release source identity or environment fallback.
declare const __BIDBOX_BUILD_SOURCE_COMMIT__: string | null;

const GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export function runtimeSourceCommit(): string | null {
  const value =
    typeof __BIDBOX_BUILD_SOURCE_COMMIT__ === "undefined"
      ? null
      : __BIDBOX_BUILD_SOURCE_COMMIT__;
  return typeof value === "string" && GIT_OBJECT_ID.test(value) ? value : null;
}
