import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { transform } from "esbuild";
import { runtimeSourceCommit } from "./runtimeSourceIdentity";

describe("runtime source identity", () => {
  it("has no unbundled identity even when runtime environment declares a source", () => {
    const previous = process.env.BIDBOX_SOURCE_COMMIT;
    try {
      process.env.BIDBOX_SOURCE_COMMIT = "f".repeat(40);
      assert.equal(runtimeSourceCommit(), null);
    } finally {
      if (previous === undefined) delete process.env.BIDBOX_SOURCE_COMMIT;
      else process.env.BIDBOX_SOURCE_COMMIT = previous;
    }
  });

  it("uses only the verified build stamp and omits unverified builds", async () => {
    const source = await readFile(
      new URL("./runtimeSourceIdentity.ts", import.meta.url),
      "utf8",
    );
    for (const stamp of ["a".repeat(40), "b".repeat(64), null, "invalid"]) {
      const output = await transform(source, {
        loader: "ts",
        format: "esm",
        define: { __BIDBOX_BUILD_SOURCE_COMMIT__: JSON.stringify(stamp) },
      });
      const compiled = await import(
        `data:text/javascript;base64,${Buffer.from(output.code).toString("base64")}`
      );
      assert.equal(
        compiled.runtimeSourceCommit(),
        stamp === "invalid" ? null : stamp,
      );
    }
  });
});
