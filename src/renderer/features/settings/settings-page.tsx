import { SettingsScreen } from './settings-screen';
import { useSettingsController } from './use-settings-controller';

export const SettingsPage = (): JSX.Element => {
  const controller = useSettingsController();
  return <SettingsScreen controller={controller} />;
};
