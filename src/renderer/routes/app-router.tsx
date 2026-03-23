import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';

import { ShellLayout } from '@renderer/components/layout/shell-layout';

export const AppRouter = (): JSX.Element => (
  <HashRouter>
    <Routes>
      <Route element={<ShellLayout />}>
        <Route path="/" element={<Navigate to="/downloader" replace />} />
        <Route path="/downloader" element={null} />
        <Route path="/editor" element={null} />
        <Route path="/settings" element={null} />
      </Route>
    </Routes>
  </HashRouter>
);
