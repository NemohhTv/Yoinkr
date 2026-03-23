import { AppStateProvider } from './providers/app-state-provider';
import { AppRouter } from '@renderer/routes/app-router';

export const App = (): JSX.Element => (
  <AppStateProvider>
    <AppRouter />
  </AppStateProvider>
);
