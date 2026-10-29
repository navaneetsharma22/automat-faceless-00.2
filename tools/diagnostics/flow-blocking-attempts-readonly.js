/* global indexedDB, crypto, TextEncoder, console, URL */
// Paste into DevTools Console on the packaged extension dashboard page.
// Reads only the existing extension database in readonly transactions. It
// never reads the dashboard's framework state or prints URLs or prompt bodies.
(async () => {
  const databaseName = "automat-faceless-app-v1";
  const workspaceId = "default"; // App.tsx supplies this to the Image tab.
  const expectedSourceHash =
    "bfed2a90b794a8b5de8e644a203d7a09ea73b999dc509808a7c9fbd6ee4301cb";
  const masks = new Map();
  const mask = (value, kind) => {
    if (typeof value !== "string" || !value) return null;
    const key = `${kind}:${value}`;
    if (!masks.has(key)) masks.set(key, `${kind}-${masks.size + 1}`);
    return masks.get(key);
  };
  const sha256 = async (value) => {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  };
  const parseProjectId = (canonicalTarget) => {
    if (typeof canonicalTarget !== "string") return null;
    try {
      const url = new URL(canonicalTarget);
      if (url.protocol !== "https:" || url.username || url.password)
        return null;
      if (url.hostname === "flow.google.com")
        return (
          /^\/(?:u\/[0-9]+\/)?project\/([A-Za-z0-9_-]+)\/?$/.exec(
            url.pathname,
          )?.[1] ?? null
        );
      if (url.hostname === "labs.google")
        return (
          /^\/fx\/tools\/flow\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)?.[1] ??
          null
        );
      return null;
    } catch {
      return null;
    }
  };
  const requestResult = (request) =>
    new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("readonly_request_failed"));
    });
  const transactionDone = (transaction) =>
    new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () =>
        reject(new Error("readonly_transaction_failed"));
      transaction.onabort = () =>
        reject(new Error("readonly_transaction_aborted"));
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
      request.onerror = () => reject(new Error("database_open_failed"));
      request.onblocked = () => reject(new Error("database_open_blocked"));
    });
    return { status: "opened_existing_readonly", database };
  };
  const emit = (value) => console.log(JSON.stringify(value, null, 2));

  let opened;
  try {
    opened = await openExistingDatabase();
  } catch (error) {
    emit({
      diagnostic: "flow-blocking-attempts-readonly-v1",
      status: "read_failed",
      reason:
        error instanceof Error && /^[a-z0-9_]{1,64}$/.test(error.message)
          ? error.message
          : "database_read_failed",
      noReadwriteTransactionOpened: true,
    });
    return;
  }
  if (opened.status !== "opened_existing_readonly") {
    emit({
      diagnostic: "flow-blocking-attempts-readonly-v1",
      status: opened.status,
      noReadwriteTransactionOpened: true,
    });
    return;
  }

  const database = opened.database;
  try {
    const stores = [
      "selectedTargets",
      "batches",
      "promptItems",
      "flowImageAttempts",
      "flowImagePromptSnapshots",
    ];
    const missingStores = stores.filter(
      (name) => !database.objectStoreNames.contains(name),
    );
    if (missingStores.length) {
      emit({
        diagnostic: "flow-blocking-attempts-readonly-v1",
        status: "schema_incomplete",
        missingStores,
        noReadwriteTransactionOpened: true,
      });
      return;
    }

    const batchId = `import:${workspaceId}:image`;
    const transaction = database.transaction(stores, "readonly");
    const selectedRequest = transaction
      .objectStore("selectedTargets")
      .get("Flow");
    const batchRequest = transaction.objectStore("batches").get(batchId);
    const itemsRequest = transaction
      .objectStore("promptItems")
      .index("batchId")
      .getAll(batchId);
    const attemptsRequest = transaction
      .objectStore("flowImageAttempts")
      .getAll();
    const done = transactionDone(transaction);
    const [selected, batch, batchItems, attempts] = await Promise.all([
      requestResult(selectedRequest),
      requestResult(batchRequest),
      requestResult(itemsRequest),
      requestResult(attemptsRequest),
    ]);
    await done;

    const items = batch ? batchItems : [];
    const item = items.length === 1 ? items[0] : null;
    const projectId = parseProjectId(selected?.canonicalTarget);
    const sourceHash = item ? await sha256(item.rawJsonBody) : null;
    const expectedSnapshotId =
      item && sourceHash ? `flow-image-source:${item.id}:${sourceHash}` : null;
    const blockingRows =
      item && sourceHash
        ? attempts.filter(
            (attempt) =>
              attempt.state !== "failed-before-dispatch" &&
              attempt.itemId === item.id &&
              attempt.promptHash === sourceHash,
          )
        : [];
    const snapshotIds = [
      expectedSnapshotId,
      ...blockingRows.map((attempt) => attempt.sourceSnapshotId),
    ].filter((value, index, all) => value && all.indexOf(value) === index);
    const snapshotTransaction = snapshotIds.length
      ? database.transaction(["flowImagePromptSnapshots"], "readonly")
      : null;
    const snapshotRequests = snapshotTransaction
      ? snapshotIds.map((id) =>
          requestResult(
            snapshotTransaction.objectStore("flowImagePromptSnapshots").get(id),
          ),
        )
      : [];
    const snapshotDone = snapshotTransaction
      ? transactionDone(snapshotTransaction)
      : Promise.resolve();
    const snapshots = await Promise.all(snapshotRequests);
    await snapshotDone;
    const snapshotById = new Map(
      snapshotIds.map((id, index) => [id, snapshots[index]]),
    );
    const expectedSnapshot = expectedSnapshotId
      ? snapshotById.get(expectedSnapshotId)
      : null;
    const expectedSnapshotBodyHash = expectedSnapshot
      ? await sha256(expectedSnapshot.rawJsonBody)
      : null;
    const blockingAttemptReports = await Promise.all(
      blockingRows.map(async (attempt) => {
        const attemptSnapshot = snapshotById.get(attempt.sourceSnapshotId);
        const attemptSnapshotBodyHash = attemptSnapshot
          ? await sha256(attemptSnapshot.rawJsonBody)
          : null;
        return {
          attemptId: attempt.attemptId,
          state: attempt.state,
          blocksByRepositoryPredicate: true,
          repositoryPredicate:
            "state_not_failed_before_dispatch_and_same_itemId_and_promptHash",
          workspaceId: attempt.workspaceId ?? null,
          sameWorkspace: attempt.workspaceId === workspaceId,
          batchIdMask: mask(attempt.batchId, "batch"),
          sameBatch: attempt.batchId === batchId,
          itemIdMask: mask(attempt.itemId, "item"),
          sameItem: attempt.itemId === item.id,
          shotId: attempt.shotId ?? null,
          sameShot: attempt.shotId === item.shotId,
          projectMask: mask(attempt.projectId, "project"),
          sameSelectedProject:
            projectId && attempt.projectId
              ? projectId === attempt.projectId
              : null,
          sourceHash: attempt.promptHash ?? null,
          sameSourceHash: attempt.promptHash === sourceHash,
          activeKeyMatchesExpected:
            attempt.activeKey === `flow-image:${item.id}:${sourceHash}`,
          snapshotIdPresent: Boolean(attempt.sourceSnapshotId),
          sameSnapshotId: attempt.sourceSnapshotId === expectedSnapshotId,
          snapshotRecordPresent: Boolean(attemptSnapshot),
          snapshotWorkspaceMatches:
            attemptSnapshot?.workspaceId === attempt.workspaceId,
          snapshotItemMatches: attemptSnapshot?.itemId === attempt.itemId,
          snapshotHashMatches:
            attemptSnapshot?.promptHash === attempt.promptHash,
          snapshotBodyHashMatchesMetadata:
            attemptSnapshotBodyHash && attemptSnapshot
              ? attemptSnapshotBodyHash === attemptSnapshot.promptHash
              : null,
          confirmationKeyMask: mask(attempt.confirmationKey, "confirmation"),
          declaredVariantCount:
            attempt.settingsConfirmation?.declaredVariantCount ?? null,
          attemptCreatedAt: attempt.createdAt ?? null,
          attemptUpdatedAt: attempt.updatedAt ?? null,
        };
      }),
    );
    emit({
      diagnostic: "flow-blocking-attempts-readonly-v1",
      status: "complete",
      transactionMode: "readonly",
      currentSelection: {
        workspaceId,
        selectedFlowTargetPresent: Boolean(selected),
        projectRecognized: projectId !== null,
        projectMask: mask(projectId, "project"),
        selectedTabId: selected?.tabId ?? null,
      },
      currentSavedImageSource: {
        batchPresent: Boolean(batch),
        batchWorkspaceId: batch?.workspaceId ?? null,
        batchIdMask: mask(batch?.id, "batch"),
        itemCount: items.length,
        uniqueItem: item !== null,
        itemIdMask: mask(item?.id, "item"),
        shotId: item?.shotId ?? null,
        sourceHash,
        suppliedHashMatches: sourceHash === expectedSourceHash,
        storedItemHash: item?.contentHash ?? null,
        sourceHashMatchesStoredItemHash:
          item && sourceHash ? sourceHash === item.contentHash : null,
        expectedSnapshotIdPresent: Boolean(expectedSnapshotId),
        expectedSnapshotRecordPresent: Boolean(expectedSnapshot),
        expectedSnapshotWorkspaceMatches:
          expectedSnapshot?.workspaceId === workspaceId,
        expectedSnapshotItemMatches: expectedSnapshot?.itemId === item?.id,
        expectedSnapshotHashMatches:
          expectedSnapshot?.promptHash === sourceHash,
        expectedSnapshotBodyHashMatches:
          expectedSnapshotBodyHash && expectedSnapshot
            ? expectedSnapshotBodyHash === expectedSnapshot.promptHash
            : null,
      },
      lockComparison: {
        totalAttemptRecords: attempts.length,
        blockingSourceMatchCount: blockingRows.length,
        matchingBlockingAttempts: blockingAttemptReports,
        failedBeforeDispatchSameSourceCount:
          item && sourceHash
            ? attempts.filter(
                (attempt) =>
                  attempt.state === "failed-before-dispatch" &&
                  attempt.itemId === item.id &&
                  attempt.promptHash === sourceHash,
              ).length
            : null,
        confirmationComparison: {
          currentInMemoryConfirmationIdAvailableWithoutFrameworkState: false,
          existingAttemptConfirmationKeysAreReportLocalMasks: true,
          exactCurrentConfirmationReuseComparison:
            "unavailable_from_public_dashboard_surface",
          sourceAttemptLockWasCheckedBeforeConfirmationReuse: true,
          note: "The dashboard keeps the current confirmation in React state; this diagnostic does not inspect framework-private state.",
        },
      },
      missingRecords: {
        selectedFlowTarget: !selected,
        recognizedSelectedProject: selected ? projectId === null : null,
        savedImageBatch: !batch,
        uniqueSavedImageItem: items.length !== 1,
        expectedSourceSnapshot: expectedSnapshotId ? !expectedSnapshot : null,
      },
      privacy: {
        projectIdsMaskedConsistently: true,
        itemAndBatchIdsMaskedConsistently: true,
        confirmationIdsMaskedConsistently: true,
        promptBodiesExcluded: true,
        canonicalTargetsAndRawUrlsExcluded: true,
        accountDataOrCredentialsExcluded: true,
        frameworkPrivateStateAccessed: false,
        storageWritesPerformed: false,
      },
    });
  } catch (error) {
    emit({
      diagnostic: "flow-blocking-attempts-readonly-v1",
      status: "read_failed",
      reason:
        error instanceof Error && /^[a-z0-9_]{1,64}$/.test(error.message)
          ? error.message
          : "metadata_read_failed",
      noDatabaseWriteAttempted: true,
    });
  } finally {
    database.close();
  }
})();
