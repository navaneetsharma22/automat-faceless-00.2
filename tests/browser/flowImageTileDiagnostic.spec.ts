import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const diagnosticPath = resolve(
  process.cwd(),
  "tools/diagnostics/flow-image-tile-readonly.js",
);
const fixturePath = resolve(
  process.cwd(),
  "tests/fixtures/flow/image-tile-diagnostic.synthetic.html",
);

test("collects tile subtree identities and composed ownership without exposing values", async ({
  page,
}) => {
  const [diagnostic, fixture] = await Promise.all([
    readFile(diagnosticPath, "utf8"),
    readFile(fixturePath, "utf8"),
  ]);
  await page.setContent(fixture);
  await page.evaluate(() => {
    const tile = document.querySelectorAll("flow-image-tile")[0];
    const shadow = tile?.attachShadow({ mode: "open" });
    const shadowAsset = document.createElement("div");
    shadowAsset.setAttribute("data-asset-id", "synthetic-asset-alpha");
    const media = document.createElement("img");
    media.alt = "private shadow thumbnail text";
    shadowAsset.append(media);
    shadow?.append(shadowAsset);
    (
      window as Window & { copy?: (value: string) => void; copiedJson?: string }
    ).copy = (value) => {
      (window as Window & { copiedJson?: string }).copiedJson = value;
    };
  });
  const output = await page.evaluate(
    (script) => eval(script) as Promise<string>,
    diagnostic,
  );
  const report = JSON.parse(output) as {
    diagnostic: string;
    status: string;
    project: {
      boundaryCount: number;
      uniqueBoundaryOwnsComposer: boolean;
      renderedFlowImageTileCount: number;
      inventoryLimitation: string;
    };
    tiles: Array<{
      ownership: {
        composedAncestryReachesProject: boolean;
        composedAncestryTruncated: boolean;
        sameProjectBoundaryAsVerifiedComposer: boolean;
      };
      composedAncestorChain: Array<{ tag: string; role: string }>;
      relevantContainers: Array<{ tag: string; virtualizedContainer: boolean }>;
      subtree: {
        openShadowRootCount: number;
        traversalTruncated: boolean;
        identityCandidates: Array<{
          attributeName: string;
          category: string;
          valueMask: string;
          carrierTag: string;
        }>;
      };
      media: Array<{
        imageLoadSignals: {
          errorEventCapturedByThisDiagnostic: boolean;
          currentResourceErrorDistinguishable: boolean;
        } | null;
        rawMediaSourceReturned: boolean;
      }>;
    }>;
    identityLimits: Record<string, boolean>;
    privacy: Record<string, boolean>;
  };
  const copied = await page.evaluate(
    () => (window as Window & { copiedJson?: string }).copiedJson ?? null,
  );
  const serialized = JSON.stringify(report);
  const firstTile = report.tiles[0];
  const assetValues = firstTile?.subtree.identityCandidates.filter(
    (candidate) => candidate.attributeName === "data-asset-id",
  );

  expect(report.diagnostic).toBe("flow-image-tile-readonly-v1");
  expect(report.project.boundaryCount).toBe(1);
  expect(report.project.uniqueBoundaryOwnsComposer).toBe(true);
  expect(report.project.renderedFlowImageTileCount).toBe(2);
  expect(report.project.inventoryLimitation).toContain(
    "not a complete project inventory",
  );
  expect(report.tiles).toHaveLength(2);
  expect(firstTile?.ownership.composedAncestryReachesProject).toBe(true);
  expect(firstTile?.ownership.composedAncestryTruncated).toBe(false);
  expect(firstTile?.ownership.sameProjectBoundaryAsVerifiedComposer).toBe(true);
  expect(
    firstTile?.composedAncestorChain.some(
      (node) =>
        node.tag === "flow-grid-tile-container" && node.role === "group",
    ),
  ).toBe(true);
  expect(
    firstTile?.relevantContainers.some(
      (container) =>
        container.tag === "cdk-virtual-scroll-viewport" &&
        container.virtualizedContainer,
    ),
  ).toBe(true);
  expect(firstTile?.subtree.openShadowRootCount).toBe(1);
  expect(assetValues).toHaveLength(2);
  expect(assetValues?.[0]?.valueMask).toBe(assetValues?.[1]?.valueMask);
  expect(
    firstTile?.subtree.identityCandidates.some(
      (candidate) => candidate.category === "dom_element_id_not_asset_proof",
    ),
  ).toBe(true);
  expect(
    firstTile?.subtree.identityCandidates.some(
      (candidate) =>
        candidate.category === "accessibility_reference_not_asset_proof",
    ),
  ).toBe(true);
  expect(
    firstTile?.subtree.identityCandidates.some(
      (candidate) => candidate.carrierTag === "flow-image-hotbar",
    ),
  ).toBe(true);
  expect(
    firstTile?.media.every((media) => media.rawMediaSourceReturned === false),
  ).toBe(true);
  expect(
    firstTile?.media
      .filter((media) => media.imageLoadSignals !== null)
      .every(
        (media) =>
          media.imageLoadSignals?.errorEventCapturedByThisDiagnostic ===
            false &&
          media.imageLoadSignals.currentResourceErrorDistinguishable === false,
      ),
  ).toBe(true);
  expect(
    Object.values(report.identityLimits).every((value) => value === false),
  ).toBe(true);
  expect(Object.values(report.privacy).every((value) => value === false)).toBe(
    true,
  );
  expect(copied).toBe(output);
  expect(serialized).not.toContain("synthetic-asset-alpha");
  expect(serialized).not.toContain("synthetic-variant-beta");
  expect(serialized).not.toContain("synthetic-dom-hotbar-host");
  expect(serialized).not.toContain("private prompt text");
  expect(serialized).not.toContain("private shadow thumbnail text");
});
