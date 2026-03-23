import { EditorScreen } from './editor-screen';
import { useEditorController } from './use-editor-controller';

export const EditorPage = (): JSX.Element => {
  const controller = useEditorController();
  return <EditorScreen controller={controller} />;
};
