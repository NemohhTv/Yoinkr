import type { ReactNode } from 'react';

import { useAppBootstrap } from '@renderer/stores/use-app-bootstrap';
import { AppStateContext } from './app-state-context';

export const AppStateProvider = ({ children }: { children: ReactNode }): JSX.Element => {
  const bootstrapState = useAppBootstrap();

  return (
    <AppStateContext.Provider
      value={{
        ...bootstrapState,
        applySettings: bootstrapState.setSettings,
      }}
    >
      {children}
    </AppStateContext.Provider>
  );
};
