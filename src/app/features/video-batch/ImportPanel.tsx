import { ImportPanel as SharedImportPanel } from "../shared/ImportPanel";
import type { ImportPreviewSession } from "../shared/importPreviewSession";
import type { FoundationClient } from "../../../shared/messageClient";

export function VideoImportPanel({
  session,
  wrapLines,
  setWrapLines,
  editorExpanded,
  setEditorExpanded,
  workspaceId,
  persistenceClient,
  onSourceReadinessChange,
}: {
  session: ImportPreviewSession;
  wrapLines: boolean;
  setWrapLines: (value: boolean) => void;
  editorExpanded: boolean;
  setEditorExpanded: (value: boolean) => void;
  workspaceId: string;
  persistenceClient: FoundationClient;
  onSourceReadinessChange?: (
    ready: boolean,
    savedSource?: string,
    shotIds?: string[],
  ) => void;
}) {
  return (
    <SharedImportPanel
      kind="video"
      workspaceId={workspaceId}
      persistenceClient={persistenceClient}
      session={session}
      wrapLines={wrapLines}
      setWrapLines={setWrapLines}
      editorExpanded={editorExpanded}
      setEditorExpanded={setEditorExpanded}
      onVideoSourceReadinessChange={onSourceReadinessChange}
    />
  );
}
