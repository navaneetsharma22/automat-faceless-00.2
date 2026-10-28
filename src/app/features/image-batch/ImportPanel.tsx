import { ImportPanel as SharedImportPanel } from "../shared/ImportPanel";
import type { ImportPreviewSession } from "../shared/importPreviewSession";
import type { FoundationClient } from "../../../shared/messageClient";
import type { FlowSettingsConfirmation } from "../../../shared/schemas";

export function ImageImportPanel({
  session,
  exampleSource,
  wrapLines,
  setWrapLines,
  editorExpanded,
  setEditorExpanded,
  workspaceId,
  persistenceClient,
  settingsConfirmation,
}: {
  session: ImportPreviewSession;
  exampleSource: string;
  wrapLines: boolean;
  setWrapLines: (value: boolean) => void;
  editorExpanded: boolean;
  setEditorExpanded: (value: boolean) => void;
  workspaceId: string;
  persistenceClient: FoundationClient;
  settingsConfirmation?: FlowSettingsConfirmation;
}) {
  return (
    <SharedImportPanel
      kind="image"
      workspaceId={workspaceId}
      persistenceClient={persistenceClient}
      flowSettingsConfirmed={settingsConfirmation !== undefined}
      flowSettingsConfirmation={settingsConfirmation}
      session={session}
      exampleSource={exampleSource}
      wrapLines={wrapLines}
      setWrapLines={setWrapLines}
      editorExpanded={editorExpanded}
      setEditorExpanded={setEditorExpanded}
    />
  );
}
