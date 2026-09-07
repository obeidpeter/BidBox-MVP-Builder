import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("root developer checks expose bounded fast, database, and full lanes", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));

  assert.match(packageJson.scripts.doctor, /scripts\/doctor\.mjs/u);
  assert.match(packageJson.scripts["check:fast"], /scripts\/doctor\.mjs/u);
  assert.match(packageJson.scripts["check:fast"], /codegen:check/u);
  assert.match(packageJson.scripts["check:fast"], /typecheck/u);
  assert.match(packageJson.scripts["check:db"], /migration:check/u);
  assert.match(packageJson.scripts["check:db"], /migration:apply/u);
  assert.match(
    packageJson.scripts["check:db"],
    /lib\/db\/tenant-rls\.static\.test\.mjs/u,
  );
  assert.match(packageJson.scripts["check:db"], /@workspace\/api-server test/u);
  assert.match(packageJson.scripts["check:all"], /check:fast/u);
  assert.match(packageJson.scripts["check:all"], /check:db/u);
  assert.match(
    packageJson.scripts["check:all"],
    /@workspace\/bidbox-workbench test/u,
  );
  assert.match(packageJson.scripts["check:all"], /run build/u);
});
