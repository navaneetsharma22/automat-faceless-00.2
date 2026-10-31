import { ImportPanel as SharedImportPanel } from "../shared/ImportPanel";
import type { ImportPreviewSession } from "../shared/importPreviewSession";
import type { FoundationClient } from "../../../shared/messageClient";
import type { FlowSettingsConfirmation } from "../../../shared/schemas";

export function ImageImportPanel({
  session,
  wrapLines,
  setWrapLines,
  editorExpanded,
  setEditorExpanded,
  workspaceId,
  persistenceClient,
  settingsConfirmation,
  onSourceReadinessChange,
}: {
  session: ImportPreviewSession;
  wrapLines: boolean;
  setWrapLines: (value: boolean) => void;
  editorExpanded: boolean;
  setEditorExpanded: (value: boolean) => void;
  workspaceId: string;
  persistenceClient: FoundationClient;
  settingsConfirmation?: FlowSettingsConfirmation;
  onSourceReadinessChange: (
    ready: boolean,
    savedSource?: string,
    shotIds?: string[],
  ) => void;
}) {
  return (
    <SharedImportPanel
      kind="image"
      workspaceId={workspaceId}
      persistenceClient={persistenceClient}
      flowSettingsConfirmed={settingsConfirmation !== undefined}
      flowSettingsConfirmation={settingsConfirmation}
      onImageSourceReadinessChange={onSourceReadinessChange}
      session={session}
      wrapLines={wrapLines}
      setWrapLines={setWrapLines}
      editorExpanded={editorExpanded}
      setEditorExpanded={setEditorExpanded}
    />
  );
}
