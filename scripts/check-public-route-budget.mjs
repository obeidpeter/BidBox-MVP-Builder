import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const publicDirectory = path.resolve(
  root,
  "artifacts/bidbox-workbench/dist/public",
);
const indexPath = path.join(publicDirectory, "index.html");
const indexHtml = await readFile(indexPath, "utf8");

const limits = Object.freeze({
  initialJavaScriptGzipBytes: 100 * 1024,
  initialCssGzipBytes: 25 * 1024,
  individualInitialAssetBytes: 350 * 1024,
  publicImageBytes: 800 * 1024,
  publicFontBytes: 100 * 1024,
});

const lazyPublicRouteLimits = Object.freeze([
  Object.freeze({ prefix: "request-bid-autopsy-", gzipBytes: 8 * 1024 }),
  Object.freeze({ prefix: "public-pages-", gzipBytes: 10 * 1024 }),
]);

function localAssetPath(reference) {
  assert.match(
    reference,
    /^\/(?!\/)[^?#]+$/,
    `public entry asset must be a root-relative local URL: ${reference}`,
  );
  const resolved = path.resolve(publicDirectory, `.${reference}`);
  assert.ok(
    resolved.startsWith(`${publicDirectory}${path.sep}`),
    `public entry asset escaped the build directory: ${reference}`,
  );
  return resolved;
}

const scriptReferences = [
  ...indexHtml.matchAll(
    /<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"[^>]*>/gi,
  ),
].map((match) => match[1]);
const stylesheetReferences = [
  ...indexHtml.matchAll(
    /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/gi,
  ),
].map((match) => match[1]);

assert.ok(scriptReferences.length > 0, "public entry JavaScript was not found");
assert.ok(
  stylesheetReferences.length > 0,
  "public entry stylesheet was not found",
);

async function compressedTotal(references, label) {
  let total = 0;
  for (const reference of references) {
    const bytes = await readFile(localAssetPath(reference));
    assert.ok(
      bytes.byteLength <= limits.individualInitialAssetBytes,
      `${label} asset ${reference} is ${bytes.byteLength} bytes; limit is ${limits.individualInitialAssetBytes}`,
    );
    total += gzipSync(bytes, { level: 9 }).byteLength;
  }
  return total;
}

const initialJavaScriptGzipBytes = await compressedTotal(
  scriptReferences,
  "JavaScript",
);
const initialCssGzipBytes = await compressedTotal(stylesheetReferences, "CSS");

assert.ok(
  initialJavaScriptGzipBytes <= limits.initialJavaScriptGzipBytes,
  `public entry JavaScript is ${initialJavaScriptGzipBytes} gzip bytes; limit is ${limits.initialJavaScriptGzipBytes}`,
);
assert.ok(
  initialCssGzipBytes <= limits.initialCssGzipBytes,
  `public entry CSS is ${initialCssGzipBytes} gzip bytes; limit is ${limits.initialCssGzipBytes}`,
);

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(absolute)));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

const publicFiles = await walk(publicDirectory);
const lazyRouteResults = [];
for (const routeLimit of lazyPublicRouteLimits) {
  const matches = publicFiles.filter(
    (file) =>
      path.extname(file).toLowerCase() === ".js" &&
      path.basename(file).startsWith(routeLimit.prefix),
  );
  assert.equal(
    matches.length,
    1,
    `expected exactly one ${routeLimit.prefix} public route chunk`,
  );
  const bytes = await readFile(matches[0]);
  const gzipBytes = gzipSync(bytes, { level: 9 }).byteLength;
  assert.ok(
    gzipBytes <= routeLimit.gzipBytes,
    `${path.basename(matches[0])} is ${gzipBytes} gzip bytes; route limit is ${routeLimit.gzipBytes}`,
  );
  lazyRouteResults.push(
    `${routeLimit.prefix.replace(/-$/, "")} ${gzipBytes}/${routeLimit.gzipBytes}`,
  );
}
const imageExtensions = new Set([
  ".avif",
  ".gif",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
]);
const fontExtensions = new Set([".otf", ".ttf", ".woff", ".woff2"]);
let publicImageBytes = 0;
let publicFontBytes = 0;
for (const file of publicFiles) {
  const extension = path.extname(file).toLowerCase();
  const size = (await stat(file)).size;
  if (imageExtensions.has(extension)) publicImageBytes += size;
  if (fontExtensions.has(extension)) publicFontBytes += size;
}

assert.ok(
  publicImageBytes <= limits.publicImageBytes,
  `public images total ${publicImageBytes} bytes; limit is ${limits.publicImageBytes}`,
);
assert.ok(
  publicFontBytes <= limits.publicFontBytes,
  `public fonts total ${publicFontBytes} bytes; limit is ${limits.publicFontBytes}`,
);

console.log(
  `public route budget passed: JS ${initialJavaScriptGzipBytes}/${limits.initialJavaScriptGzipBytes} gzip bytes; CSS ${initialCssGzipBytes}/${limits.initialCssGzipBytes} gzip bytes; lazy routes ${lazyRouteResults.join(", ")} gzip bytes; images ${publicImageBytes}/${limits.publicImageBytes} bytes; fonts ${publicFontBytes}/${limits.publicFontBytes} bytes`,
);
