import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ProviderDownloads } from "../../src/app/features/downloads/Downloads";

it("keeps Flow and Vids in distinct tab panels and never starts downloads on render", () => {
  const request = vi.fn();
  const html = renderToStaticMarkup(
    <ProviderDownloads client={{ request } as never} />,
  );
  expect(html).toContain('role="tablist"');
  expect(html).toContain("Flow Downloads");
  expect(html).toContain("Vids Downloads");
  expect(html).toContain('id="downloads-panel-flow"');
  expect(html).toContain('id="downloads-panel-vids"');
  expect(request).not.toHaveBeenCalled();
});
