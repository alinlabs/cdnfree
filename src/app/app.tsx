import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { useSettings } from '../hooks/use-settings';
import { applyThemeToDocument } from '../utils/theme';
import { AppRoutes } from './routes';

export function AppRoot() {
  const { settings } = useSettings();

  useEffect(() => {
    applyThemeToDocument(settings.theme);
  }, [settings.theme]);

  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default AppRoot;
