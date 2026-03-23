import { useEffect, useState } from 'react';

import type { BootstrapState } from '@shared/types/app';
import type { AppSettings } from '@shared/types/settings';

import { yoinkrClient } from '@renderer/lib/api/yoinkr-client';

interface BootstrapStore {
  bootstrapState: BootstrapState | null;
  settings: AppSettings | null;
  isLoading: boolean;
  error: string | null;
  refreshSettings: () => Promise<void>;
  setSettings: (settings: AppSettings) => void;
}

export const useAppBootstrap = (): BootstrapStore => {
  const [bootstrapState, setBootstrapState] = useState<BootstrapState | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshSettings = async (): Promise<void> => {
    const nextSettings = await yoinkrClient.settings.get();
    setSettings(nextSettings);
  };

  useEffect(() => {
    const load = async () => {
      try {
        setIsLoading(true);
        const [nextBootstrapState, nextSettings] = await Promise.all([
          yoinkrClient.app.getBootstrapState(),
          yoinkrClient.settings.get(),
        ]);
        setBootstrapState(nextBootstrapState);
        setSettings(nextSettings);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to start Yoinkr.');
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, []);

  return {
    bootstrapState,
    settings,
    isLoading,
    error,
    refreshSettings,
    setSettings,
  };
};
