import { execFileSync } from "node:child_process";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";

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
