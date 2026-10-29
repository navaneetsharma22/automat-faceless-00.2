/* global URL, queueMicrotask, TextEncoder, setTimeout, console */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, webcrypto } from "node:crypto";
import vm from "node:vm";

const diagnosticPath = new URL(
  "../flow-attempt-metadata-readonly.js",
  import.meta.url,
);
const diagnostic = await readFile(diagnosticPath, "utf8");
const hash = (value) =>
  createHash("sha256").update(value, "utf8").digest("hex");
const shot01 = '{"shot_id":"01","scene":"fixture source one"}';
const shot02 = '{"shot_id":"02","scene":"fixture source two"}';
const oldHash = hash(shot01);
const currentHash = hash(shot02);
const itemId = "import:default:image:item:0";
const oldSnapshotId = `flow-image-source:${itemId}:${oldHash}`;
const attemptId = "54589885-74c8-4088-beeb-e41f7fda9341";

const records = {
  selectedTargets: new Map([
    [
      "Flow",
      {
        provider: "Flow",
        canonicalTarget:
          "https://flow.google.com/u/204/project/project-fixture-01",
        verification: "verified",
      },
    ],
  ]),
  batches: new Map([
    [
      "import:default:image",
      {
        id: "import:default:image",
        workspaceId: "default",
        sourceText: "fixture source body must not be emitted",
      },
    ],
  ]),
  promptItems: [
    {
      id: itemId,
      batchId: "import:default:image",
      workspaceId: "default",
      shotId: "02",
      rawJsonBody: shot02,
      contentHash: currentHash,
    },
  ],
  flowImageAttempts: new Map([
    [
      attemptId,
      {
        attemptId,
        workspaceId: "default",
        batchId: "import:default:image",
        itemId,
        shotId: "01",
        promptHash: oldHash,
        sourceSnapshotId: oldSnapshotId,
        projectId: "project-fixture-01",
        state: "dispatched",
      },
    ],
  ]),
  flowImagePromptSnapshots: new Map([
    [
      oldSnapshotId,
      {
        snapshotId: oldSnapshotId,
        workspaceId: "default",
        batchId: "import:default:image",
        itemId,
        promptHash: oldHash,
        rawJsonBody: shot01,
      },
    ],
  ]),
};

class FixtureTransaction {
  constructor(names, mode) {
    assert.equal(mode, "readonly");
    assert(names.every((name) => name in records));
    this.pending = 0;
    this.completeQueued = false;
  }

  #request(read) {
    const request = {};
    this.pending += 1;
    queueMicrotask(() => {
      request.result = read();
      request.onsuccess?.();
      this.pending -= 1;
      if (this.pending === 0 && !this.completeQueued) {
        this.completeQueued = true;
        queueMicrotask(() => this.oncomplete?.());
      }
    });
    return request;
  }

  objectStore(name) {
    const table = records[name];
    return {
      get: (key) =>
        this.#request(() =>
          table instanceof Map ? table.get(key) : undefined,
        ),
      getAll: () =>
        this.#request(() => (Array.isArray(table) ? [...table] : [])),
      index: (indexName) => {
        assert.equal(indexName, "batchId");
        return {
          getAll: (batchId) =>
            this.#request(() =>
              table.filter((record) => record.batchId === batchId),
            ),
        };
      },
    };
  }
}

const database = {
  version: 5,
  objectStoreNames: {
    contains: (name) => name in records,
  },
  transaction: (names, mode) => new FixtureTransaction(names, mode),
  close: () => {},
};
const dashboardSourceText = '{"shot_id":"02","scene":"fixture source two"}';
records.batches.get("import:default:image").sourceText = dashboardSourceText;
const indexedDB = {
  databases: async () => [{ name: "automat-faceless-app-v1", version: 5 }],
  open: (name) => {
    assert.equal(name, "automat-faceless-app-v1");
    const request = {};
    queueMicrotask(() => {
      request.result = database;
      request.onsuccess?.();
    });
    return request;
  },
};

let output = "";
const sandbox = {
  indexedDB,
  crypto: webcrypto,
  TextEncoder,
  URL,
  document: {
    getElementById: (id) =>
      id === "image-import-source"
        ? { isConnected: true, value: dashboardSourceText }
        : null,
  },
  console: { log: (value) => (output = value) },
};
vm.runInNewContext(diagnostic, sandbox, {
  filename: "dashboard-diagnostic.js",
});
for (let turn = 0; !output && turn < 20; turn += 1)
  await new Promise((resolve) => setTimeout(resolve, 0));

const result = JSON.parse(output);
assert.equal(result.status, "complete");
assert.equal(result.currentSelection.projectId, "project-1");
assert.equal(result.preservedAttempt.projectId, "project-1");
assert.equal(result.savedImageSource.shotId, "02");
assert.equal(result.preservedAttempt.shotId, "01");
assert.equal(result.comparison.sameWorkspace, true);
assert.equal(result.comparison.sameSelectedProject, true);
assert.equal(result.comparison.sameItem, true);
assert.equal(result.comparison.sameShot, false);
assert.equal(result.comparison.sameSourceHash, false);
assert.equal(result.comparison.sameSnapshotId, false);
assert.equal(result.comparison.distinctSourceAtSameItem, true);
assert.equal(result.comparison.shot02SavedAndCurrentInDashboard, true);
assert.equal(result.currentDashboardSource.editorMatchesSavedBatch, true);
assert.equal(result.savedImageSource.snapshotRecordPresent, false);
assert.equal(result.preservedAttempt.snapshotRecordPresent, true);
assert.equal(result.preservedAttempt.blocksDuplicate, true);
assert.equal(result.privacy.storageWritesPerformed, false);
assert(!output.includes("fixture source two"));
assert(!output.includes("fixture source body must not be emitted"));
console.log(
  "Local fixture PASS: read-only diagnostic returned valid JSON; masked project equality, shot/hash/snapshot differences, missing current snapshot, preserved dispatched lock, and prompt-body exclusion verified.",
);
