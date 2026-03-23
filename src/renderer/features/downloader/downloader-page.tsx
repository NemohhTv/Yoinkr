import { DownloaderScreen } from './downloader-screen';
import { useDownloaderController } from './use-downloader-controller';

export const DownloaderPage = (): JSX.Element => {
  const controller = useDownloaderController();
  return <DownloaderScreen controller={controller} />;
};
