import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ProviderDownloads } from "../../src/app/features/downloads/Downloads";

it("keeps Flow and Vids in distinct provider panels and never starts downloads on render", () => {
  const request = vi.fn();
  const html = renderToStaticMarkup(
    <ProviderDownloads
      client={{ request } as never}
      extensionId="abcdefghijklmnopabcdefghijklmnop"
    />,
  );
  expect(html).toContain('name="download-provider"');
  expect(html).toContain("Choose a download provider");
  expect(html).toContain("Flow Downloads");
  expect(html).toContain("Vids Downloads");
  expect(html).toContain("Selected provider");
  expect(html).toContain("Download imported clips from their exact verified Flow detail route.");
  expect(html).toContain("Configure the existing hosted helper for this extension session.");
  expect(html).toContain("Extension configuration");
  expect(html).toContain("Ready for this extension session");
  expect(html).toContain("Hosted helper compatibility");
  expect(html).toContain("Source binding prepared; manual hosted compatibility check pending");
  expect(html).toContain("Google account authorization");
  expect(html).toContain("Not checked");
  expect(html).toContain("Open existing helper");
  expect(html).toContain("Use connected Vids document");
  expect(html).toContain("Split downloaded video");
  expect(html).toContain("Validate document");
  expect(html).toContain("whole timeline");
  expect(html).toContain("https://navaneetsharma22.github.io/automat-faceless-picker/?extensionId=abcdefghijklmnopabcdefghijklmnop");
  expect(html).toContain("Opening this page does not authorize a Google account.");
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
