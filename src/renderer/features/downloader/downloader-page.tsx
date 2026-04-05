import { useAppState } from '@renderer/app/providers/app-state-context';

import { DownloaderScreen } from './downloader-screen';
import { useDownloaderController } from './use-downloader-controller';

export const DownloaderPage = (): JSX.Element => {
  const { settings } = useAppState();
  const controller = useDownloaderController({
    maxConcurrentDownloads: settings?.maxConcurrentDownloads ?? 2,
    downloadThrottleMode: settings?.downloadThrottleMode ?? false,
  });
  return <DownloaderScreen controller={controller} />;
};
