import { ImportPanel as SharedImportPanel } from "../shared/ImportPanel";
import type { ImportPreviewSession } from "../shared/importPreviewSession";
import type { FoundationClient } from "../../../shared/messageClient";

export function ImageImportPanel({
  session,
  exampleSource,
  wrapLines,
  setWrapLines,
  editorExpanded,
  setEditorExpanded,
  workspaceId,
  persistenceClient,
}: {
  session: ImportPreviewSession;
  exampleSource: string;
  wrapLines: boolean;
  setWrapLines: (value: boolean) => void;
  editorExpanded: boolean;
  setEditorExpanded: (value: boolean) => void;
  workspaceId: string;
  persistenceClient: FoundationClient;
}) {
  return (
    <SharedImportPanel
      kind="image"
      workspaceId={workspaceId}
      persistenceClient={persistenceClient}
      session={session}
      exampleSource={exampleSource}
      wrapLines={wrapLines}
      setWrapLines={setWrapLines}
      editorExpanded={editorExpanded}
      setEditorExpanded={setEditorExpanded}
    />
  );
}
