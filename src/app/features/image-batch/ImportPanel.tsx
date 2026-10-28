import { ImportPanel as SharedImportPanel } from "../shared/ImportPanel";
import type { ImportPreviewSession } from "../shared/importPreviewSession";

export function ImageImportPanel({
  session,
  exampleSource,
  wrapLines,
  setWrapLines,
  editorExpanded,
  setEditorExpanded,
}: {
  session: ImportPreviewSession;
  exampleSource: string;
  wrapLines: boolean;
  setWrapLines: (value: boolean) => void;
  editorExpanded: boolean;
  setEditorExpanded: (value: boolean) => void;
}) {
  return (
    <SharedImportPanel
      kind="image"
      session={session}
      exampleSource={exampleSource}
      wrapLines={wrapLines}
      setWrapLines={setWrapLines}
      editorExpanded={editorExpanded}
      setEditorExpanded={setEditorExpanded}
    />
  );
}
