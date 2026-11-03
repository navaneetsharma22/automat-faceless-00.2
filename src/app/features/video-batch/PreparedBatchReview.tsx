import type { PreparedVideoBatchRecord } from "../../../domain/batches/types";
import type { createFoundationClient } from "../../../shared/messageClient";
import { FlowPreparedBatchReview } from "./FlowPreparedBatchReview";
import { VidsPreparedBatchReview } from "./VidsPreparedBatchReview";

export type PreparedBatchReviewProps = {
  preparedBatch: PreparedVideoBatchRecord;
  persistenceClient: ReturnType<typeof createFoundationClient>;
  currentVideoSourceHash?: string;
  currentImageSourceBatchId?: string;
};

/** Routes each prepared batch to its platform-specific review and operation path. */
export function PreparedBatchReview(props: PreparedBatchReviewProps) {
  return props.preparedBatch.destination === "Vids"
    ? <VidsPreparedBatchReview key={props.preparedBatch.id} preparedBatch={props.preparedBatch} persistenceClient={props.persistenceClient} />
    : <FlowPreparedBatchReview {...props} />;
}
