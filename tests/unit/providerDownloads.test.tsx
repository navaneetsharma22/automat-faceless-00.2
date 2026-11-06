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
  expect(html).toContain("Connect the helper, choose the prepared document, then download its MP4.");
  expect(html).toContain("Extension</span>");
  expect(html).toContain("data-status=\"ready\">Ready");
  expect(html).toContain("Helper compatibility</span>");
  expect(html).toContain("Pending live check");
  expect(html).toContain("Google account authorization");
  expect(html).toContain("Not checked");
  expect(html).toContain("Open existing helper");
  expect(html).toContain("Use connected Vids document");
  expect(html).toContain("Split downloaded video");
  expect(html).toContain("Validate document");
  expect(html).toContain("manually prepared Vids timeline ready");
  expect(html).toContain("https://navaneetsharma22.github.io/automat-faceless-picker/?extensionId=abcdefghijklmnopabcdefghijklmnop");
  expect(html).toContain("Google authorization happens in the helper.");
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
