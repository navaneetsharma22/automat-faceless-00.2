import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ImageImportPanel } from "../../src/app/features/image-batch/ImportPanel";
import { VideoImportPanel } from "../../src/app/features/video-batch/ImportPanel";
import { ImportPreviewSession } from "../../src/app/features/shared/importPreviewSession";
import { ToastHost } from "../../src/app/components/ToastHost";
import { createFoundationClient } from "../../src/shared/messageClient";
import { importPromptBatch } from "../../src/domain/batches/importBatch";
import { QueueCard } from "../../src/app/features/image-batch/Progress";
import type { ImageSubmissionQueueRecord } from "../../src/domain/jobs/queue";

describe("Image import panel 'New batch' action and stopped queue UI regression", () => {
  function renderImageImportPanel(
    session: ImportPreviewSession,
    onSourceReadinessChange = vi.fn(),
  ) {
    const props = {
      session,
      wrapLines: false,
      setWrapLines: () => undefined,
      editorExpanded: false,
      setEditorExpanded: () => undefined,
      workspaceId: "default",
      persistenceClient: createFoundationClient({
        sendMessage: async () => ({}),
      }),
      onSourceReadinessChange,
    };
    return renderToStaticMarkup(
      createElement(ToastHost, null, createElement(ImageImportPanel, props)),
    );
  }

  function renderVideoImportPanel(session: ImportPreviewSession) {
    const props = {
      session,
      wrapLines: false,
      setWrapLines: () => undefined,
      editorExpanded: false,
      setEditorExpanded: () => undefined,
      workspaceId: "default",
      persistenceClient: createFoundationClient({
        sendMessage: async () => ({}),
      }),
    };
    return renderToStaticMarkup(
      createElement(ToastHost, null, createElement(VideoImportPanel, props)),
    );
  }

  it("renders the 'New batch' button in the Images import panel but not Videos", () => {
    const imageSession = new ImportPreviewSession("image");
    const videoSession = new ImportPreviewSession("video");

    const imageHtml = renderImageImportPanel(imageSession);
    const videoHtml = renderVideoImportPanel(videoSession);

    expect(imageHtml).toContain("New batch");
    expect(videoHtml).not.toContain("New batch");
  });

  it("ImportPreviewSession.clear() cleans editable draft, results, errors and cancels pending validation", () => {
    let scheduledCallback: (() => void) | undefined;
    const session = new ImportPreviewSession(
      "image",
      importPromptBatch,
      (callback) => {
        scheduledCallback = callback;
        return 42 as unknown as ReturnType<typeof setTimeout>;
      },
    );

    session.setSource('{"shot_id":"01","prompt":"hello world"}');
    session.validate();
    expect(session.getSnapshot().status).toBe("pending");
    expect(scheduledCallback).toBeDefined();

    // Execute validation
    scheduledCallback?.();
    expect(session.getSnapshot().status).toBe("success");
    expect(session.getSnapshot().result?.items.length).toBe(1);

    const prevRevision = session.getSnapshot().revision;
    session.clear();

    const snapshot = session.getSnapshot();
    expect(snapshot.source).toBe("");
    expect(snapshot.status).toBe("idle");
    expect(snapshot.result).toBeUndefined();
    expect(snapshot.resultRevision).toBeUndefined();
    expect(snapshot.error).toBeUndefined();
    expect(snapshot.elapsedMs).toBeUndefined();
    expect(snapshot.revision).toBe(prevRevision + 1);
  });

  it("renders empty draft notice when newBatchNotice is set", () => {
    const session = new ImportPreviewSession("image");
    session.setSource("");
    const html = renderImageImportPanel(session);

    // Initial empty state has save button disabled and clear prompt to validate
    expect(html).toContain("Not saved. Validate before saving.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save validated batch<\/button>/);
  });

  it("Stopped queue displays 'No further prompts will be sent.' instead of 'Checking next prompt…'", () => {
    const stoppedQueue: ImageSubmissionQueueRecord = {
      queueId: "queue-stopped-test",
      workspaceId: "default",
      kind: "image",
      mode: "timed_submission",
      intervalMs: 40_000,
      state: "stopped",
      sourceText: "{}",
      sourceHash: "a".repeat(64),
      sourceMode: "single_json_value",
      selectedProject: {
        provider: "Flow",
        tabId: 1,
        projectId: "proj-1",
        canonicalTarget: "https://flow.google.com/project/proj-1",
        selectionRevision: 1,
      },
      manualSettingsDeclaration: {
        confirmationId: "conf-1",
        confirmedAt: 1,
        tabId: 1,
        projectId: "proj-1",
        canonicalTarget: "https://flow.google.com/project/proj-1",
        declaredVariantCount: 1,
        userAttested: true,
      },
      items: [
        {
          queueItemId: "item-1",
          sourceItemId: "source-1",
          order: 0,
          shotId: "1",
          rawJsonBody: "{}",
          promptHash: "b".repeat(64),
          sourceSpan: { start: 0, end: 2 },
          itemState: "sent",
          providerOutcome: "unknown",
          dispatchReceipt: {
            attemptId: "attempt-1",
            storedAt: 1_000_000,
            evidence: "activation_pair_sent_or_uncertain",
          },
        },
        {
          queueItemId: "item-2",
          sourceItemId: "source-2",
          order: 1,
          shotId: "2",
          rawJsonBody: "{}",
          promptHash: "c".repeat(64),
          sourceSpan: { start: 0, end: 2 },
          itemState: "stopped",
          providerOutcome: "not_started",
        },
      ],
      lastDispatchReceiptStoredAt: 1_000_000,
      nextEligibleDispatchAt: null,
      createdAt: 1,
      updatedAt: 2,
      revision: 1,
    };

    const html = renderToStaticMarkup(
      createElement(QueueCard, {
        queue: stoppedQueue,
        starting: false,
        busy: false,
        onStart: () => undefined,
        onCommand: () => undefined,
      }),
    );

    expect(html).toContain("Queue stopped");
    expect(html).toContain("No further prompts will be sent.");
    expect(html).not.toContain("Checking next prompt…");
  });
});
