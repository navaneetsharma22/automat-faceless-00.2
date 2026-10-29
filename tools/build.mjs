/* global console */
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const buildId = `automat-faceless-0.1.0-${Date.now().toString(36)}`;
const viteCli = fileURLToPath(
  new URL("../node_modules/vite/bin/vite.js", import.meta.url),
);

for (const connectorOnly of [false, true]) {
  const env = { ...process.env, AUTOMAT_BUILD_ID: buildId };
  if (connectorOnly) env.AUTOMAT_CONNECTOR_BUILD = "1";
  else delete env.AUTOMAT_CONNECTOR_BUILD;

  execFileSync(process.execPath, [viteCli, "build"], {
    env,
    stdio: "inherit",
  });
}

const distDirectory = fileURLToPath(new URL("../dist/", import.meta.url));
const readTree = async (directory) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await readTree(path)));
    else files.push(path);
  }
  return files;
};
const assert = (condition, message) => {
  if (!condition)
    throw new Error(`Packaged build validation failed: ${message}`);
};

const sourceManifest = JSON.parse(
  await readFile(
    fileURLToPath(new URL("../public/manifest.json", import.meta.url)),
    "utf8",
  ),
);
const packagedManifest = JSON.parse(
  await readFile(join(distDirectory, "manifest.json"), "utf8"),
);
assert(
  JSON.stringify(packagedManifest) === JSON.stringify(sourceManifest),
  "dist/manifest.json does not match public/manifest.json",
);
assert(
  packagedManifest.background?.service_worker === "background.js",
  "manifest does not reference the packaged background worker",
);

const packagedFiles = await readTree(distDirectory);
const javascriptBundles = packagedFiles.filter((path) => path.endsWith(".js"));
assert(
  javascriptBundles.includes(join(distDirectory, "background.js")),
  "background.js is missing",
);
assert(
  javascriptBundles.includes(join(distDirectory, "connection-probe.js")),
  "standalone connection-probe.js is missing",
);

const buildIdPattern = /automat-faceless-0\.1\.0-[a-z0-9-]+/g;
for (const path of javascriptBundles) {
  const source = await readFile(path, "utf8");
  const ids = [...new Set(source.match(buildIdPattern) ?? [])];
  assert(
    ids.length === 1 && ids[0] === buildId,
    `${relative(distDirectory, path)} must contain only the current build ID`,
  );
}

const dashboardHtml = await readFile(join(distDirectory, "index.html"), "utf8");
const dashboardScripts = [
  ...dashboardHtml.matchAll(/(?:src|href)=["']\/?(assets\/[^"']+\.js)["']/g),
].map((match) => match[1]);
assert(
  dashboardScripts.length > 0,
  "dashboard entry does not reference a JavaScript bundle",
);
for (const script of dashboardScripts)
  assert(
    packagedFiles.includes(join(distDirectory, script)),
    `dashboard bundle is missing: ${script}`,
  );

console.info(
  `Packaged outputs validated (${buildId}; ${javascriptBundles.length} JavaScript bundles).`,
);
