import { createContext, useContext } from 'react';

import type { AppSettings } from '@shared/types/settings';

import { useAppBootstrap } from '@renderer/stores/use-app-bootstrap';

type AppBootstrapState = ReturnType<typeof useAppBootstrap>;

export type AppStateValue = AppBootstrapState & {
  applySettings: (settings: AppSettings) => void;
};

export const AppStateContext = createContext<AppStateValue | null>(null);

export const useAppState = (): AppStateValue => {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error('useAppState must be used inside AppStateProvider.');
  }

  return context;
};
