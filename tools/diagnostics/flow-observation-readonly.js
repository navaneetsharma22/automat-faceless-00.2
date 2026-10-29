/* global indexedDB, crypto, TextEncoder, console, copy, window */
// Run in DevTools Console on this extension's packaged dashboard page.
// Set attemptId to the attempt ID shown by the dashboard after the test.
// This reads existing IndexedDB records only; it does not access provider tabs.
(() => {
  const databaseName = "automat-faceless-app-v1";
  const attemptId = "PASTE_ATTEMPT_ID_HERE";
  const resultName = "__FLOW_P053_OBSERVATION_INSPECTION__";
  const masks = new Map();
  const mask = (value, prefix) => {
    if (typeof value !== "string" || !value) return null;
    const key = `${prefix}:${value}`;
    if (!masks.has(key)) masks.set(key, `${prefix}-${masks.size + 1}`);
    return masks.get(key);
  };
  const sha256 = async (value) => {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value),
    );
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  };
  const requestResult = (request) =>
    new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("idb_read_failed"));
    });
  const txDone = (transaction) =>
    new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("idb_transaction_failed"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("idb_transaction_aborted"));
    });
  const openExisting = async () => {
    if (typeof indexedDB.databases !== "function")
      return { status: "database_enumeration_unsupported" };
    const databases = await indexedDB.databases();
    if (!databases.some((entry) => entry.name === databaseName))
      return { status: "database_missing" };
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onupgradeneeded = () => {
        request.transaction?.abort();
        reject(new Error("unexpected_database_upgrade"));
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("database_open_failed"));
      request.onblocked = () => reject(new Error("database_open_blocked"));
    });
    return { status: "opened_existing", database };
  };
  const summarizeAttempt = async (attempt) => {
    const confirmation = attempt.settingsConfirmation ?? {};
    const session = attempt.observationSession ?? null;
    const links = attempt.resultLinks ?? [];
    const observations = (attempt.structuralObservations ?? []).map(
      (event) => ({
        kind: event.kind,
        sequence: event.sequence,
        observationId: event.observationId,
        observedAt: event.observedAt,
        sourceBaselineFingerprint: event.sourceBaselineFingerprint,
        captureFingerprint: event.captureFingerprint,
        snapshot: {
          completeForRenderedScope: event.snapshot.completeForRenderedScope,
          virtualized: event.snapshot.virtualized,
          unidentifiedImageCount: event.snapshot.unidentifiedImageCount,
          identityCandidatesTruncated:
            event.snapshot.identityCandidatesTruncated,
          captureGaps: event.snapshot.captureGaps,
          tiles: event.snapshot.tiles,
          mediaCandidates: event.snapshot.mediaCandidates.map((media) => ({
            mediaToken: media.mediaToken,
            tileToken: media.tileToken,
            visible: media.visible,
            complete: media.complete,
            naturalWidth: media.naturalWidth,
            naturalHeight: media.naturalHeight,
            candidateHash: media.candidateId,
          })),
          identityCandidates: event.snapshot.identityCandidates.map(
            (candidate) => ({
              carrierToken: candidate.carrierToken,
              carrierTag: candidate.carrierTag,
              carrierRelation: candidate.carrierRelation,
              attributeName: candidate.attributeName,
              category: candidate.category,
              candidateHash: candidate.candidateId,
            }),
          ),
          lifecycleSignals: event.snapshot.lifecycleSignals,
          resourceEvents: event.snapshot.resourceEvents,
        },
      }),
    );
    return {
      attemptId: attempt.attemptId,
      state: attempt.state,
      workspaceId: attempt.workspaceId,
      batchId: attempt.batchId,
      itemId: attempt.itemId,
      shotId: attempt.shotId ?? null,
      sourceHash: attempt.promptHash,
      sourceCodeUnits: attempt.promptCodeUnits,
      sourceSnapshotId: attempt.sourceSnapshotId,
      settingsConfirmation: {
        confirmationId: confirmation.confirmationId ?? null,
        declaredVariantCount: confirmation.declaredVariantCount ?? null,
        declarationSource: confirmation.declaredVariantCount
          ? "user_attested_manual_settings_confirmation"
          : "absent",
        projectMatchesAttempt:
          confirmation.projectId === attempt.projectId &&
          confirmation.tabId === attempt.tabId,
      },
      binding: {
        provider: attempt.provider,
        projectMask: mask(attempt.projectId, "project"),
        selectedProjectMatchesConfirmation:
          confirmation.projectId === attempt.projectId,
        tabId: attempt.tabId,
        frameId: attempt.frameId,
        senderFrameId: attempt.senderFrameId ?? null,
        loaderIdMask: mask(attempt.loaderId, "loader"),
        browserDocumentMask: attempt.documentId
          ? await sha256(attempt.documentId)
          : null,
        buildId: attempt.buildId,
        protocolVersion: attempt.protocolVersion,
      },
      observationSession: session
        ? {
            sessionId: session.sessionId,
            status: session.status,
            profileSupport: session.profileSupport,
            startedAt: session.startedAt,
            deadlineAt: session.deadlineAt,
            maxEvents: session.maxEvents,
            lastSequence: session.lastSequence,
            reconciliationCount: session.reconciliationCount,
            armReceipt: session.armReceipt ?? null,
          }
        : null,
      attemptEvents: (attempt.events ?? []).map((event) => ({
        stage: event.stage,
        at: event.at,
        method: event.method,
        code: event.code ?? null,
      })),
      observationReceipts: (attempt.observationReceipts ?? []).map(
        (receipt) => ({
          sequence: receipt.sequence,
          observationId: receipt.observationId,
          fingerprint: receipt.fingerprint,
          receivedAt: receipt.receivedAt,
        }),
      ),
      structuralObservationCount: observations.length,
      structuralObservations: observations,
      resultLinkCount: links.length,
      resultOutcome: attempt.resultOutcome ?? null,
      privacy: {
        promptBodiesReadOrReturned: false,
        canonicalTargetOrRawUrlsReturned: false,
        rawProjectOrDocumentIdsReturned: false,
        rawProviderIdentityValuesReturned: false,
        accountDataOrCredentialsReturned: false,
        storageWritesPerformed: false,
      },
    };
  };

  void (async () => {
    let opened;
    try {
      opened = await openExisting();
    } catch (error) {
      window[resultName] = {
        diagnostic: "flow-observation-readonly-v1",
        status: "read_failed",
        reason:
          error instanceof Error && /^[a-z0-9_]{1,64}$/.test(error.message)
            ? error.message
            : "database_read_failed",
        storageWritesPerformed: false,
      };
      console.log(JSON.stringify(window[resultName], null, 2));
      return;
    }
    if (opened.status !== "opened_existing") {
      window[resultName] = {
        diagnostic: "flow-observation-readonly-v1",
        status: opened.status,
        storageWritesPerformed: false,
      };
      console.log(JSON.stringify(window[resultName], null, 2));
      return;
    }
    const database = opened.database;
    try {
      if (!database.objectStoreNames.contains("flowImageAttempts")) {
        window[resultName] = {
          diagnostic: "flow-observation-readonly-v1",
          status: "attempt_store_missing",
          databaseVersion: database.version,
          storageWritesPerformed: false,
        };
        console.log(JSON.stringify(window[resultName], null, 2));
        return;
      }
      const transaction = database.transaction(
        ["flowImageAttempts"],
        "readonly",
      );
      const done = txDone(transaction);
      const attempts = await requestResult(
        transaction.objectStore("flowImageAttempts").getAll(),
      );
      await done;
      const attempt = attempts.find((entry) => entry.attemptId === attemptId);
      if (!attempt) {
        window[resultName] = {
          diagnostic: "flow-observation-readonly-v1",
          status: "attempt_not_found",
          requestedAttemptId: attemptId,
          attemptCount: attempts.length,
          storageWritesPerformed: false,
        };
        console.log(JSON.stringify(window[resultName], null, 2));
        return;
      }
      const report = {
        diagnostic: "flow-observation-readonly-v1",
        status: "complete",
        databaseVersion: database.version,
        transactionMode: "readonly",
        attempt: await summarizeAttempt(attempt),
        privacy: {
          promptBodiesReadOrReturned: false,
          canonicalTargetsOrRawUrlsReturned: false,
          rawProjectOrDocumentIdsReturned: false,
          rawProviderIdentityValuesReturned: false,
          accountDataOrCredentialsReturned: false,
          storageWritesPerformed: false,
        },
      };
      window[resultName] = report;
      const json = JSON.stringify(report, null, 2);
      let copied = false;
      if (typeof copy === "function") {
        try {
          copy(json);
          copied = true;
        } catch {
          copied = false;
        }
      }
      console.log(
        JSON.stringify(
          {
            diagnostic: report.diagnostic,
            status: report.status,
            attemptId: attempt.attemptId,
            attemptState: attempt.state,
            sessionStatus: attempt.observationSession?.status ?? null,
            durableObservationCount:
              attempt.structuralObservations?.length ?? 0,
            receiptCount: attempt.observationReceipts?.length ?? 0,
            outcome: attempt.resultOutcome?.status ?? "unknown",
            outcomeReason: attempt.resultOutcome?.reason ?? null,
            namedResult: `window.${resultName}`,
            fullJsonCopiedToClipboard: copied,
            manualExportCommand: `copy(JSON.stringify(window.${resultName}, null, 2))`,
            transactionMode: "readonly",
            storageWritesPerformed: false,
          },
          null,
          2,
        ),
      );
      if (!copied) console.log(json);
    } catch (error) {
      window[resultName] = {
        diagnostic: "flow-observation-readonly-v1",
        status: "read_failed",
        reason:
          error instanceof Error && /^[a-z0-9_]{1,64}$/.test(error.message)
            ? error.message
            : "attempt_read_failed",
        storageWritesPerformed: false,
      };
      console.log(JSON.stringify(window[resultName], null, 2));
    } finally {
      database.close();
    }
  })();
})();
