import { useEffect, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { SplashIntro } from '../components/splash-intro';
import { useSettings } from '../hooks/use-settings';
import { applyThemeToDocument } from '../utils/theme';
import { AppRoutes } from './routes';

export function AppRoot() {
  const { settings } = useSettings();
  const [splashComplete, setSplashComplete] = useState(false);

  useEffect(() => {
    applyThemeToDocument(settings.theme);
  }, [settings.theme]);

  return (
    <BrowserRouter>
      {splashComplete ? (
        <AppRoutes />
      ) : (
        <SplashIntro onComplete={() => setSplashComplete(true)} />
      )}
    </BrowserRouter>
  );
}

export default AppRoot;
