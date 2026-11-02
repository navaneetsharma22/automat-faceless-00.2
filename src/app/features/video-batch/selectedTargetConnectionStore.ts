import type { SelectedTargetRecord } from "../../../storage/db";
import type { ProviderName } from "../../../platforms/shared/contracts";
import { readConnectionStateChangedEvent } from "../../../platforms/shared/connectionLifecycle";

export type SelectedTargetConnectionSnapshot = {
  provider: ProviderName;
  target?: SelectedTargetRecord;
  loading: boolean;
};

export type ReadSelectedTarget = (provider: ProviderName) => Promise<unknown>;

function readTargetRecord(
  value: unknown,
  provider: ProviderName,
): SelectedTargetRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<SelectedTargetRecord>;
  if (
    record.provider !== provider ||
    !Number.isInteger(record.tabId) ||
    (record.tabId ?? -1) < 0 ||
    typeof record.canonicalTarget !== "string" ||
    (record.verification !== "verified" && record.verification !== "unverified")
  )
    return undefined;
  return record as SelectedTargetRecord;
}

/** Worker-backed selected target snapshot with versioned event refresh and stale-response guards. */
export class SelectedTargetConnectionStore {
  private snapshot: SelectedTargetConnectionSnapshot;
  private readonly listeners = new Set<() => void>();
  private requestRevision = 0;

  constructor(
    private readonly readSelectedTarget: ReadSelectedTarget,
    initialProvider: ProviderName = "Flow",
  ) {
    this.snapshot = { provider: initialProvider, loading: false };
  }

  getSnapshot = (): SelectedTargetConnectionSnapshot => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  selectProvider(provider: ProviderName): Promise<void> {
    this.requestRevision += 1;
    this.snapshot = { provider, loading: true };
    this.publish();
    return this.refresh(provider);
  }

  refreshSelectedProvider(): Promise<void> {
    return this.refresh(this.snapshot.provider);
  }

  handleRuntimeMessage(message: unknown): boolean {
    const event = readConnectionStateChangedEvent(message);
    if (!event || event.provider !== this.snapshot.provider) return false;
    void this.refresh(event.provider);
    return true;
  }

  cancelPendingRequests(): void {
    this.requestRevision += 1;
  }

  private async refresh(provider: ProviderName): Promise<void> {
    if (provider !== this.snapshot.provider) return;
    const revision = ++this.requestRevision;
    // Do not keep authorizing the old verification while a reconnect or
    // lifecycle transition is being reconciled from the worker.
    this.snapshot = { provider, loading: true };
    this.publish();
    try {
      const response = await this.readSelectedTarget(provider);
      if (!this.isCurrent(provider, revision)) return;
      this.snapshot = {
        provider,
        target: readTargetRecord(response, provider),
        loading: true,
      };
      this.publish();
    } catch {
      if (!this.isCurrent(provider, revision)) return;
      this.snapshot = { provider, loading: true };
      this.publish();
    } finally {
      if (this.isCurrent(provider, revision)) {
        this.snapshot = { ...this.snapshot, loading: false };
        this.publish();
      }
    }
  }

  private isCurrent(provider: ProviderName, revision: number) {
    return (
      this.snapshot.provider === provider && this.requestRevision === revision
    );
  }

  private publish() {
    for (const listener of this.listeners) listener();
  }
}
