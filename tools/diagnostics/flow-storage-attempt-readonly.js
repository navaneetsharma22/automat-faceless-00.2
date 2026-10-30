/* global indexedDB, crypto, TextEncoder, console */
// Paste into the extension dashboard DevTools console, not the Flow tab.
// Read-only IndexedDB inspection for one preserved Flow image attempt.
// Never prints prompt text, storage identifiers other than the supplied
// attempt ID, project/tab IDs, account data, URLs, or credentials.
(async () => {
  const attemptId = "daf9c731-23e3-4e3c-97d6-63a59d0caa01";
  const databases = await indexedDB.databases();
  if (
    !databases.some((database) => database.name === "automat-faceless-app-v1")
  ) {
    return {
      diagnostic: "flow-storage-attempt-readonly-v1",
      readOnly: true,
      databaseOpened: false,
      databasePresent: false,
      attemptRecordPresent: false,
      attemptId,
    };
  }
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("automat-faceless-app-v1");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("open_failed"));
  });

  try {
    const requiredStores = ["flowImageAttempts", "flowImagePromptSnapshots"];
    const missingStores = requiredStores.filter(
      (name) => !db.objectStoreNames.contains(name),
    );
    if (missingStores.length) {
      return {
        diagnostic: "flow-storage-attempt-readonly-v1",
        readOnly: true,
        databaseOpened: true,
        missingStores,
        attemptRecordPresent: false,
      };
    }

    const tx = db.transaction(requiredStores, "readonly");
    const transactionComplete = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error ?? new Error("readonly_tx_aborted"));
      tx.onerror = () => reject(tx.error ?? new Error("readonly_tx_failed"));
    });
    const attemptRequest = tx.objectStore("flowImageAttempts").get(attemptId);
    const attempt = await new Promise((resolve, reject) => {
      attemptRequest.onsuccess = () => resolve(attemptRequest.result);
      attemptRequest.onerror = () =>
        reject(attemptRequest.error ?? new Error("attempt_read_failed"));
    });

    let snapshot;
    if (attempt?.sourceSnapshotId) {
      const snapshotRequest = tx
        .objectStore("flowImagePromptSnapshots")
        .get(attempt.sourceSnapshotId);
      snapshot = await new Promise((resolve, reject) => {
        snapshotRequest.onsuccess = () => resolve(snapshotRequest.result);
        snapshotRequest.onerror = () =>
          reject(snapshotRequest.error ?? new Error("snapshot_read_failed"));
      });
    }
    await transactionComplete;

    if (!attempt) {
      return {
        diagnostic: "flow-storage-attempt-readonly-v1",
        readOnly: true,
        databaseOpened: true,
        readonlyTransactionCompleted: true,
        attemptRecordPresent: false,
        attemptId,
      };
    }

    const body =
      typeof snapshot?.rawJsonBody === "string"
        ? snapshot.rawJsonBody
        : undefined;
    const computedHash = body
      ? Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(body),
            ),
          ),
        )
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("")
      : undefined;
    const countBaseline = attempt.countBaseline;
    const countDecision = attempt.countDecision;
    const lastEvent = attempt.events?.at(-1);
    const bindingStatus = (applicable, matches) =>
      !applicable ? "not_applicable" : matches ? "match" : "mismatch";
    const hasCountBaseline = countBaseline !== undefined;
    const hasCountDecision = countDecision !== undefined;
    const hasResultBaseline = attempt.resultBaseline !== undefined;
    const declaration = attempt.resultBaseline?.variantDeclaration;

    return {
      diagnostic: "flow-storage-attempt-readonly-v1",
      readOnly: true,
      databaseOpened: true,
      readonlyTransactionCompleted: true,
      attemptId,
      attemptRecordPresent: true,
      state: attempt.state ?? null,
      failureStage: lastEvent?.stage ?? null,
      lastEventCode: lastEvent?.code ?? null,
      lastEventMethod: lastEvent?.method ?? null,
      eventTrail: Array.isArray(attempt.events)
        ? attempt.events.map(({ stage, code, method }) => ({
            stage: stage ?? null,
            code: code ?? null,
            method: method ?? null,
          }))
        : null,
      activationEvidence: {
        activationPairSent:
          attempt.events?.some(
            (event) => event.code === "activation_pair_sent",
          ) ?? false,
        dispatchIntentPersisted:
          attempt.events?.some(
            (event) => event.code === "dispatch_intent_persisted",
          ) ?? false,
      },
      prompt: {
        codeUnits: attempt.promptCodeUnits ?? null,
        utf8Bytes: attempt.promptUtf8Bytes ?? null,
        sourceSnapshotPresent: Boolean(snapshot),
        snapshotBindingStatus: bindingStatus(
          Boolean(snapshot),
          Boolean(
            snapshot &&
            snapshot.snapshotId === attempt.sourceSnapshotId &&
            snapshot.workspaceId === attempt.workspaceId &&
            snapshot.batchId === attempt.batchId &&
            snapshot.itemId === attempt.itemId &&
            snapshot.promptHash === attempt.promptHash &&
            snapshot.promptCodeUnits === attempt.promptCodeUnits &&
            snapshot.promptUtf8Bytes === attempt.promptUtf8Bytes,
          ),
        ),
        snapshotHashStatus: bindingStatus(
          Boolean(body),
          Boolean(computedHash && computedHash === attempt.promptHash),
        ),
        measuredBodyStatus: bindingStatus(
          Boolean(body),
          Boolean(
            body &&
            body.length === attempt.promptCodeUnits &&
            new TextEncoder().encode(body).byteLength ===
              attempt.promptUtf8Bytes,
          ),
        ),
      },
      declarationBindings: {
        declaredVariantCount:
          attempt.settingsConfirmation?.declaredVariantCount ?? null,
        resultBaselineDeclarationStatus: bindingStatus(
          hasResultBaseline,
          declaration?.status === "absent"
            ? attempt.settingsConfirmation?.declaredVariantCount === undefined
            : declaration?.count ===
                attempt.settingsConfirmation?.declaredVariantCount,
        ),
        countSessionBindingStatus: bindingStatus(
          hasCountBaseline || hasCountDecision,
          hasCountBaseline &&
            hasCountDecision &&
            attempt.countSessionId === countBaseline.countSessionId &&
            countDecision.countSessionId === countBaseline.countSessionId,
        ),
        countModeBindingStatus: bindingStatus(
          hasCountBaseline || hasCountDecision,
          hasCountBaseline &&
            hasCountDecision &&
            countDecision.mode === countBaseline.mode &&
            countDecision.startingImageCount ===
              countBaseline.startingImageCount,
        ),
        countProjectTabDocumentBuildProtocolStatus: bindingStatus(
          hasCountBaseline,
          Boolean(
            countBaseline &&
            countBaseline.projectId === attempt.projectId &&
            countBaseline.tabId === attempt.tabId &&
            countBaseline.documentId === attempt.documentId &&
            countBaseline.buildId === attempt.buildId &&
            countBaseline.protocolVersion === attempt.protocolVersion,
          ),
        ),
        countTargetBindingStatus: bindingStatus(
          hasCountBaseline,
          Boolean(
            countBaseline &&
            countBaseline.canonicalTarget ===
              attempt.settingsConfirmation?.canonicalTarget,
          ),
        ),
        expectedTotalMatches: !hasCountDecision
          ? "not_applicable"
          : countDecision.expectedTotal ===
              countDecision.startingImageCount +
                countDecision.expectedCumulativeAdditions
            ? "match"
            : "mismatch",
      },
      dispatch: {
        observationSessionPresent: Boolean(attempt.observationSession),
        countBaselinePresent: Boolean(countBaseline),
        countDecisionStatus: countDecision?.status ?? null,
        dispatchBoundaryPresent:
          countDecision?.dispatchBoundaryAt !== undefined,
      },
      build: {
        id: attempt.buildId ?? null,
        protocolVersion: attempt.protocolVersion ?? null,
      },
    };
  } finally {
    db.close();
  }
})()
  .then((report) => console.log(JSON.stringify(report, null, 2)))
  .catch((error) =>
    console.log(
      JSON.stringify(
        {
          diagnostic: "flow-storage-attempt-readonly-v1",
          readOnly: true,
          diagnosticErrorType:
            error instanceof Error ? error.name : "unknown_error",
          diagnosticErrorCode:
            error instanceof Error &&
            ["NotFoundError", "SecurityError", "InvalidStateError"].includes(
              error.name,
            )
              ? error.name
              : "diagnostic_failed",
        },
        null,
        2,
      ),
    ),
  );
