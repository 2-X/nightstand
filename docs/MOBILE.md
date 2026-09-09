# Mobile apps (iOS / Android via Capacitor)

The web app in `app/` is the single codebase for all four targets:

- **Desktop web + mobile web**: `npm run build` → served by the pod server from
  `server/public/` (PWA manifest included, installable from the browser).
- **iOS + Android**: Capacitor wraps a self-contained bundle (`dist-mobile/`)
  with the API base URL baked in, since `window.location.origin` is
  `capacitor://localhost` inside the native shell.

## Layout

- `app/capacitor.config.ts` — app id `city.kris.nightstand`, webDir `dist-mobile`
- `app/ios/` — Xcode project (Capacitor 8, Swift Package Manager, no CocoaPods)
- `app/android/` — Gradle project
- `VITE_API_BASE` (set in the `build:mobile` script) points native builds at the
  pod: `http://192.168.4.54:3000`. Change it there if the pod's address changes.

## Build cycle

```sh
cd app
npm run sync:mobile        # build dist-mobile + cap sync into both platforms

# iOS (device install, mirrors the chegus flow)
npx cap open ios           # or xcodebuild + devicectl install

# Android
cd android
JAVA_HOME=/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

Android toolchain on this Mac: brew `openjdk@21` (keg-only, hence the explicit
`JAVA_HOME`) + brew `android-commandlinetools` (SDK root
`/usr/local/share/android-commandlinetools`, written to `android/local.properties`,
which is gitignored).

## Live reload on device

```sh
CAP_DEV_SERVER=http://<mac-lan-ip>:5173 npx cap copy ios   # or android
```

points the installed app at the Vite dev server so web changes appear without a
native rebuild. Run plain `npx cap copy` afterwards to restore the bundled build.

## Plain-http notes

The pod server is http on the LAN, so:

- iOS: `NSAllowsArbitraryLoads` + `NSLocalNetworkUsageDescription` in
  `ios/App/App/Info.plist` (iOS will prompt for Local Network permission on
  first launch).
- Android: `android:usesCleartextTraffic="true"` in the manifest and
  `allowMixedContent` in `capacitor.config.ts`.

Re-running `npx cap add` would regenerate these files without the patches; both
platform dirs are committed, so don't re-add them.
