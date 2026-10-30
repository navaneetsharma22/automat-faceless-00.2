import { ImportPanel as SharedImportPanel } from "../shared/ImportPanel";
import type { ImportPreviewSession } from "../shared/importPreviewSession";
import type { FoundationClient } from "../../../shared/messageClient";
import type { FlowSettingsConfirmation } from "../../../shared/schemas";
import type { ReactNode } from "react";

export function ImageImportPanel({
  session,
  wrapLines,
  setWrapLines,
  editorExpanded,
  setEditorExpanded,
  workspaceId,
  persistenceClient,
  settingsConfirmation,
  legacyFlowSetup,
}: {
  session: ImportPreviewSession;
  legacyFlowSetup: ReactNode;
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
      legacyFlowSetup={legacyFlowSetup}
      session={session}
      wrapLines={wrapLines}
      setWrapLines={setWrapLines}
      editorExpanded={editorExpanded}
      setEditorExpanded={setEditorExpanded}
    />
  );
}
