import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';

import { ShellLayout } from '@renderer/components/layout/shell-layout';
import { DownloaderPage } from '@renderer/features/downloader/downloader-page';
import { EditorPage } from '@renderer/features/editor/editor-page';
import { SettingsPage } from '@renderer/features/settings/settings-page';

export const AppRouter = (): JSX.Element => (
  <HashRouter>
    <Routes>
      <Route element={<ShellLayout />}>
        <Route path="/" element={<Navigate to="/downloader" replace />} />
        <Route path="/downloader" element={<DownloaderPage />} />
        <Route path="/editor" element={<EditorPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  </HashRouter>
);
