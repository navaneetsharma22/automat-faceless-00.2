import type { ProviderName } from "./contracts";

export type ProviderRoute = {
  provider: ProviderName;
  projectId: string;
  canonicalTarget: string;
  origin: string;
};

export type ProviderRouteUpdate =
  | "same_project_route_changed"
  | "project_route_changed";

/** Classify URL-only tab updates without treating a scoped Flow detail view as a new target. */
export function classifyProviderRouteUpdate(
  canonicalTarget: string,
  rawUrl: string,
): ProviderRouteUpdate {
  const observed = parseProviderRoute(rawUrl);
  return observed?.canonicalTarget === canonicalTarget
    ? "same_project_route_changed"
    : "project_route_changed";
}

/** Parse only documented Flow and Vids project/document routes. */
export function parseProviderRoute(rawUrl: string): ProviderRoute | undefined {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.username || url.password) {
      return undefined;
    }

    let provider: ProviderName;
    let projectId: string;
    let canonicalPath: string;

    if (url.hostname === "flow.google.com") {
      // Flow's read-only asset detail view uses one project-scoped UUID route
      // segment. Keep the canonical target at the project level and reject
      // every other nested route.
      const match = /^\/(?:u\/([0-9]+)\/)?project\/([A-Za-z0-9_-]+)(?:\/edit\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?\/?$/i.exec(
        url.pathname,
      );
      if (!match) return undefined;
      provider = "Flow";
      const accountPrefix = match[1] === undefined ? "" : `/u/${match[1]}`;
      projectId = match[2]!;
      canonicalPath = `${accountPrefix}/project/${projectId}`;
    } else if (url.hostname === "labs.google") {
      const match = /^\/fx\/tools\/flow\/([A-Za-z0-9_-]+)\/?$/.exec(
        url.pathname,
      );
      if (!match) return undefined;
      provider = "Flow";
      projectId = match[1]!;
      canonicalPath = `/fx/tools/flow/${projectId}`;
    } else if (url.hostname === "docs.google.com") {
      const match = /^\/videos\/d\/([A-Za-z0-9_-]+)\/edit\/?$/.exec(
        url.pathname,
      );
      if (!match) return undefined;
      provider = "Vids";
      projectId = match[1]!;
      canonicalPath = `/videos/d/${projectId}/edit`;
    } else if (url.hostname === "vids.google.com") {
      const match = /^\/video\/([A-Za-z0-9_-]+)\/edit\/?$/.exec(url.pathname);
      if (!match) return undefined;
      provider = "Vids";
      projectId = match[1]!;
      canonicalPath = `/video/${projectId}/edit`;
    } else {
      return undefined;
    }

    return {
      provider,
      projectId,
      canonicalTarget: `${url.origin}${canonicalPath}`,
      origin: url.origin,
    };
  } catch {
    return undefined;
  }
}
