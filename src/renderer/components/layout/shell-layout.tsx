import { NavLink, useLocation } from 'react-router-dom';

import { useAppState } from '@renderer/app/providers/app-state-context';
import { DownloaderPage } from '@renderer/features/downloader/downloader-page';
import { EditorPage } from '@renderer/features/editor/editor-page';
import { SettingsPage } from '@renderer/features/settings/settings-page';

import headerLogo from '@renderer/assets/yoinkr-header.png';

const navItems = [
  { to: '/downloader', label: 'Downloader', icon: '↓' },
  { to: '/editor', label: 'Editor', icon: '✂' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

export const ShellLayout = (): JSX.Element => {
  const { isLoading, error, bootstrapState, settings } = useAppState();
  const location = useLocation();

  if (isLoading) {
    return <div className="app-loading">Starting Yoinkr...</div>;
  }

  if (error || !bootstrapState || !settings) {
    return <div className="app-loading">Unable to start the app: {error ?? 'Unknown bootstrap error.'}</div>;
  }

  const currentPath = location.pathname;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src={headerLogo} alt="Yoinkr" className="sidebar-logo" />
        </div>

        <nav className="nav-stack">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="main-frame">
        <main className="main-content">
          <div style={{ display: currentPath === '/downloader' ? 'contents' : 'none' }}>
            <DownloaderPage />
          </div>
          <div style={{ display: currentPath === '/editor' ? 'contents' : 'none' }}>
            <EditorPage />
          </div>
          <div style={{ display: currentPath === '/settings' ? 'contents' : 'none' }}>
            <SettingsPage />
          </div>
        </main>
      </div>
    </div>
  );
};
