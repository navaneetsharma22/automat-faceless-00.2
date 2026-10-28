import { describe, expect, it, vi } from "vitest";
import {
  attachToSelectedTab,
  providerTabFromUrl,
} from "../../src/platforms/shared/connection";
import type {
  ConnectionPort,
  ConnectionProbeResponse,
  ProviderName,
} from "../../src/platforms/shared/contracts";

function makePort(provider: ProviderName, url: string, title: string) {
  const tab = providerTabFromUrl(42, title, url)!;
  const probe: ConnectionProbeResponse = {
    ok: true,
    provider,
    canonicalTarget: tab.canonicalTarget,
    adapterCapability: "read-only-connection-v1",
  };
  const browserNavigation = {
    reload: vi.fn(),
    update: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
  };
  const port = Object.assign(
    {
      requestAccess: vi.fn(async () => true),
      getTab: vi.fn(async () => tab),
      injectTopFrameProbe: vi.fn(async () => undefined),
      probeTopFrame: vi.fn(async () => probe),
    },
    browserNavigation,
  ) as ConnectionPort & typeof browserNavigation;
  return { tab, port, browserNavigation };
}

describe("read-only provider tab attachment", () => {
  it.each([
    ["Flow", "https://labs.google/fx/tools/flow/project-1", "Flow project"],
    ["Vids", "https://vids.google.com/video/vid-1/edit", "Vids document"],
  ] as const)(
    "attaches to the selected %s tab without page navigation",
    async (provider, url, title) => {
      const { tab, port, browserNavigation } = makePort(provider, url, title);

      const result = await attachToSelectedTab(provider, tab.id, port);

      expect(result).toEqual({ ok: true, tab });
      expect(port.getTab).toHaveBeenCalledExactlyOnceWith(tab.id);
      expect(port.injectTopFrameProbe).toHaveBeenCalledExactlyOnceWith(tab.id);
      expect(port.probeTopFrame).toHaveBeenCalledExactlyOnceWith(
        tab.id,
        provider,
      );
      expect(browserNavigation.reload).not.toHaveBeenCalled();
      expect(browserNavigation.update).not.toHaveBeenCalled();
      expect(browserNavigation.goBack).not.toHaveBeenCalled();
      expect(browserNavigation.goForward).not.toHaveBeenCalled();
    },
  );

  it("leaves a failed target untouched and allows a non-refresh retry", async () => {
    const { tab, port, browserNavigation } = makePort(
      "Vids",
      "https://vids.google.com/video/vid-1/edit",
      "Vids document",
    );
    vi.mocked(port.probeTopFrame)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        ok: true,
        provider: "Vids",
        canonicalTarget: tab.canonicalTarget,
        adapterCapability: "read-only-connection-v1",
      });

    const first = await attachToSelectedTab("Vids", tab.id, port);
    const second = await attachToSelectedTab("Vids", tab.id, port);

    expect(first.ok).toBe(false);
    expect(second).toEqual({ ok: true, tab });
    expect(port.injectTopFrameProbe).toHaveBeenCalledTimes(2);
    expect(browserNavigation.reload).not.toHaveBeenCalled();
    expect(browserNavigation.update).not.toHaveBeenCalled();
  });

  it("does not treat an unrelated Google document as a Vids target", () => {
    expect(
      providerTabFromUrl(
        7,
        "Google Doc",
        "https://docs.google.com/document/d/doc-id/edit",
      ),
    ).toBeUndefined();
  });
});
