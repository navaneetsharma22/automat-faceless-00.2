import { resolveFlowReferenceFetcher } from "../../src/platforms/flow/referenceResource";

type WorkerMessageEvent = { data: string };
const workerScope = self as unknown as {
  addEventListener: (
    type: "message",
    listener: (event: WorkerMessageEvent) => void,
  ) => void;
  postMessage: (message: unknown) => void;
};

workerScope.addEventListener("message", (event) => {
  void (async () => {
    try {
      const input = { fetcher: resolveFlowReferenceFetcher() };
      const response = await input.fetcher(event.data);
      workerScope.postMessage({
        ok: true,
        status: response.status,
        body: await response.text(),
      });
    } catch (error) {
      workerScope.postMessage({
        ok: false,
        name: error instanceof Error ? error.name : "unknown",
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  })();
});
