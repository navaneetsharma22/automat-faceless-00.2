import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ProviderDownloads } from "../../src/app/features/downloads/Downloads";

it("keeps Flow and Vids in distinct provider panels and never starts downloads on render", () => {
  const request = vi.fn();
  const html = renderToStaticMarkup(
    <ProviderDownloads client={{ request } as never} />,
  );
  expect(html).toContain('name="download-provider"');
  expect(html).toContain("Choose a download provider");
  expect(html).toContain("Flow Downloads");
  expect(html).toContain("Vids Downloads");
  expect(html).toContain("Selected provider");
  expect(html).toContain("Download imported clips from their exact verified Flow detail route.");
  expect(html).toContain("Vids download preparation is not implemented yet.");
  expect(html).toContain("Vids download tools are not available in this build yet.");
  expect(html).toContain("Unavailable");
  expect(html).toContain("Import open clip");
  expect(html).toContain("Refresh list");
  expect(html).toContain('aria-describedby="flow-clip-workflow"');
  expect(html).not.toContain("FLOW PROVIDER");
  expect(html).toContain('id="downloads-panel-flow"');
  expect(html).toContain('id="downloads-panel-vids"');
  expect(html).toContain('aria-labelledby="flow-downloads-heading"');
  expect(html).toContain('aria-labelledby="vids-downloads-heading"');
  expect(request).not.toHaveBeenCalled();
});
