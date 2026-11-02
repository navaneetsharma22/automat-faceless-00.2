import { describe, expect, it } from "vitest";
import { CONNECTION_STATE_CHANGED_MESSAGE } from "../../src/shared/messages";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";
import {
  CONNECTION_CAPABILITY,
  CONNECTOR_PROTOCOL_VERSION,
} from "../../src/platforms/shared/contracts";
import type { SelectedTargetRecord } from "../../src/storage/db";
import { isCurrentVerifiedVideoTarget } from "../../src/app/features/video-batch/Destination";
import { SelectedTargetConnectionStore } from "../../src/app/features/video-batch/selectedTargetConnectionStore";

function target(
  provider: "Flow" | "Vids",
  verified = true,
): SelectedTargetRecord {
  const tabId = provider === "Flow" ? 101 : 202;
  const canonicalTarget =
    provider === "Flow"
      ? "https://flow.google.com/project/video-flow"
      : "https://docs.google.com/videos/d/video-doc/edit";
  return {
    provider,
    tabId,
    canonicalTarget,
    verification: verified ? "verified" : "unverified",
    connectionState: verified ? "verified" : "disconnected",
    updatedAt: 100,
    verificationBinding: verified
      ? {
          provider,
          tabId,
          canonicalTarget,
          projectId: provider === "Flow" ? "video-flow" : "video-doc",
          frameId: 0,
          documentId: `${provider.toLowerCase()}-document`,
          documentToken: `${provider.toLowerCase()}-document-token`,
          extensionBuildId: BUILD_ID,
          extensionProtocolVersion: PROTOCOL_VERSION,
          connectorBuildId: BUILD_ID,
          connectorProtocolVersion: CONNECTOR_PROTOCOL_VERSION,
          capability: CONNECTION_CAPABILITY,
          verifiedAt: 90,
        }
      : undefined,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const verifiedEvent = {
  type: CONNECTION_STATE_CHANGED_MESSAGE,
  buildId: BUILD_ID,
  protocolVersion: PROTOCOL_VERSION,
  provider: "Flow",
  state: "verified",
  reason: "user_reconnect",
};

describe("Videos selected-target connection adapter", () => {
  it("loads the verified worker target initially with its current document/build binding", async () => {
    const store = new SelectedTargetConnectionStore(async (provider) =>
      target(provider),
    );

    await store.selectProvider("Flow");

    expect(store.getSnapshot()).toMatchObject({
      provider: "Flow",
      target: target("Flow"),
      loading: false,
    });
    expect(
      isCurrentVerifiedVideoTarget(store.getSnapshot().target, "Flow"),
    ).toBe(true);
  });

  it("refreshes from the worker target after a successful connection-change event", async () => {
    let selected: SelectedTargetRecord = target("Flow", false);
    let reads = 0;
    const store = new SelectedTargetConnectionStore(async () => {
      reads += 1;
      return selected;
    });
    await store.selectProvider("Flow");
    expect(
      isCurrentVerifiedVideoTarget(store.getSnapshot().target, "Flow"),
    ).toBe(false);

    selected = target("Flow");
    expect(store.handleRuntimeMessage(verifiedEvent)).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(reads).toBe(2);
    expect(store.getSnapshot().target).toEqual(selected);
    expect(store.getSnapshot().loading).toBe(false);
    expect(
      isCurrentVerifiedVideoTarget(store.getSnapshot().target, "Flow"),
    ).toBe(true);
  });

  it("rejects an old provider response after switching destinations", async () => {
    const flow = deferred<unknown>();
    const vids = deferred<unknown>();
    const store = new SelectedTargetConnectionStore((provider) =>
      provider === "Flow" ? flow.promise : vids.promise,
    );
    const flowRequest = store.selectProvider("Flow");
    const vidsRequest = store.selectProvider("Vids");

    vids.resolve(target("Vids"));
    await vidsRequest;
    flow.resolve(target("Flow"));
    await flowRequest;

    expect(store.getSnapshot()).toMatchObject({
      provider: "Vids",
      target: target("Vids"),
      loading: false,
    });
    expect(
      isCurrentVerifiedVideoTarget(store.getSnapshot().target, "Vids"),
    ).toBe(true);
  });

  it("ignores older same-provider reads and events from another build", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    let reads = 0;
    const store = new SelectedTargetConnectionStore(async () => {
      reads += 1;
      return reads === 1 ? first.promise : second.promise;
    });
    const firstRequest = store.selectProvider("Flow");
    const secondRequest = store.refreshSelectedProvider();

    second.resolve(target("Flow"));
    await secondRequest;
    first.resolve(target("Flow", false));
    await firstRequest;
    const readsBeforeOldBuildEvent = reads;
    expect(
      store.handleRuntimeMessage({ ...verifiedEvent, buildId: "old-build" }),
    ).toBe(false);

    expect(reads).toBe(readsBeforeOldBuildEvent);
    expect(store.getSnapshot().target).toEqual(target("Flow"));
    expect(
      isCurrentVerifiedVideoTarget(store.getSnapshot().target, "Flow"),
    ).toBe(true);
  });

  it("keeps stale document state and build/protocol bindings blocked", () => {
    const verified = target("Flow");
    expect(isCurrentVerifiedVideoTarget(verified, "Flow")).toBe(true);
    expect(
      isCurrentVerifiedVideoTarget(
        {
          ...verified,
          connectionState: "stale-document",
        },
        "Flow",
      ),
    ).toBe(false);
    expect(
      isCurrentVerifiedVideoTarget(
        {
          ...verified,
          verificationBinding: {
            ...verified.verificationBinding!,
            documentId: "",
          },
        },
        "Flow",
      ),
    ).toBe(false);
    expect(
      isCurrentVerifiedVideoTarget(
        {
          ...verified,
          verificationBinding: {
            ...verified.verificationBinding!,
            extensionBuildId: "previous-build",
          },
        },
        "Flow",
      ),
    ).toBe(false);
    expect(
      isCurrentVerifiedVideoTarget(
        {
          ...verified,
          verificationBinding: {
            ...verified.verificationBinding!,
            connectorProtocolVersion: CONNECTOR_PROTOCOL_VERSION + 1,
          },
        },
        "Flow",
      ),
    ).toBe(false);
    expect(isCurrentVerifiedVideoTarget(target("Flow", false), "Flow")).toBe(
      false,
    );
  });
});
