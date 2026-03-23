import { useCallback, useMemo, useState } from 'react';

export const useEditorController = () => {
  const [isDragActive, setIsDragActive] = useState(false);

  const onDragEnter = useCallback(() => {
    setIsDragActive(true);
  }, []);

  const onDragLeave = useCallback(() => {
    setIsDragActive(false);
  }, []);

  const onDrop = useCallback(() => {
    setIsDragActive(false);
  }, []);

  const hints = useMemo(
    () => [
      'Future timeline workspace for frame-accurate trim and merge flows.',
      'Drag local video files here once editor file open is connected.',
      'This route is reserved now so Phase 2 can add player, segments, and exports without reworking navigation.',
    ],
    [],
  );

  return {
    isDragActive,
    hints,
    onDragEnter,
    onDragLeave,
    onDrop,
  };
};
