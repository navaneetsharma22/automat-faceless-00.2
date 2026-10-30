/* global indexedDB, crypto, TextEncoder, console, window, URL */
// Paste into DevTools Console on the extension dashboard page.
// Read-only export for one existing Flow count-mode attempt. No provider tab
// is queried, and this script never writes to IndexedDB or the provider.
(() => {
  const databaseName = "automat-faceless-app-v1";
  // Confirm this exact ID against the dashboard screenshot before running.
  // The exporter refuses to substitute another attempt if it is absent.
  const requestedAttemptId = "86e721b7-7cc9-4c1d-a476-f2fc2d30f9ec";
  const resultName = "__FLOW_COUNT_ATTEMPT_READONLY_EXPORT__";
  const allowedStores = [
    "flowImageAttempts",
    "flowImagePromptSnapshots",
    "selectedTargets",
  ];
  const requestResult = (request) =>
    new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("idb_read_failed"));
    });
  const mismatchClass = (code) => {
    if (code === "observation_source_baseline_or_capture_fingerprint_mismatch")
      return "source_or_capture_fingerprint";
    if (code.startsWith("observation_event_binding_"))
      return "observation_event_binding_field";
    if (code === "observation_sender_document_binding_mismatch")
      return "sender_frame_or_document";
    if (code === "observation_session_id_mismatch")
      return "observation_session_id";
    if (code.startsWith("binding_check_exception_"))
      return "caught_binding_check_exception";
    if (code.startsWith("binding_"))
      return "fresh_live_target_document_source_comparison";
    if (code.includes("reconciliation")) return "worker_restart_reconciliation";
    if (code.startsWith("observer_")) return "observer_lifecycle";
    return "other_persisted_observer_diagnostic";
  };
  const txDone = (transaction) =>
    new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("idb_transaction_failed"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("idb_transaction_aborted"));
    });
  const sha256 = async (value) => {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value),
    );
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  };
  const idMask = async (value, label) =>
    typeof value === "string" && value
      ? `${label}-${(await sha256(value)).slice(0, 12)}`
      : null;
  const projectIdFromCanonicalTarget = (canonicalTarget) => {
    try {
      const url = new URL(canonicalTarget);
      if (url.protocol !== "https:") return null;
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
  const eventBlockers = (event) => {
    const snapshot = event.snapshot;
    const blockers = [];
    if (!snapshot.completeForRenderedScope) blockers.push("scope_incomplete");
    if (snapshot.captureGaps.length) blockers.push("capture_gaps_present");
    if (snapshot.identityCandidatesTruncated)
      blockers.push("identity_candidates_truncated");
    if (snapshot.unidentifiedImageCount > 0)
      blockers.push("unidentified_images_present");
    if (snapshot.virtualized) blockers.push("virtualization_risk");
    const visibleTiles = new Set(
      snapshot.tiles
        .filter((tile) => tile.visible)
        .map((tile) => tile.tileToken),
    );
    const relevantSignals = snapshot.lifecycleSignals.filter(
      (signal) =>
        signal.visible &&
        (signal.scope === "project" ||
          (signal.tileToken !== null && visibleTiles.has(signal.tileToken))),
    );
    if (
      relevantSignals.some((signal) => signal.markerKind === "error_candidate")
    )
      blockers.push("visible_error_signal");
    if (
      snapshot.resourceEvents.some(
        (resource) =>
          resource.type === "error" &&
          resource.tileToken !== null &&
          visibleTiles.has(resource.tileToken),
      )
    )
      blockers.push("visible_resource_error");
    if (
      relevantSignals.some((signal) =>
        ["loading", "processing", "busy", "progressbar"].includes(
          signal.markerKind,
        ),
      )
    )
      blockers.push("visible_loading_or_processing_signal");
    return { blockers, relevantSignals, visibleTiles };
  };
  const auditCandidateOccurrences = (attempt, events) => {
    const baseline = attempt.countBaseline;
    const boundary = attempt.countDecision?.dispatchBoundaryAt;
    const priorHashes = new Set([
      ...(baseline?.baselineCandidateIds ?? []),
      ...(baseline?.priorMatchedCandidateIds ?? []),
    ]);
    const baselineTiles = new Set(baseline?.baselineTileTokens ?? []);
    const seen = new Set();
    const occurrences = [];
    for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
      if (event.kind !== "structural_snapshot") continue;
      const gate = eventBlockers(event);
      const atOrBeforeBoundary =
        boundary === undefined || event.observedAt <= boundary;
      const tiles = new Map(
        event.snapshot.tiles.map((tile) => [tile.tileToken, tile]),
      );
      for (const media of event.snapshot.mediaCandidates) {
        let eligibility = "excluded";
        let reason;
        if (atOrBeforeBoundary)
          reason = "observed_at_or_before_dispatch_boundary";
        else if (gate.blockers.length)
          reason = "event_blocked_before_candidate_reduction";
        else if (!media.visible) reason = "media_not_visible";
        else if (
          !media.complete ||
          media.naturalWidth <= 0 ||
          media.naturalHeight <= 0
        )
          reason = "resource_not_ready";
        else if (!tiles.has(media.tileToken)) reason = "tile_ownership_missing";
        else if (!tiles.get(media.tileToken).visible)
          reason = "owning_tile_not_visible";
        else if (priorHashes.has(media.candidateId))
          reason = "baseline_or_prior_matched_candidate";
        else if (baselineTiles.has(media.tileToken))
          reason = "new_candidate_on_baseline_tile_ownership_ambiguous";
        else if (seen.has(media.candidateId))
          reason = "candidate_hash_already_seen";
        else {
          eligibility = "eligible_candidate";
          reason = "new_post_boundary_visible_ready_candidate";
          seen.add(media.candidateId);
        }
        occurrences.push({
          sequence: event.sequence,
          observedAt: event.observedAt,
          afterDispatchBoundary: !atOrBeforeBoundary,
          candidateHash: media.candidateId,
          tileToken: media.tileToken,
          mediaToken: media.mediaToken,
          mediaVisible: media.visible,
          owningTileVisible: tiles.get(media.tileToken)?.visible ?? false,
          complete: media.complete,
          naturalWidth: media.naturalWidth,
          naturalHeight: media.naturalHeight,
          eligibility,
          reason,
          eventBlockers: gate.blockers,
        });
      }
    }
    return {
      occurrences,
      distinctEligibleCandidateHashesFromPersistedEvents: [...seen]
        .filter((hash) => !priorHashes.has(hash))
        .sort(),
    };
  };
  const summarize = async (attempt, snapshot, selectedTarget) => {
    const session = attempt.observationSession ?? null;
    const baseline = attempt.countBaseline ?? null;
    const decision = attempt.countDecision ?? null;
    const observations = [...(attempt.structuralObservations ?? [])].sort(
      (a, b) => a.sequence - b.sequence,
    );
    const receipts = [...(attempt.observationReceipts ?? [])].sort(
      (a, b) => a.sequence - b.sequence,
    );
    const dispatchBoundaryAt = decision?.dispatchBoundaryAt;
    const lastSequence = session?.lastSequence ?? 0;
    const receiptSequences = new Set(
      receipts.map((receipt) => receipt.sequence),
    );
    const observationSequences = new Set(
      observations.map((observation) => observation.sequence),
    );
    const missingReceiptSequences = [];
    for (let sequence = 1; sequence <= lastSequence; sequence++)
      if (!receiptSequences.has(sequence))
        missingReceiptSequences.push(sequence);
    const priorProject = attempt.projectId;
    const promptHash = attempt.promptHash;
    const sourceHashStatus = snapshot
      ? snapshot.snapshotId === attempt.sourceSnapshotId &&
        snapshot.workspaceId === attempt.workspaceId &&
        snapshot.batchId === attempt.batchId &&
        snapshot.itemId === attempt.itemId &&
        snapshot.promptHash === promptHash &&
        snapshot.promptCodeUnits === attempt.promptCodeUnits &&
        snapshot.promptUtf8Bytes === attempt.promptUtf8Bytes &&
        typeof snapshot.rawJsonBody === "string" &&
        (await sha256(snapshot.rawJsonBody)) === promptHash
        ? "match"
        : "mismatch"
      : "snapshot_missing";
    const baselineHashes = baseline?.baselineCandidateIds ?? [];
    const postBoundary = observations.flatMap((event) =>
      event.kind === "structural_snapshot" &&
      dispatchBoundaryAt !== undefined &&
      event.observedAt > dispatchBoundaryAt
        ? event.snapshot.mediaCandidates.map((media) => ({
            sequence: event.sequence,
            observedAt: event.observedAt,
            candidateHash: media.candidateId,
            tileToken: media.tileToken,
            mediaToken: media.mediaToken,
            visible: media.visible,
            complete: media.complete,
            naturalWidth: media.naturalWidth,
            naturalHeight: media.naturalHeight,
          }))
        : [],
    );
    const candidateAudit = auditCandidateOccurrences(attempt, observations);
    const dispatchEvents = (attempt.events ?? []).filter(
      (event) =>
        event.stage === "dispatch" ||
        event.code === "dispatch_intent_persisted",
    );
    const storageFailures = (attempt.events ?? []).filter(
      (event) =>
        event.stage === "storage" ||
        (/storage|persist/i.test(event.code ?? "") &&
          /failed|failure|unavailable/i.test(event.code ?? "")),
    );
    const sanitizedAttemptEvents = (attempt.events ?? [])
      .slice(-100)
      .map((event, index) => ({
        ordinal: index + 1,
        stage: event.stage,
        at: event.at,
        method: event.method,
        code:
          typeof event.code === "string" && /^[a-z0-9_]{1,64}$/.test(event.code)
            ? event.code
            : "event_code_unavailable_or_unrecognized",
      }));
    const mismatchEvents = sanitizedAttemptEvents.filter((event) =>
      /binding|fingerprint|sender|session|document|project|reconciliation|observer_(lost|resume|deadline)/.test(
        event.code,
      ),
    );
    const currentVerification = selectedTarget?.verificationBinding ?? null;
    const bindingConsistency = {
      confirmationProjectMatchesAttempt:
        attempt.settingsConfirmation?.projectId === priorProject,
      countBaselineProjectMatchesAttempt: baseline?.projectId === priorProject,
      countBaselineTabMatchesAttempt: baseline?.tabId === attempt.tabId,
      countBaselineDocumentMatchesAttempt:
        baseline?.documentId === attempt.documentId,
      countBaselineBuildMatchesAttempt: baseline?.buildId === attempt.buildId,
      sessionDocumentMatchesAttempt: session?.documentId === attempt.documentId,
      sessionFrameMatchesAttempt:
        session?.senderFrameId === attempt.senderFrameId,
      selectedDashboardTargetMatchesAttemptProject:
        selectedTarget?.provider === "Flow" &&
        selectedTarget.canonicalTarget ===
          attempt.settingsConfirmation?.canonicalTarget &&
        selectedTarget.tabId === attempt.tabId &&
        projectIdFromCanonicalTarget(selectedTarget.canonicalTarget) ===
          priorProject,
      resultBaselineBindingMatchesAttempt: Boolean(
        attempt.resultBaseline?.binding?.projectId === priorProject &&
        attempt.resultBaseline?.binding?.tabId === attempt.tabId &&
        attempt.resultBaseline?.binding?.frameId === attempt.frameId &&
        attempt.resultBaseline?.binding?.loaderId === attempt.loaderId &&
        attempt.resultBaseline?.binding?.sourceHash === promptHash &&
        attempt.resultBaseline?.capture?.buildId === attempt.buildId,
      ),
      observationBindingsMatchAttempt: observations.every(
        (event) =>
          event.attemptId === attempt.attemptId &&
          event.sessionId === session?.sessionId &&
          event.binding.projectId === priorProject &&
          event.binding.tabId === attempt.tabId &&
          event.binding.sourceHash === promptHash &&
          event.binding.sourceSnapshotId === attempt.sourceSnapshotId,
      ),
    };
    return {
      attempt: {
        attemptId: attempt.attemptId,
        attemptIdMatchesRequestedDashboardId:
          attempt.attemptId === requestedAttemptId,
        state: attempt.state,
        failureStage: attempt.events?.at(-1)?.stage ?? null,
        createdAt: attempt.createdAt,
        updatedAt: attempt.updatedAt,
        immutableAttemptBinding: {
          projectMask: await idMask(attempt.projectId, "project"),
          tabId: attempt.tabId,
          frameIdMask: await idMask(attempt.frameId, "frame"),
          loaderIdMask: await idMask(attempt.loaderId, "loader"),
          documentMask: await idMask(attempt.documentId, "document"),
          senderFrameId: attempt.senderFrameId ?? null,
          buildId: attempt.buildId,
          protocolVersion: attempt.protocolVersion,
          sourceHash: attempt.promptHash,
          sourceSnapshotMask: await idMask(
            attempt.sourceSnapshotId,
            "snapshot",
          ),
          sessionMask: await idMask(session?.sessionId, "session"),
          sessionDocumentMask: await idMask(session?.documentId, "document"),
          sessionSenderFrameId: session?.senderFrameId ?? null,
          bindingsAreHistoricalAndWereNotRewritten: true,
        },
        eventTrail: sanitizedAttemptEvents,
        eventTrailCoverage: {
          storedEventCount: attempt.events?.length ?? 0,
          exportedEventCount: sanitizedAttemptEvents.length,
          exporterTruncated: (attempt.events?.length ?? 0) > 100,
          storageRetentionIsSchemaBounded: true,
        },
        boundedMismatchDiagnostics: {
          persistedDiagnosticEvents: mismatchEvents.map((event) => ({
            ...event,
            comparisonClass: mismatchClass(event.code),
          })),
          exactRecordedReason: mismatchEvents.at(-1)?.code ?? null,
          rejectedObservationPayloadsPersisted: false,
          rejectedPayloadsStatus: "absent_from_this_storage_schema",
        },
        workspaceId: attempt.workspaceId,
        batchId: attempt.batchId,
        itemId: attempt.itemId,
        shotId: attempt.shotId ?? null,
        provider: attempt.provider,
        source: {
          promptHash,
          sourceSnapshotMask: await idMask(
            attempt.sourceSnapshotId,
            "snapshot",
          ),
          promptCodeUnits: attempt.promptCodeUnits,
          promptUtf8Bytes: attempt.promptUtf8Bytes,
          snapshotPresent: Boolean(snapshot),
          snapshotContentAndBindingStatus: sourceHashStatus,
          promptBodyReturned: false,
        },
        binding: {
          projectMask: await idMask(priorProject, "project"),
          tabId: attempt.tabId,
          frameId: attempt.frameId,
          senderFrameId: attempt.senderFrameId ?? null,
          loaderIdMask: await idMask(attempt.loaderId, "loader"),
          documentMask: await idMask(attempt.documentId, "document"),
          buildId: attempt.buildId,
          protocolVersion: attempt.protocolVersion,
          consistency: bindingConsistency,
        },
        settingsConfirmation: {
          confirmationIdMask: await idMask(
            attempt.settingsConfirmation?.confirmationId,
            "confirmation",
          ),
          projectMatchesAttempt:
            attempt.settingsConfirmation?.projectId === priorProject,
          tabMatchesAttempt:
            attempt.settingsConfirmation?.tabId === attempt.tabId,
          declaredVariantCount:
            attempt.settingsConfirmation?.declaredVariantCount ?? null,
          source: attempt.settingsConfirmation?.userAttested
            ? "user_attested"
            : "unknown",
        },
        countBaseline: baseline
          ? {
              mode: baseline.mode,
              startingImageCount: baseline.startingImageCount,
              expectedAdditions:
                attempt.settingsConfirmation?.declaredVariantCount ?? null,
              expectedTotal:
                baseline.startingImageCount +
                (attempt.settingsConfirmation?.declaredVariantCount ?? 0),
              persistedExpectedCumulativeAdditions:
                decision?.expectedCumulativeAdditions ?? null,
              persistedExpectedTotal: decision?.expectedTotal ?? null,
              capturedAt: baseline.capturedAt,
              renderedScopeComplete: baseline.renderedScopeComplete,
              virtualized: baseline.virtualized,
              virtualizationEvidence: baseline.virtualizationEvidence ?? [],
              virtualScrollContainerCount:
                baseline.virtualScrollContainerCount ?? null,
              baselineCandidateHashes: baselineHashes,
              baselineTileTokens: baseline.baselineTileTokens,
              priorMatchedAttemptCount: baseline.priorMatchedAttemptIds.length,
              priorMatchedCandidateHashes: baseline.priorMatchedCandidateIds,
              captureGaps: baseline.captureGaps,
              inventoryComplete: baseline.inventoryComplete ?? false,
            }
          : null,
        observationSession: session
          ? {
              sessionIdMask: await idMask(session.sessionId, "session"),
              status: session.status,
              profileSupport: session.profileSupport,
              documentMask: await idMask(session.documentId, "document"),
              senderFrameId: session.senderFrameId,
              startedAt: session.startedAt,
              deadlineAt: session.deadlineAt,
              maxEvents: session.maxEvents,
              lastSequence: session.lastSequence,
              reconciliationCount: session.reconciliationCount,
              resultOutcomeUpdatedAt: attempt.resultOutcome?.updatedAt ?? null,
              countDecisionUpdatedAt: decision?.updatedAt ?? null,
              armReceipt: session.armReceipt ?? null,
            }
          : null,
        dispatch: {
          boundaryAt: dispatchBoundaryAt ?? null,
          boundaryPersisted: dispatchBoundaryAt !== undefined,
          dispatchEvents: dispatchEvents.map(({ stage, at, method, code }) => ({
            stage,
            at,
            method,
            code: code ?? null,
          })),
          activationPairSent: (attempt.events ?? []).some(
            (event) => event.code === "activation_pair_sent",
          ),
          activationPairAttemptCount: (attempt.events ?? []).filter(
            (event) => event.code === "activation_pair_sent",
          ).length,
        },
        timelineTimestamps: {
          attemptCreatedAt: attempt.createdAt,
          attemptUpdatedAt: attempt.updatedAt,
          dispatchBoundaryAt: dispatchBoundaryAt ?? null,
          observationSessionStartedAt: session?.startedAt ?? null,
          observationSessionDeadlineAt: session?.deadlineAt ?? null,
          resultOutcomeUpdatedAt: attempt.resultOutcome?.updatedAt ?? null,
          countDecisionUpdatedAt: decision?.updatedAt ?? null,
          latestAttemptEventAt: attempt.events?.at(-1)?.at ?? null,
        },
        observationDelivery: {
          classification:
            receipts.length === 0
              ? "no_durable_observations_received"
              : "durable_observations_received",
          durableReceiptCount: receipts.length,
          receiptSequences: receipts.map((receipt) => receipt.sequence),
          receiptEvents: await Promise.all(
            receipts.map(async (receipt) => ({
              sequence: receipt.sequence,
              observationIdMask: await idMask(
                receipt.observationId,
                "observation",
              ),
              receivedAt: receipt.receivedAt,
              fingerprint: receipt.fingerprint,
            })),
          ),
          structuralObservationCount: observations.length,
          structuralObservationSequences: observations.map((event) => ({
            sequence: event.sequence,
            kind: event.kind,
            observedAt: event.observedAt,
            sourceBaselineFingerprint: event.sourceBaselineFingerprint,
            captureFingerprint: event.captureFingerprint,
            snapshot: event.snapshot,
          })),
          durableReceiptSequenceGaps: missingReceiptSequences,
          receiptSequencesWithoutPersistedObservation: receipts
            .map((receipt) => receipt.sequence)
            .filter((sequence) => !observationSequences.has(sequence)),
          observationsWithoutReceipt: observations
            .map((event) => event.sequence)
            .filter((sequence) => !receiptSequences.has(sequence)),
          gapAndTruncationEvents: observations.flatMap((event) => {
            const snapshot = event.snapshot;
            const hasGap = snapshot.captureGaps.length > 0;
            const truncated =
              !snapshot.completeForRenderedScope ||
              snapshot.identityCandidatesTruncated ||
              snapshot.unidentifiedImageCount > 0;
            return hasGap || truncated
              ? [
                  {
                    sequence: event.sequence,
                    captureGaps: snapshot.captureGaps,
                    completeForRenderedScope: snapshot.completeForRenderedScope,
                    identityCandidatesTruncated:
                      snapshot.identityCandidatesTruncated,
                    unidentifiedImageCount: snapshot.unidentifiedImageCount,
                  },
                ]
              : [];
          }),
          deliveryFailureRecordsPersisted: false,
          deliveryFailureNote:
            "This schema persists accepted receipts, not rejected send payloads. Fixed diagnostic codes persisted in the attempt event trail identify some refusals; rejected payloads and refusals without a durable diagnostic remain absent.",
          rejectedOrReconciliationDiagnostics: mismatchEvents.map((event) => ({
            ordinal: event.ordinal,
            at: event.at,
            stage: event.stage,
            code: event.code,
            comparisonClass: mismatchClass(event.code),
          })),
          sessionStatus: session?.status ?? null,
          observerStopOrLoss: observations
            .filter((event) => event.kind !== "structural_snapshot")
            .map((event) => ({
              sequence: event.sequence,
              kind: event.kind,
              observedAt: event.observedAt,
            })),
          resultOutcome: attempt.resultOutcome ?? null,
        },
        candidateComparison: {
          dispatchBoundaryAt: dispatchBoundaryAt ?? null,
          baselineCandidateHashes: baselineHashes,
          postBoundaryCandidateOccurrences: postBoundary,
          candidateEligibilityAudit: candidateAudit.occurrences,
          distinctEligibleHashesFromAudit:
            candidateAudit.distinctEligibleCandidateHashesFromPersistedEvents,
          persistedEligibleCandidateHashes:
            decision?.observedEligibleCandidateIds ?? [],
          persistedCountDecision: decision ?? null,
          interpretation:
            receipts.length === 0
              ? "No durable observation receipts exist; candidate exclusion cannot be assessed from this attempt."
              : candidateAudit.occurrences.some(
                    (candidate) => candidate.afterDispatchBoundary,
                  )
                ? "Observations were received; inspect each candidate eligibility reason and event-level blockers."
                : "Observations were received, but no persisted candidate occurrence is later than the dispatch boundary.",
        },
        storageFailures: {
          attemptStorageEvents: storageFailures.map(({ stage, at, code }) => ({
            stage,
            at,
            code: code ?? null,
          })),
          countDecisionStorageReadbackFailed:
            decision?.reason === "storage_readback_failed",
        },
      },
      selectedDashboardTarget: selectedTarget
        ? {
            provider: selectedTarget.provider,
            tabId: selectedTarget.tabId,
            projectMask: await idMask(
              projectIdFromCanonicalTarget(selectedTarget.canonicalTarget) ??
                "",
              "selected-project",
            ),
            matchesAttemptTab: selectedTarget.tabId === attempt.tabId,
            matchesAttemptCanonicalTarget:
              selectedTarget.canonicalTarget ===
              attempt.settingsConfirmation?.canonicalTarget,
            verification: selectedTarget.verification,
            connectionState: selectedTarget.connectionState ?? null,
            reconnectEnabled: selectedTarget.reconnectEnabled !== false,
            savedVerificationBinding: currentVerification
              ? {
                  projectMask: await idMask(
                    currentVerification.projectId,
                    "project",
                  ),
                  tabId: currentVerification.tabId,
                  canonicalTargetMatchesAttempt:
                    currentVerification.canonicalTarget ===
                    attempt.settingsConfirmation?.canonicalTarget,
                  projectMatchesAttempt:
                    currentVerification.projectId === attempt.projectId,
                  documentMatchesAttempt:
                    currentVerification.documentId === attempt.documentId,
                  frameIdMatchesAttempt:
                    currentVerification.frameId === attempt.senderFrameId,
                  extensionBuildMatchesAttempt:
                    currentVerification.extensionBuildId === attempt.buildId,
                  connectorBuildMatchesAttempt:
                    currentVerification.connectorBuildId === attempt.buildId,
                  extensionProtocolMatchesAttempt:
                    currentVerification.extensionProtocolVersion ===
                    attempt.protocolVersion,
                  connectorProtocolVersion:
                    currentVerification.connectorProtocolVersion,
                  connectorTokenPresent:
                    typeof currentVerification.documentToken === "string",
                  verifiedAt: currentVerification.verifiedAt,
                }
              : null,
            lifecycleDiagnostics: (selectedTarget.lifecycleDiagnostics ?? [])
              .slice(-32)
              .map((event) => ({
                kind: event.kind,
                reason: event.reason,
                at: event.at,
                bindingComparison: event.bindingComparison ?? null,
              })),
          }
        : null,
      privacy: {
        transactionMode: "readonly",
        storageWritesPerformed: false,
        providerTabQueried: false,
        promptBodyReturned: false,
        rawCanonicalTargetReturned: false,
        rawProjectOrDocumentIdsReturned: false,
        credentialsOrAccountDataReturned: false,
      },
    };
  };

  void (async () => {
    let database;
    try {
      if (typeof indexedDB.databases !== "function")
        throw new Error("database_enumeration_unsupported");
      const databases = await indexedDB.databases();
      if (!databases.some((entry) => entry.name === databaseName))
        throw new Error("database_missing");
      database = await new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onupgradeneeded = () => {
          request.transaction?.abort();
          reject(new Error("unexpected_database_upgrade"));
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(request.error ?? new Error("open_failed"));
        request.onblocked = () => reject(new Error("database_open_blocked"));
      });
      const missingStores = allowedStores.filter(
        (store) => !database.objectStoreNames.contains(store),
      );
      if (missingStores.length)
        throw new Error(`required_store_missing_${missingStores.length}`);
      const transaction = database.transaction(allowedStores, "readonly");
      const done = txDone(transaction);
      const [attempts, snapshots, selectedTargets] = await Promise.all([
        requestResult(transaction.objectStore("flowImageAttempts").getAll()),
        requestResult(
          transaction.objectStore("flowImagePromptSnapshots").getAll(),
        ),
        requestResult(transaction.objectStore("selectedTargets").getAll()),
      ]);
      await done;
      const selectedTarget = selectedTargets.find(
        (target) => target.provider === "Flow",
      );
      const attempt = attempts.find(
        (entry) => entry.attemptId === requestedAttemptId,
      );
      const selectionStatus = attempt
        ? "dashboard_attempt_id_match"
        : "attempt_not_found";
      if (!attempt) {
        const report = {
          diagnostic: "flow-count-attempt-readonly-export-v1",
          status: "attempt_not_found",
          selectionStatus,
          requestedAttemptId,
          storageWritesPerformed: false,
        };
        window[resultName] = report;
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      const snapshot = snapshots.find(
        (entry) => entry.snapshotId === attempt.sourceSnapshotId,
      );
      const report = {
        diagnostic: "flow-count-attempt-readonly-export-v1",
        status: "complete",
        selectionStatus,
        dashboardAttemptIdCrossCheck: {
          requestedId: requestedAttemptId,
          storedIdMatchesRequested: attempt.attemptId === requestedAttemptId,
          screenshotComparedByScript: false,
          instruction:
            "Before running, visually confirm the dashboard screenshot shows the requested ID. This script can verify the stored row ID only; it does not read screenshot pixels.",
        },
        databaseVersion: database.version,
        attempt: await summarize(attempt, snapshot, selectedTarget),
        privacy: {
          transactionMode: "readonly",
          storageWritesPerformed: false,
          providerTabQueried: false,
          promptBodyReturned: false,
          rawCanonicalTargetReturned: false,
          rawProjectOrDocumentIdsReturned: false,
          credentialsOrAccountDataReturned: false,
        },
      };
      window[resultName] = report;
      console.log(JSON.stringify(report, null, 2));
    } catch (error) {
      const safeCode =
        error instanceof Error && /^[a-z0-9_]{1,64}$/.test(error.message)
          ? error.message
          : "diagnostic_failed";
      const report = {
        diagnostic: "flow-count-attempt-readonly-export-v1",
        status: "read_failed",
        reason: safeCode,
        storageWritesPerformed: false,
      };
      window[resultName] = report;
      console.log(JSON.stringify(report, null, 2));
    } finally {
      database?.close();
    }
  })();
})();
