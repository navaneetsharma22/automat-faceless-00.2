/* global indexedDB, crypto, TextEncoder, console, window, chrome, performance, copy, setTimeout, clearTimeout, URL, fetch, location */
// Paste once into the extension dashboard DevTools Console. This performs
// repeated read-only binding checks against the explicitly selected Flow tab.
// It never arms an observer, consumes confirmation, writes IndexedDB, or sends
// input to the provider. It attaches the debugger only when no producer or
// debugger is active, and detaches only the session it attached itself.
(() => {
  const databaseName = "automat-faceless-app-v1";
  const requestedAttemptId = "86e721b7-7cc9-4c1d-a476-f2fc2d30f9ec";
  const reportName = "__FLOW_BINDING_HEALTH_READONLY_REPORT__";
  const stores = [
    "flowImageAttempts",
    "flowImagePromptSnapshots",
    "selectedTargets",
  ];
  const runDurationMs = 50_000;
  const samplingWindowMs = 45_000;
  const operationTimeoutMs = 4_000;
  const sampleIntervalMs = 1_000;
  const maxSamples = 60;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const idHash = async (value) => {
    if (typeof value !== "string" || value.length === 0) return null;
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value),
    );
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    )
      .join("")
      .slice(0, 12);
  };
  const safeErrorClass = (error) => {
    const name = error instanceof Error ? error.name : "unknown";
    const classes = {
      Error: "error",
      TypeError: "type_error",
      ReferenceError: "reference_error",
      SecurityError: "security_error",
      NotAllowedError: "not_allowed_error",
      AbortError: "abort_error",
      TimeoutError: "timeout_error",
      UnknownError: "unknown_error",
    };
    return classes[name] ?? "other_error";
  };
  const projectFromUrl = (value) => {
    try {
      const url = new URL(value);
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
      request.onerror = () =>
        reject(request.error ?? new Error("idb_read_failed"));
    });
  const transactionDone = (transaction) =>
    new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("idb_transaction_failed"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("idb_transaction_aborted"));
    });
  const timeout = (promise, ms) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error("operation_timeout");
        error.name = "TimeoutError";
        reject(error);
      }, ms);
      Promise.resolve(promise).then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  const openDatabaseReadOnly = async () => {
    const names = await indexedDB.databases();
    if (!names.some((entry) => entry.name === databaseName))
      throw new Error("database_missing");
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onupgradeneeded = () => {
        request.transaction?.abort();
        reject(new Error("unexpected_database_upgrade"));
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("open_failed"));
      request.onblocked = () => reject(new Error("database_open_blocked"));
    });
  };

  if (window[reportName]?.status === "running") {
    console.log("flow_binding_health_already_running");
    return;
  }

  void (async () => {
    const report = {
      diagnostic: "flow-binding-health-readonly-v1",
      status: "running",
      diagnosticSessionId: crypto.randomUUID(),
      attemptMask: null,
      durationLimitMs: runDurationMs,
      samplingWindowMs,
      operationTimeoutMs,
      maxConcurrentOperationChains: 1,
      startedAt: Date.now(),
      completedAt: null,
      elapsedMs: 0,
      extensionBuildId: null,
      selectedTargetBinding: null,
      attemptBinding: null,
      sourceValidation: null,
      debuggerOwnership: {
        initialState: "not_checked",
        diagnosticAttachedSession: false,
        detachPerformed: false,
      },
      samples: [],
      continuity: {
        selectedTabStable: null,
        projectStable: null,
        browserDocumentStable: null,
        loaderStable: null,
        sampleCount: 0,
      },
      limitations: [
        "This read-only health run is diagnostic evidence only; it does not prove the historical exception cause or live generation acceptance.",
        "IDs are SHA-256 prefixes; URLs, titles, prompt bodies, raw IDs, account data, and error messages are not exported.",
        "If another debugger or active producer owns the selected tab, Page.getFrameTree is skipped rather than disturbing that owner.",
      ],
      privacy: {
        indexedDbMode: "readonly",
        indexedDbWrites: false,
        providerInputSent: false,
        observerArmedOrResumed: false,
        dispatchIntentCreated: false,
        settingsConfirmationConsumed: false,
        attemptOrOutcomeChanged: false,
        lockChanged: false,
        providerNavigationRequested: false,
        rawSensitiveValuesReturned: false,
      },
    };
    window[reportName] = report;
    let database;
    let ownedDebuggerSession = false;
    let finished = false;
    let selectedTabId;
    let initialSnapshot;
    const startedClock = performance.now();
    const finishDeadline = startedClock + runDurationMs;
    const samplingDeadline = startedClock + samplingWindowMs;
    const continuity = new Map();
    const recordOperation = async (sample, operation, task) => {
      const startedAt = Date.now();
      const timerStart = performance.now();
      const remainingMs = Math.max(1, finishDeadline - performance.now());
      try {
        const value = await timeout(
          Promise.resolve().then(task),
          Math.min(operationTimeoutMs, remainingMs),
        );
        sample.operations.push({
          operation,
          status: "ok",
          code: "ok",
          startedAt,
          elapsedMs: Math.round(performance.now() - timerStart),
        });
        keepSample(sample);
        return { ok: true, value };
      } catch (error) {
        sample.operations.push({
          operation,
          status: "failed",
          code: `${operation}_${safeErrorClass(error)}`,
          startedAt,
          elapsedMs: Math.round(performance.now() - timerStart),
        });
        keepSample(sample);
        if (safeErrorClass(error) === "timeout_error") {
          const stopped = new Error("health_operation_timeout");
          stopped.name = "HealthOperationTimeout";
          throw stopped;
        }
        return { ok: false, value: undefined };
      }
    };
    const publish = () => {
      report.elapsedMs = Math.round(performance.now() - startedClock);
      report.continuity.sampleCount = report.samples.length;
      window[reportName] = report;
    };
    const keepSample = (sample) => {
      if (!report.samples.includes(sample)) report.samples.push(sample);
      publish();
    };
    const readStorage = async (includeAttemptInventory = false) => {
      const readStores = includeAttemptInventory
        ? stores
        : ["flowImageAttempts", "selectedTargets"];
      const tx = database.transaction(readStores, "readonly");
      const done = transactionDone(tx);
      const [attemptData, targetData] = await Promise.all([
        requestResult(
          includeAttemptInventory
            ? tx.objectStore("flowImageAttempts").getAll()
            : tx.objectStore("flowImageAttempts").get(requestedAttemptId),
        ),
        requestResult(
          includeAttemptInventory
            ? tx.objectStore("selectedTargets").getAll()
            : tx.objectStore("selectedTargets").get("Flow"),
        ),
      ]);
      await done;
      const attempts = includeAttemptInventory ? attemptData : [];
      const attempt = includeAttemptInventory
        ? attempts.find((entry) => entry.attemptId === requestedAttemptId)
        : attemptData;
      const selectedTarget = includeAttemptInventory
        ? targetData.find((entry) => entry.provider === "Flow")
        : targetData;
      let snapshot;
      if (attempt) {
        const snapshotTx = database.transaction(
          "flowImagePromptSnapshots",
          "readonly",
        );
        const snapshotDone = transactionDone(snapshotTx);
        snapshot = await requestResult(
          snapshotTx
            .objectStore("flowImagePromptSnapshots")
            .get(attempt.sourceSnapshotId),
        );
        await snapshotDone;
      }
      return {
        attempt,
        selectedTarget,
        snapshot,
        activeProducerOnSelectedTab: Boolean(
          selectedTarget &&
          (attempts.some(
            (entry) =>
              entry.tabId === selectedTarget.tabId &&
              entry.observationSession?.status === "active" &&
              ["dispatch-intent", "dispatched", "uncertain"].includes(
                entry.state,
              ),
          ) ||
            (!includeAttemptInventory &&
              attempt?.tabId === selectedTarget.tabId &&
              attempt.observationSession?.status === "active")),
        ),
      };
    };
    const validateSnapshot = async (attempt, snapshot) => {
      if (!attempt || !snapshot) return "snapshot_missing";
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(snapshot.rawJsonBody),
      );
      const hash = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      const schemaShapeValid =
        typeof snapshot.rawJsonBody === "string" &&
        snapshot.snapshotId === attempt.sourceSnapshotId &&
        snapshot.workspaceId === attempt.workspaceId &&
        snapshot.batchId === attempt.batchId &&
        snapshot.itemId === attempt.itemId &&
        snapshot.promptHash === attempt.promptHash &&
        snapshot.promptCodeUnits === attempt.promptCodeUnits &&
        snapshot.promptUtf8Bytes === attempt.promptUtf8Bytes;
      return schemaShapeValid && hash === attempt.promptHash
        ? "match"
        : "mismatch";
    };
    const readPackagedBuildId = async () => {
      const response = await fetch(chrome.runtime.getURL("background.js"));
      if (!response.ok) throw new Error("packaged_build_read_failed");
      const body = await response.text();
      const ids = [
        ...new Set(body.match(/automat-faceless-0\.1\.0-[a-z0-9-]+/g) ?? []),
      ];
      return ids.length === 1 ? ids[0] : null;
    };

    try {
      database = await openDatabaseReadOnly();
      const firstSample = { index: 1, at: Date.now(), operations: [] };
      const packageBuild = await recordOperation(
        firstSample,
        "packaged_extension_build_read",
        readPackagedBuildId,
      );
      report.extensionBuildId = packageBuild.ok ? packageBuild.value : null;
      const storageRead = await recordOperation(
        firstSample,
        "repository_initial_read",
        () => readStorage(true),
      );
      if (!storageRead.ok) throw new Error("initial_repository_read_failed");
      initialSnapshot = storageRead.value;
      const { attempt, selectedTarget, snapshot } = initialSnapshot;
      if (!attempt) throw new Error("requested_attempt_missing");
      if (!selectedTarget) throw new Error("flow_target_not_selected");
      report.attemptMask = await idHash(requestedAttemptId);
      selectedTabId = selectedTarget.tabId;
      const selectedProject = projectFromUrl(selectedTarget.canonicalTarget);
      report.selectedTargetBinding = {
        provider: selectedTarget.provider,
        tabIdMask: await idHash(String(selectedTarget.tabId)),
        projectMask: await idHash(selectedProject),
        attemptTabMatches: selectedTarget.tabId === attempt.tabId,
        selectedProjectMatchesAttempt: selectedProject === attempt.projectId,
        selectedCanonicalTargetMatchesAttempt:
          selectedTarget.canonicalTarget ===
          attempt.settingsConfirmation?.canonicalTarget,
        verification: selectedTarget.verification,
        connectionState: selectedTarget.connectionState ?? null,
        savedVerificationBinding: selectedTarget.verificationBinding
          ? {
              tabMatchesAttempt:
                selectedTarget.verificationBinding.tabId === attempt.tabId,
              projectMatchesAttempt:
                selectedTarget.verificationBinding.projectId ===
                attempt.projectId,
              documentMatchesAttempt:
                selectedTarget.verificationBinding.documentId ===
                attempt.documentId,
              extensionBuildMatchesAttempt:
                selectedTarget.verificationBinding.extensionBuildId ===
                attempt.buildId,
              connectorBuildMatchesAttempt:
                selectedTarget.verificationBinding.connectorBuildId ===
                attempt.buildId,
            }
          : null,
      };
      report.attemptBinding = {
        projectMask: await idHash(attempt.projectId),
        tabIdMask: await idHash(String(attempt.tabId)),
        frameIdMask: await idHash(attempt.frameId),
        loaderIdMask: await idHash(attempt.loaderId),
        documentMask: await idHash(attempt.documentId),
        senderFrameId: attempt.senderFrameId ?? null,
        buildId: attempt.buildId,
        extensionBuildMatchesAttempt:
          report.extensionBuildId === attempt.buildId,
        protocolVersion: attempt.protocolVersion,
        observationSessionStatus:
          attempt.observationSession?.status ?? "missing",
      };
      report.sourceValidation = {
        snapshotPresent: Boolean(snapshot),
        initialStatus: null,
        sourceHash: attempt.promptHash,
        rawPromptReturned: false,
      };
      const sourceValidation = await recordOperation(
        firstSample,
        "source_snapshot_hash_validation",
        () => validateSnapshot(attempt, snapshot),
      );
      report.sourceValidation.initialStatus = sourceValidation.ok
        ? sourceValidation.value
        : "validation_operation_failed";
      firstSample.bindings = {
        selectedTabMatchesAttempt: selectedTarget.tabId === attempt.tabId,
        selectedProjectMatchesAttempt: selectedProject === attempt.projectId,
        selectedCanonicalTargetMatchesAttempt:
          selectedTarget.canonicalTarget ===
          attempt.settingsConfirmation?.canonicalTarget,
      };
      keepSample(firstSample);

      if (selectedTarget.tabId !== attempt.tabId)
        throw new Error("selected_tab_does_not_match_attempt");
      if (
        selectedTarget.canonicalTarget !==
        attempt.settingsConfirmation?.canonicalTarget
      )
        throw new Error("selected_project_does_not_match_attempt");

      const targetsResult = await recordOperation(
        firstSample,
        "debugger_ownership_read",
        () => chrome.debugger.getTargets(),
      );
      if (!targetsResult.ok) throw new Error("debugger_ownership_read_failed");
      const targets = targetsResult.value;
      const existingAttachment = targets.some(
        (entry) => entry.tabId === selectedTabId && entry.attached,
      );
      if (initialSnapshot.activeProducerOnSelectedTab) {
        report.debuggerOwnership.initialState =
          "active_producer_present_attach_skipped";
      } else if (existingAttachment) {
        report.debuggerOwnership.initialState =
          "debugger_already_attached_attach_skipped";
      } else {
        const attach = await recordOperation(
          firstSample,
          "diagnostic_owned_debugger_attach",
          async () => {
            const attachPromise = chrome.debugger.attach(
              { tabId: selectedTabId },
              "1.3",
            );
            void attachPromise.then(() => {
              if (finished && selectedTabId !== undefined)
                void chrome.debugger
                  .detach({ tabId: selectedTabId })
                  .catch(() => undefined);
            });
            await attachPromise;
            ownedDebuggerSession = true;
            return true;
          },
        );
        if (attach.ok) {
          report.debuggerOwnership.initialState = "diagnostic_owned_attachment";
          report.debuggerOwnership.diagnosticAttachedSession = true;
        } else {
          const failedOperation = firstSample.operations.at(-1);
          report.debuggerOwnership.initialState = `attach_refused_${failedOperation?.code ?? "unknown_error"}`;
        }
      }
      publish();

      while (
        performance.now() < samplingDeadline &&
        report.samples.length < maxSamples
      ) {
        const sample = {
          index: report.samples.length + 1,
          at: Date.now(),
          operations: [],
        };
        const repo = await recordOperation(
          sample,
          "repository_binding_and_source_read",
          () => readStorage(false),
        );
        const current = repo.ok ? repo.value : undefined;
        const currentAttempt = current?.attempt;
        const currentTarget = current?.selectedTarget;
        const currentSnapshot = current?.snapshot;
        sample.bindings = {
          selectedTargetPresent: Boolean(currentTarget),
          selectedTabMatchesInitial: currentTarget?.tabId === selectedTabId,
          selectedTargetMatchesAttempt:
            currentTarget?.tabId === currentAttempt?.tabId &&
            currentTarget?.canonicalTarget ===
              currentAttempt?.settingsConfirmation?.canonicalTarget,
          projectMatchesAttempt:
            projectFromUrl(currentTarget?.canonicalTarget ?? "") ===
            currentAttempt?.projectId,
          activeProducerOnSelectedTab:
            current?.activeProducerOnSelectedTab ?? null,
        };
        const sourceValidation = await recordOperation(
          sample,
          "source_snapshot_hash_validation",
          () => validateSnapshot(currentAttempt, currentSnapshot),
        );
        sample.bindings.sourceSnapshotStatus = sourceValidation.ok
          ? sourceValidation.value
          : "validation_operation_failed";

        if (currentTarget?.tabId === selectedTabId) {
          const tab = await recordOperation(sample, "browser_tab_read", () =>
            chrome.tabs.get(selectedTabId),
          );
          if (tab.ok) {
            const liveProject = projectFromUrl(tab.value.url ?? "");
            sample.liveTab = {
              tabIdMatchesSelected: tab.value.id === selectedTabId,
              selectedProjectMatchesLive:
                liveProject === projectFromUrl(currentTarget.canonicalTarget),
              liveProjectMatchesAttempt:
                liveProject === currentAttempt?.projectId,
              projectMask: await idHash(liveProject),
            };
          }

          const activeProducer = current?.activeProducerOnSelectedTab ?? true;
          if (ownedDebuggerSession && activeProducer) {
            try {
              await chrome.debugger.detach({ tabId: selectedTabId });
              ownedDebuggerSession = false;
              report.debuggerOwnership.detachPerformed = true;
              report.debuggerOwnership.initialState =
                "diagnostic_attachment_released_for_active_producer";
            } catch {
              sample.operations.push({
                operation: "diagnostic_owned_debugger_release",
                status: "failed",
                code: "diagnostic_owned_debugger_release_error",
                startedAt: Date.now(),
                elapsedMs: null,
              });
            }
          }
          if (ownedDebuggerSession && !activeProducer) {
            const ownership = await recordOperation(
              sample,
              "diagnostic_debugger_ownership_read",
              () => chrome.debugger.getTargets(),
            );
            if (
              ownership.ok &&
              !ownership.value.some(
                (entry) => entry.tabId === selectedTabId && entry.attached,
              )
            ) {
              ownedDebuggerSession = false;
              report.debuggerOwnership.initialState =
                "diagnostic_attachment_lost";
            }
          }
          if (ownedDebuggerSession && !activeProducer) {
            const frame = await recordOperation(
              sample,
              "debugger_page_get_frame_tree",
              () =>
                chrome.debugger.sendCommand(
                  { tabId: selectedTabId },
                  "Page.getFrameTree",
                ),
            );
            if (frame.ok) {
              const root = frame.value?.frameTree?.frame;
              sample.cdpFrame = {
                framePresent: Boolean(root),
                frameIdMask: await idHash(root?.id),
                loaderIdMask: await idHash(root?.loaderId),
                frameIdMatchesAttempt: root?.id === currentAttempt?.frameId,
                loaderIdMatchesAttempt:
                  root?.loaderId === currentAttempt?.loaderId,
                projectMatchesAttempt:
                  projectFromUrl(root?.url ?? "") === currentAttempt?.projectId,
              };
            }
          } else {
            sample.operations.push({
              operation: "debugger_page_get_frame_tree",
              status: "skipped",
              code: activeProducer
                ? "active_producer_owns_tab"
                : existingAttachment
                  ? "debugger_owned_elsewhere"
                  : "debugger_not_owned_by_diagnostic",
              startedAt: Date.now(),
              elapsedMs: 0,
            });
          }

          const document = await recordOperation(
            sample,
            "scripting_document_id_inspection",
            async () => {
              const results = await chrome.scripting.executeScript({
                target: { tabId: selectedTabId, frameIds: [0] },
                func: () => location.href,
              });
              return results[0];
            },
          );
          if (document.ok) {
            const value = document.value;
            const documentMask = await idHash(value.documentId);
            sample.browserDocument = {
              documentMask,
              frameId: value.frameId,
              documentIdMatchesAttempt:
                value.documentId === currentAttempt?.documentId,
              frameIdMatchesAttempt:
                value.frameId === currentAttempt?.senderFrameId,
              projectMatchesAttempt:
                projectFromUrl(value.result ?? "") ===
                currentAttempt?.projectId,
            };
            if (!continuity.has("document"))
              continuity.set("document", documentMask);
            if (!continuity.has("loader"))
              continuity.set("loader", sample.cdpFrame?.loaderIdMask ?? null);
            if (!continuity.has("project"))
              continuity.set("project", sample.liveTab?.projectMask ?? null);
            if (!continuity.has("tab")) continuity.set("tab", selectedTabId);
            sample.continuity = {
              documentMatchesFirst: continuity.get("document") === documentMask,
              loaderMatchesFirst:
                continuity.get("loader") ===
                (sample.cdpFrame?.loaderIdMask ?? null),
              projectMatchesFirst:
                continuity.get("project") ===
                (sample.liveTab?.projectMask ?? null),
              selectedTabMatchesFirst: continuity.get("tab") === selectedTabId,
            };
          }
        } else {
          sample.operations.push({
            operation: "provider_tab_inspection",
            status: "skipped",
            code: "selected_target_changed_or_missing",
            startedAt: Date.now(),
            elapsedMs: 0,
          });
        }

        keepSample(sample);
        const remaining = samplingDeadline - performance.now();
        if (remaining > 0) await sleep(Math.min(sampleIntervalMs, remaining));
      }

      report.status = "complete";
    } catch (error) {
      report.status = "stopped";
      const safe =
        error instanceof Error && /^[a-z0-9_]{1,64}$/.test(error.message)
          ? error.message
          : "diagnostic_setup_failed";
      report.stopCode = safe;
    } finally {
      finished = true;
      if (ownedDebuggerSession && selectedTabId !== undefined) {
        try {
          await chrome.debugger.detach({ tabId: selectedTabId });
          report.debuggerOwnership.detachPerformed = true;
        } catch {
          report.debuggerOwnership.detachCode =
            "diagnostic_owned_debugger_release_error";
        }
      }
      database?.close();
      report.completedAt = Date.now();
      report.elapsedMs = Math.round(performance.now() - startedClock);
      const healthSamples = report.samples.filter((sample) => sample.index > 1);
      report.continuity = {
        selectedTabStable:
          healthSamples.length > 1
            ? healthSamples.every(
                (sample) => sample.bindings?.selectedTabMatchesInitial === true,
              )
            : null,
        projectStable:
          healthSamples.length > 1
            ? healthSamples.every(
                (sample) => sample.liveTab?.selectedProjectMatchesLive === true,
              )
            : null,
        browserDocumentStable:
          healthSamples.length > 1 && continuity.has("document")
            ? healthSamples.every(
                (sample) => sample.continuity?.documentMatchesFirst === true,
              )
            : null,
        loaderStable:
          healthSamples.length > 1 && continuity.has("loader")
            ? healthSamples.every(
                (sample) => sample.continuity?.loaderMatchesFirst === true,
              )
            : null,
        sampleCount: report.samples.length,
      };
      window[reportName] = report;
      const json = JSON.stringify(report, null, 2);
      console.log(json);
      if (typeof copy === "function") copy(json);
    }
  })();
})();
