import type { Page } from "@playwright/test";

const fixtureUrl = "https://flow.google.com/u/1/project/local_fixture";

/**
 * Give Flow runtime fixtures the route and project ownership that production
 * discovery requires. The route is fulfilled locally, so no provider page or
 * network content is loaded.
 */
export async function setLocalFlowFixture(
  page: Page,
  html: string,
  options: { resultsRegion?: boolean } = {},
) {
  await page.route("https://flow.google.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body></body></html>",
    }),
  );
  await page.goto(fixtureUrl);
  await page.setContent(html);
  await page.evaluate(() => {
    const project = document.createElement("flow-project-page");
    while (document.body.firstChild) project.append(document.body.firstChild);
    document.body.append(project);
  });
  if (options.resultsRegion) {
    await page.locator("flow-project-page").evaluate((project) => {
      const region = document.createElement("section");
      region.setAttribute("role", "region");
      region.setAttribute("aria-label", "Generated results");
      project.append(region);
    });
  }
  await page.addStyleTag({
    content:
      "flow-project-page{display:block;min-height:40px}section[aria-label='Generated results']{display:block;min-height:40px}",
  });
}
