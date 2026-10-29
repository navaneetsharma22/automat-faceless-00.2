import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const recorderPath = resolve(
  process.cwd(),
  "tools/diagnostics/flow-image-lifecycle-recorder-readonly.js",
);
const fixturePath = resolve(
  process.cwd(),
  "tests/fixtures/flow/image-lifecycle-recorder.synthetic.html",
);
const fixtureUrl = "https://flow.google.com/project/synthetic-project";

const loadFixture = async (page: import("@playwright/test").Page) => {
  const fixture = await readFile(fixturePath, "utf8");
  await page.route("https://flow.google.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: fixture }),
  );
  await page.goto(fixtureUrl);
};

const armRecorder = async (
  page: import("@playwright/test").Page,
  recorder: string,
) =>
  page.evaluate((script) => {
    eval(script);
    const handle = (
      window as Window & {
        __FLOW_P053_LIFECYCLE_RECORDER__?: {
          state: string;
          baselineCandidateCount: number;
          maxDurationMs: number;
        };
      }
    ).__FLOW_P053_LIFECYCLE_RECORDER__;
    return handle
      ? {
          state: handle.state,
          baselineCandidateCount: handle.baselineCandidateCount,
          maxDurationMs: handle.maxDurationMs,
        }
      : null;
  }, recorder);

test("records a pre-dispatch tile baseline and bounded masked lifecycle events", async ({
  page,
}) => {
  const recorder = await readFile(recorderPath, "utf8");
  await loadFixture(page);
  await page.evaluate(() => {
    const testWindow = window as Window & {
      copy?: (value: string) => void;
      __recorderCopiedJson?: string;
    };
    testWindow.copy = (value) => {
      testWindow.__recorderCopiedJson = value;
    };
  });
  const armed = await armRecorder(page, recorder);
  expect(armed).toEqual({
    state: "recording",
    baselineCandidateCount: 2,
    maxDurationMs: 300000,
  });
  await page.evaluate(() => {
    const handle = (
      window as Window & {
        __FLOW_P053_LIFECYCLE_RECORDER__: {
          markDispatchBoundary: () => number;
        };
      }
    ).__FLOW_P053_LIFECYCLE_RECORDER__;
    handle.markDispatchBoundary();

    const tiles = Array.from(document.querySelectorAll("flow-image-tile"));
    const firstImage = tiles[0]?.querySelector("img[data-media-id]");
    const secondImage = tiles[1]?.querySelector("img[data-media-id]");
    firstImage?.dispatchEvent(new Event("load"));

    for (const tile of tiles) {
      const loadingMarker = document.createElement("div");
      loadingMarker.setAttribute("data-state", "loading");
      tile.append(loadingMarker);
    }

    if (tiles[0]) {
      const duplicate = document.createElement("img");
      duplicate.setAttribute("data-media-id", "synthetic-media-one");
      tiles[0].append(duplicate);
      duplicate.dispatchEvent(new Event("error"));
    }
    secondImage?.setAttribute("data-media-id", "synthetic-media-three");

    const processing = document.createElement("div");
    processing.setAttribute("role", "progressbar");
    processing.setAttribute("data-state", "processing");
    tiles[1]?.append(processing);

    const replacement = document.createElement("img");
    replacement.setAttribute("data-media-id", "synthetic-media-one");
    firstImage?.replaceWith(replacement);
    replacement.dispatchEvent(new Event("load"));

    const container = document.querySelector("flow-tile-container");
    const addedTile = document.createElement("flow-image-tile");
    const addedImage = document.createElement("img");
    addedImage.setAttribute("data-media-id", "synthetic-media-four");
    addedTile.append(addedImage);
    container?.append(addedTile);
  });
  await page.waitForTimeout(50);
  await page.evaluate(() =>
    document.querySelectorAll("flow-image-tile")[1]?.remove(),
  );
  await page.waitForTimeout(50);
  const json = await page.evaluate(() => {
    const handle = (
      window as Window & {
        __FLOW_P053_LIFECYCLE_RECORDER__: { stop: () => string };
      }
    ).__FLOW_P053_LIFECYCLE_RECORDER__;
    return handle.stop();
  });
  const report = JSON.parse(json) as {
    stopReason: string;
    observerLoss: boolean;
    baseline: {
      captured: boolean;
      completeForScopedCandidates: boolean;
      mediaCandidates: Array<{ identityMask: string; naturalWidth: number }>;
      tileRelationships: Array<{
        mediaCandidates: Array<{ identityMask: string }>;
        lifecycleMarkers: Array<{ markerKind: string }>;
      }>;
    };
    preArmLifecycleHistoryCaptured: boolean;
    events: Array<{
      sequence: number;
      type: string;
      identityMask?: string;
      markerKind?: string;
      scope?: string;
      tileNode?: string | null;
      relationships?: Array<{
        tileNode: string;
        mediaCandidates: Array<{ identityMask: string }>;
        lifecycleMarkers: Array<{ markerKind: string }>;
      }>;
    }>;
    interpretationLimits: Record<string, boolean>;
    privacy: Record<string, boolean>;
  };
  const serialized = JSON.stringify(report);
  const copied = await page.evaluate(
    () =>
      (window as Window & { __recorderCopiedJson?: string })
        .__recorderCopiedJson ?? null,
  );
  const types = report.events.map((event) => event.type);

  expect(report.stopReason).toBe("stopped_by_user");
  expect(report.observerLoss).toBe(false);
  expect(report.baseline.captured).toBe(true);
  expect(report.baseline.completeForScopedCandidates).toBe(true);
  expect(report.preArmLifecycleHistoryCaptured).toBe(false);
  expect(report.baseline.mediaCandidates).toHaveLength(2);
  expect(report.baseline.mediaCandidates[0]?.identityMask).not.toBe(
    report.baseline.mediaCandidates[1]?.identityMask,
  );
  expect(report.baseline.tileRelationships).toHaveLength(2);
  expect(
    report.baseline.tileRelationships.every(
      (tile) => tile.mediaCandidates.length === 1,
    ),
  ).toBe(true);
  expect(
    report.baseline.tileRelationships.every(
      (tile) => tile.lifecycleMarkers.length === 0,
    ),
  ).toBe(true);
  expect(types[0]).toBe("baseline_captured_before_dispatch");
  expect(types).toContain("operator_marked_dispatch_boundary");
  expect(types).toContain("image_load_event");
  expect(types).toContain("image_error_event");
  expect(types).toContain("media_identity_changed");
  expect(types).toContain("same_mask_dom_replacement_observed");
  expect(types).toContain("repeated_identity_count_changed");
  expect(types).toContain("lifecycle_marker_added");
  expect(types).toContain("tile_scoped_relationships_observed");
  expect(types).toContain("tile_added");
  expect(types).toContain("tile_removed");
  const scopedMarkers = report.events.filter(
    (event) =>
      event.type === "lifecycle_marker_added" && event.scope === "tile",
  );
  expect(
    scopedMarkers.filter((event) => event.type === "lifecycle_marker_added"),
  ).toHaveLength(4);
  expect(
    report.events.filter(
      (event) =>
        event.type === "lifecycle_marker_added" &&
        event.markerKind === "loading" &&
        event.scope === "tile",
    ),
  ).toHaveLength(2);
  expect(scopedMarkers.every((event) => event.tileNode !== null)).toBe(true);
  const relationshipEvents = report.events.filter(
    (event) => event.type === "tile_scoped_relationships_observed",
  );
  expect(
    relationshipEvents.some((event) =>
      event.relationships?.some(
        (tile) =>
          tile.mediaCandidates.length > 0 && tile.lifecycleMarkers.length > 0,
      ),
    ),
  ).toBe(true);
  expect(
    report.events.every((event, index) => event.sequence === index + 1),
  ).toBe(true);
  expect(copied).toBe(json);
  expect(
    Object.values(report.interpretationLimits).every(
      (value) => value === false,
    ),
  ).toBe(true);
  expect(Object.values(report.privacy).every((value) => value === false)).toBe(
    true,
  );
  expect(serialized).not.toContain("synthetic-media-one");
  expect(serialized).not.toContain("synthetic-media-two");
  expect(serialized).not.toContain("synthetic-media-three");
  expect(serialized).not.toContain("private one");
  expect(serialized).not.toContain("synthetic prompt text");
  expect(serialized).not.toMatch(/https?:\/\//);
});

test("stops with an observer-loss gap when the selected project changes", async ({
  page,
}) => {
  const recorder = await readFile(recorderPath, "utf8");
  await loadFixture(page);
  await armRecorder(page, recorder);
  await page.evaluate(() =>
    history.pushState({}, "", "/project/other-project"),
  );
  await page.waitForFunction(() => {
    const windowWithRecorder = window as Window & {
      __FLOW_P053_LIFECYCLE_RECORDER__?: { state: string };
      __FLOW_P053_LIFECYCLE_RESULT__?: { stopReason: string };
    };
    return (
      windowWithRecorder.__FLOW_P053_LIFECYCLE_RECORDER__?.state ===
        "stopped" &&
      windowWithRecorder.__FLOW_P053_LIFECYCLE_RESULT__?.stopReason ===
        "project_or_document_binding_changed"
    );
  });
  const report = await page.evaluate(
    () =>
      (
        window as Window & {
          __FLOW_P053_LIFECYCLE_RESULT__: {
            observerLoss: boolean;
            captureGaps: Array<{ code: string }>;
            events: Array<{ type: string }>;
          };
        }
      ).__FLOW_P053_LIFECYCLE_RESULT__,
  );
  expect(report.observerLoss).toBe(true);
  expect(
    report.captureGaps.some(
      (gap) => gap.code === "selected_project_route_changed",
    ),
  ).toBe(true);
  expect(report.events.some((event) => event.type === "observer_lost")).toBe(
    true,
  );
});

test("records pagehide as observation loss instead of provider failure", async ({
  page,
}) => {
  const recorder = await readFile(recorderPath, "utf8");
  await loadFixture(page);
  await armRecorder(page, recorder);
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pagehide")),
  );
  const report = await page.evaluate(
    () =>
      (
        window as Window & {
          __FLOW_P053_LIFECYCLE_RESULT__: {
            stopReason: string;
            observerLoss: boolean;
            captureGaps: Array<{ code: string }>;
            interpretationLimits: Record<string, boolean>;
          };
        }
      ).__FLOW_P053_LIFECYCLE_RESULT__,
  );
  expect(report.stopReason).toBe("pagehide");
  expect(report.observerLoss).toBe(true);
  expect(
    report.captureGaps.some(
      (gap) => gap.code === "document_pagehide_observation_loss",
    ),
  ).toBe(true);
  expect(report.interpretationLimits.providerSuccessOrFailureInferred).toBe(
    false,
  );
});
