/* global indexedDB, crypto, TextEncoder, console, document, URL */
// Paste into DevTools Console for the packaged extension dashboard page.
// Checks that the existing database is present, aborts any upgrade event,
// and uses only readonly transactions. It emits no prompt bodies or raw URLs.
(async () => {
  const databaseName = "automat-faceless-app-v1";
  const workspaceId = "default"; // App.tsx supplies this to the Image tab.
  const attemptId = "54589885-74c8-4088-beeb-e41f7fda9341";
  const batchId = `import:${workspaceId}:image`;

  const projectMasks = new Map();
  const maskProject = (value) => {
    if (typeof value !== "string" || value.length === 0) return null;
    if (!projectMasks.has(value))
      projectMasks.set(value, `project-${projectMasks.size + 1}`);
    return projectMasks.get(value);
  };
  const sha256 = async (value) => {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  };
  const parseFlowProjectId = (canonicalTarget) => {
    if (typeof canonicalTarget !== "string") return null;
    try {
      const url = new URL(canonicalTarget);
      if (url.protocol !== "https:" || url.username || url.password)
        return null;
      if (url.hostname === "flow.google.com") {
        return (
          /^\/(?:u\/[0-9]+\/)?project\/([A-Za-z0-9_-]+)\/?$/.exec(
            url.pathname,
          )?.[1] ?? null
        );
      }
      if (url.hostname === "labs.google") {
        return (
          /^\/fx\/tools\/flow\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)?.[1] ??
          null
        );
      }
      return null;
    } catch {
      return null;
    }
  };
  const requestResult = (request) =>
    new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("idb_read_failed"));
    });
  const transactionDone = (transaction) =>
    new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("idb_transaction_failed"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("idb_transaction_aborted"));
    });
  const openExistingDatabase = async () => {
    if (typeof indexedDB.databases !== "function")
      return { status: "database_enumeration_unsupported" };
    const known = await indexedDB.databases();
    if (!known.some((entry) => entry.name === databaseName))
      return { status: "database_missing" };
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onupgradeneeded = () => {
        request.transaction?.abort();
        reject(new Error("database_upgrade_blocked_readonly"));
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("database_open_failed"));
      request.onblocked = () => reject(new Error("database_open_blocked"));
    });
    return { status: "opened_existing_readonly", database };
  };

  let opened;
  try {
    opened = await openExistingDatabase();
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          diagnostic: "flow-attempt-metadata-readonly-v1",
          status: "read_failed",
          reason:
            error instanceof Error && /^[a-z0-9_]{1,64}$/.test(error.message)
              ? error.message
              : "database_read_failed",
          noReadwriteTransactionOpened: true,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (opened.status !== "opened_existing_readonly") {
    console.log(
      JSON.stringify(
        {
          diagnostic: "flow-attempt-metadata-readonly-v1",
          status: opened.status,
          noReadwriteTransactionOpened: true,
        },
        null,
        2,
      ),
    );
    return;
  }

  const database = opened.database;
  try {
    const requiredStores = [
      "selectedTargets",
      "batches",
      "promptItems",
      "flowImageAttempts",
      "flowImagePromptSnapshots",
    ];
    const missingStores = requiredStores.filter(
      (name) => !database.objectStoreNames.contains(name),
    );
    if (missingStores.length > 0) {
      console.log(
        JSON.stringify(
          {
            diagnostic: "flow-attempt-metadata-readonly-v1",
            status: "schema_incomplete",
            missingStores,
            databaseVersion: database.version,
            noReadwriteTransactionOpened: true,
          },
          null,
          2,
        ),
      );
      return;
    }

    const transaction = database.transaction(requiredStores, "readonly");
    const selectedRequest = transaction
      .objectStore("selectedTargets")
      .get("Flow");
    const batchRequest = transaction.objectStore("batches").get(batchId);
    const attemptRequest = transaction
      .objectStore("flowImageAttempts")
      .get(attemptId);
    const itemsRequest = transaction
      .objectStore("promptItems")
      .index("batchId")
      .getAll(batchId);
    const transactionComplete = transactionDone(transaction);
    const [selected, batch, attempt, batchItems] = await Promise.all([
      requestResult(selectedRequest),
      requestResult(batchRequest),
      requestResult(attemptRequest),
      requestResult(itemsRequest),
    ]);
    const items = batch ? batchItems : [];
    await transactionComplete;

    const currentItem = items.length === 1 ? items[0] : null;
    const selectedProjectId = parseFlowProjectId(selected?.canonicalTarget);
    const currentProjectId = selectedProjectId;
    const currentSourceHash = currentItem
      ? await sha256(currentItem.rawJsonBody)
      : null;
    const editorElements = [
      document.getElementById("image-import-source"),
      document.getElementById("image-import-source-expanded"),
    ].filter((element) => element?.isConnected);
    const dashboardEditor =
      editorElements.length === 1 ? editorElements[0] : null;
    const dashboardEditorHash = dashboardEditor
      ? await sha256(dashboardEditor.value)
      : null;
    const savedBatchSourceHash = batch ? await sha256(batch.sourceText) : null;
    const dashboardEditorMatchesSavedBatch =
      dashboardEditorHash && savedBatchSourceHash
        ? dashboardEditorHash === savedBatchSourceHash
        : null;
    const expectedSnapshotId =
      currentItem && currentSourceHash
        ? `flow-image-source:${currentItem.id}:${currentSourceHash}`
        : null;

    const snapshotIds = [
      expectedSnapshotId,
      attempt?.sourceSnapshotId ?? null,
    ].filter((value, index, all) => value && all.indexOf(value) === index);
    const snapshotRecords = new Map();
    if (snapshotIds.length > 0) {
      const snapshotTx = database.transaction(
        ["flowImagePromptSnapshots"],
        "readonly",
      );
      const requests = snapshotIds.map((id) =>
        requestResult(
          snapshotTx.objectStore("flowImagePromptSnapshots").get(id),
        ),
      );
      const snapshotsTransactionComplete = transactionDone(snapshotTx);
      const records = await Promise.all(requests);
      await snapshotsTransactionComplete;
      snapshotIds.forEach((id, index) =>
        snapshotRecords.set(id, records[index]),
      );
    }

    const currentSnapshot = expectedSnapshotId
      ? snapshotRecords.get(expectedSnapshotId)
      : undefined;
    const attemptSnapshot = attempt?.sourceSnapshotId
      ? snapshotRecords.get(attempt.sourceSnapshotId)
      : undefined;
    const currentSnapshotBodyHash = currentSnapshot
      ? await sha256(currentSnapshot.rawJsonBody)
      : null;
    const attemptSnapshotBodyHash = attemptSnapshot
      ? await sha256(attemptSnapshot.rawJsonBody)
      : null;
    const blocking = attempt
      ? attempt.state !== "failed-before-dispatch"
      : null;
    const same = (left, right) =>
      left === null ||
      left === undefined ||
      right === null ||
      right === undefined
        ? null
        : left === right;

    const result = {
      diagnostic: "flow-attempt-metadata-readonly-v1",
      status: "complete",
      databaseVersion: database.version,
      transactionMode: "readonly",
      currentSelection: {
        workspaceId,
        workspaceSource: "dashboard_image_tab_fixed_default",
        selectedFlowTargetPresent: Boolean(selected),
        projectId: maskProject(currentProjectId),
        projectRouteRecognized: currentProjectId !== null,
        verification: selected?.verification ?? null,
      },
      savedImageSource: {
        batchPresent: Boolean(batch),
        batchWorkspaceId: batch?.workspaceId ?? null,
        batchId: batch?.id ?? null,
        itemCount: items.length,
        itemUniqueForOneShotHandler: items.length === 1,
        itemId: currentItem?.id ?? null,
        shotId: currentItem?.shotId ?? null,
        sourceHash: currentSourceHash,
        storedItemHash: currentItem?.contentHash ?? null,
        sourceHashMatchesStoredItemHash:
          currentSourceHash && currentItem
            ? currentSourceHash === currentItem.contentHash
            : null,
        expectedSnapshotId,
        snapshotRecordPresent: Boolean(currentSnapshot),
        snapshotWorkspaceId: currentSnapshot?.workspaceId ?? null,
        snapshotHash: currentSnapshot?.promptHash ?? null,
        snapshotBodyHashMatchesMetadata:
          currentSnapshotBodyHash && currentSnapshot
            ? currentSnapshotBodyHash === currentSnapshot.promptHash
            : null,
      },
      currentDashboardSource: {
        imageEditorCount: editorElements.length,
        uniqueImageEditorAvailable: dashboardEditor !== null,
        editorSourceHash: dashboardEditorHash,
        savedBatchSourceHash,
        editorMatchesSavedBatch: dashboardEditorMatchesSavedBatch,
        currentOneShotSourceIsSavedItem:
          items.length === 1 && dashboardEditorMatchesSavedBatch === true,
        editorReadbackNote:
          "Hash is computed from the dashboard textarea value; browser textarea line-ending serialization can affect exact equality.",
      },
      preservedAttempt: {
        requestedAttemptPresent: Boolean(attempt),
        attemptId,
        workspaceId: attempt?.workspaceId ?? null,
        projectId: maskProject(attempt?.projectId),
        itemId: attempt?.itemId ?? null,
        shotId: attempt?.shotId ?? null,
        sourceHash: attempt?.promptHash ?? null,
        snapshotId: attempt?.sourceSnapshotId ?? null,
        state: attempt?.state ?? null,
        blocksDuplicate: blocking,
        snapshotRecordPresent: Boolean(attemptSnapshot),
        snapshotWorkspaceId: attemptSnapshot?.workspaceId ?? null,
        snapshotItemId: attemptSnapshot?.itemId ?? null,
        snapshotHash: attemptSnapshot?.promptHash ?? null,
        snapshotBodyHashMatchesMetadata:
          attemptSnapshotBodyHash && attemptSnapshot
            ? attemptSnapshotBodyHash === attemptSnapshot.promptHash
            : null,
      },
      comparison: {
        sameWorkspace: same(workspaceId, attempt?.workspaceId),
        sameSelectedProject: same(currentProjectId, attempt?.projectId),
        sameBatch: same(batch?.id, attempt?.batchId),
        sameItem: same(currentItem?.id, attempt?.itemId),
        sameShot: same(currentItem?.shotId, attempt?.shotId),
        sameSourceHash: same(currentSourceHash, attempt?.promptHash),
        sameSnapshotId: same(expectedSnapshotId, attempt?.sourceSnapshotId),
        distinctSourceAtSameItem:
          currentItem && attempt
            ? currentItem.id === attempt.itemId &&
              currentSourceHash !== attempt.promptHash
            : null,
        shot02SavedAndCurrentInDashboard:
          currentItem && dashboardEditorMatchesSavedBatch !== null
            ? currentItem.shotId === "02" &&
              dashboardEditorMatchesSavedBatch === true
            : null,
        savedSourceIntegrityVerified:
          currentItem && currentSourceHash
            ? currentSourceHash === currentItem.contentHash
            : null,
        currentSnapshotMatchesSavedSource:
          currentSnapshot && currentItem && currentSourceHash
            ? currentSnapshot.workspaceId === workspaceId &&
              currentSnapshot.batchId === batch.id &&
              currentSnapshot.itemId === currentItem.id &&
              currentSnapshot.promptHash === currentSourceHash &&
              currentSnapshotBodyHash === currentSourceHash
            : null,
      },
      missingRecords: {
        selectedFlowTarget: !selected,
        recognizedSelectedProject: selected ? currentProjectId === null : null,
        savedImageBatch: !batch,
        uniqueSavedImageItem: items.length !== 1,
        preservedAttempt: !attempt,
        currentExpectedSnapshot: expectedSnapshotId ? !currentSnapshot : null,
        attemptSourceSnapshot: attempt?.sourceSnapshotId
          ? !attemptSnapshot
          : null,
      },
      privacy: {
        projectIdsMaskedConsistently: true,
        promptBodiesExcluded: true,
        accountIdentifiersExcluded: true,
        rawUrlsExcluded: true,
        storageWritesPerformed: false,
      },
    };
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          diagnostic: "flow-attempt-metadata-readonly-v1",
          status: "read_failed",
          reason:
            error instanceof Error && /^[a-z0-9_]{1,64}$/.test(error.message)
              ? error.message
              : "metadata_read_failed",
          noDatabaseWriteAttempted: true,
        },
        null,
        2,
      ),
    );
  } finally {
    database.close();
  }
})();
