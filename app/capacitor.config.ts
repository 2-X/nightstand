import type { CapacitorConfig } from '@capacitor/cli';

// Live-reload dev mode: CAP_DEV_SERVER=http://<mac-lan-ip>:5173 npx cap copy ios
// makes the installed app load the Vite dev server instead of the bundled
// dist-mobile snapshot, so web changes appear on the device without an Xcode
// rebuild. Run a plain `npx cap copy ios` (no env var) before any real build
// to point the app back at the bundle.
const devServer = process.env.CAP_DEV_SERVER;

const config: CapacitorConfig = {
  appId: 'city.kris.nightstand',
  appName: 'Nightstand',
  webDir: 'dist-mobile',
  // The pod server is plain http on the LAN (192.168.4.54:3000); the Android
  // WebView treats that as mixed content from the https app origin unless
  // explicitly allowed.
  android: {
    allowMixedContent: true,
  },
  server: {
    cleartext: true,
    ...(devServer ? { url: devServer } : {}),
  },
};

export default config;
