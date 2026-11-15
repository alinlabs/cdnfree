import { useEffect, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { SplashIntro } from '../components/splash-intro';
import { useSettings } from '../hooks/use-settings';
import { useSmartCacheSwBootstrap } from '../hooks/use-smart-cache-sw';
import { applyThemeToDocument } from '../utils/theme';
import { AppRoutes } from './routes';

function shouldSkipSplashOnBoot(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('autostart') === '1';
  } catch {
    return false;
  }
}

export function AppRoot() {
  const { settings } = useSettings();
  const [splashComplete, setSplashComplete] = useState(shouldSkipSplashOnBoot);
  useSmartCacheSwBootstrap();

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
