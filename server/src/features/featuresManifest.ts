import { defaultFeatures } from '../db/settingsSchema.js';

// The feature inventory. releases.json names its features from these ids,
// so an id is never renamed. Not imported by the app bundle.
//
// Rule: an optional feature ships behind a Features toggle in the relevant Settings category, with
// flag set to its settings.features key and default matching
// defaultFeatures. A behavior controlled by another setting names that
// setting in flag as prose (biometrics, daily reboot, RAW archive retention),
// as does one gated by hardware (base control). Always-on work carries
// flag: null and says why in rationale.
type ManifestEntry = {
  id: string;
  title: string;
  description: string;
  category: 'platform' | 'safety' | 'ui' | 'biometrics';
  version: string; // the version whose work finalized this entry's current state
  flag: keyof typeof defaultFeatures | null | string;
  default: boolean | 'n/a';
  touchpoints: string[];
  depends_on: string[];
  reversible: boolean;
  tests: string[];
  upstream_offer: boolean;
  rationale: string;
};

export const FEATURES_MANIFEST: ManifestEntry[] = [
  {
    id: 'agent',
    title: 'Updates and rollback',
    description: 'In-app updates, rollback, revert to stock, and the Settings > Software & updates page. The floor every other feature sits on.',
    category: 'platform',
    version: '3.0.0',
    flag: null,
    default: true,
    touchpoints: ['scripts/update.sh', 'scripts/rollback_pod.sh', 'app/src/pages/SettingsPage/VersionsPage'],
    depends_on: [],
    reversible: false,
    tests: ['server/src/updaterScripts.test.ts', 'server/src/rollbackScript.test.ts'],
    upstream_offer: false,
    rationale: 'Always on, not individually removable: it is what makes everything else installable and reversible.',
  },
  {
    id: 'no-telemetry',
    title: 'No telemetry',
    description: 'Sentry removed entirely from server, app, and python. No error-reporting dependency anywhere in the tree.',
    category: 'platform',
    version: '3.0.0',
    flag: null,
    default: true,
    touchpoints: [],
    depends_on: ['agent'],
    reversible: false,
    tests: [],
    upstream_offer: true,
    rationale: 'An absence, not a code path: baseline, nothing to gate, nothing to toggle.',
  },
  {
    id: 'security-hardening',
    title: 'Security hardening',
    description: 'CORS scoped to the LAN subnet, execute-route numeric argument bounds.',
    category: 'safety',
    version: '3.0.0',
    flag: null,
    default: true,
    touchpoints: ['server/src/setup/middleware.ts', 'server/src/routes/execute/executeHelpers.ts'],
    depends_on: ['agent'],
    reversible: false,
    tests: [],
    upstream_offer: true,
    rationale: 'A correctness and safety fix, not a preference. Turning it off would just be shipping a known gap.',
  },
  {
    id: 'franken-hardening',
    title: 'Franken hardening',
    description: 'Per-command timeouts on the Franken socket, the /metrics/server endpoint, connection monitoring.',
    category: 'platform',
    version: '3.0.0',
    flag: null,
    default: true,
    touchpoints: ['server/src/8sleep/frankenServer.ts', 'server/src/routes/metricsServer'],
    depends_on: ['agent'],
    reversible: false,
    tests: [],
    upstream_offer: false,
    rationale: 'Infrastructure hardening against a wedged hardware socket. Baseline for the same reason as security-hardening.',
  },
  {
    id: 'websocket-live-updates',
    title: 'Real-time WebSocket updates',
    description: 'Push device-status, service-health, and job events over /ws/events instead of only polling.',
    category: 'platform',
    version: '3.0.0',
    flag: null,
    default: true,
    touchpoints: ['server/src/ws/wsServer.ts', 'app/src/api/eventStream.ts'],
    depends_on: ['agent'],
    reversible: true,
    tests: ['server/src/ws/wsServer.test.ts'],
    upstream_offer: false,
    rationale: 'Considered a real flag (features.ws), then reclassified baseline: a user gains '
      + 'nothing from turning off real-time updates, since the automatic polling fallback '
      + 'already covers any disconnection, and it is not restart-hot-swappable the way the '
      + 'other flags are.',
  },
  {
    id: 'biometrics',
    title: 'Biometrics',
    description: 'Heart rate, HRV, breathing rate, and presence detection from the piezo stream, plus every accuracy fix within that subsystem.',
    category: 'biometrics',
    version: '3.0.0',
    flag: 'services.biometrics.enabled',
    default: false,
    touchpoints: ['server/src/db/servicesSchema.ts', 'server/src/jobs/biometrics.ts', 'app/src/pages/SettingsPage/FeaturesSection'],
    depends_on: ['agent'],
    reversible: true,
    tests: ['server/src/db/services.test.ts'],
    upstream_offer: false,
    rationale: 'Real, existing, user-facing toggle, but with install-precondition and '
      + 'systemd-stop side effects a plain settings.features boolean does not fit, so it '
      + 'stays in its own store rather than joining FeaturesSchema. One coarse feature, not '
      + 'many: the presence-accuracy fixes within it are baseline correctness, not '
      + 'separately toggleable.',
  },
  {
    id: 'sleep-stages-score',
    title: 'Sleep score and stages',
    description: 'The estimated sleep score and sleep-stages chart on the Sleep page.',
    category: 'biometrics',
    version: '3.1.0',
    flag: 'sleepScore',
    default: true,
    touchpoints: [
      'server/src/routes/metrics/sleepScore.ts', 'server/src/routes/metrics/sleepStages.ts',
      'app/src/components/SleepFitnessCard.tsx', 'app/src/components/SleepStagesCard.tsx',
    ],
    depends_on: ['biometrics'],
    reversible: true,
    tests: ['server/src/routes/metrics/sleepScoreGuard.test.ts'],
    upstream_offer: false,
    rationale: 'The clearest real dependency edge in the set: neither route had '
      + 'depends_on-biometrics enforcement before 3.1.0, both always fabricated a result '
      + 'from whatever window they were given even with no real measurements behind it.',
  },
  {
    id: 'honest-status',
    title: 'Honest status',
    description: 'Status page shows waiting_for_data and calibration-skip as calm states, not failures; false-alarm fixes.',
    category: 'safety',
    version: '3.0.0',
    flag: null,
    default: true,
    touchpoints: ['app/src/pages/StatusPage'],
    depends_on: ['agent'],
    reversible: false,
    tests: [],
    upstream_offer: false,
    rationale: 'Baseline, always on, but shows less when biometrics is off: some rows only mean anything with real biometrics data behind them.',
  },
  {
    id: 'level-temperature-display',
    title: 'Level temperature display',
    description: 'The -10 to +10 level option in the temperature format picker.',
    category: 'ui',
    version: '3.1.0',
    flag: 'levelTemps',
    default: true,
    touchpoints: [
      'app/src/pages/SettingsPage/DeviceSettingsSection/TemperatureFormatSelector.tsx',
      'server/src/routes/settings/settingsGuards.ts',
    ],
    depends_on: ['agent'],
    reversible: true,
    tests: ['server/src/routes/settings/settingsGuards.test.ts'],
    upstream_offer: false,
    rationale: 'Real toggle, not just a display preference: the temperatureFormat setting '
      + 'already existed, this gates whether level is offered as a legal choice at all, '
      + 'with a server precondition against disabling it while a pod is actively using it.',
  },
  {
    id: 'one-off-alarms',
    title: 'One-off alarms',
    description: 'Single-fire alarms, separate from the recurring per-day alarm.',
    category: 'ui',
    version: '3.1.0',
    flag: 'oneOffAlarms',
    default: true,
    touchpoints: ['app/src/pages/SchedulePage/OneOffAlarmSection.tsx', 'server/src/jobs/jobScheduler.ts', 'server/src/jobs/alarmScheduler.ts'],
    depends_on: ['agent'],
    reversible: true,
    tests: [],
    upstream_offer: false,
    rationale: 'Turning it off hides the section and stops scheduling new checks; a '
      + 'previously-armed alarm\'s stored data is untouched, so re-enabling re-arms it '
      + 'without any migration.',
  },
  {
    id: 'design-system',
    title: 'Design system',
    description: 'Geist font, glass-card look, applied app-wide.',
    category: 'ui',
    version: 'n/a',
    flag: null,
    default: true,
    touchpoints: ['app/src/theme.ts', 'app/src/design/GlassCard.tsx'],
    depends_on: ['agent'],
    reversible: false,
    tests: [],
    upstream_offer: false,
    rationale: 'Always on. A features.nightstandTheme key exists in settings from 3.1.0, '
      + 'but nothing reads it and Settings does not show it; it stays in the schema so '
      + 'stored settings keep validating. A real toggle would need a second whole theme.',
  },
  {
    id: 'logs-viewer',
    title: 'Logs viewer',
    description: 'The Logs page and its live-tail API.',
    category: 'platform',
    version: '3.1.0',
    flag: null,
    default: 'n/a',
    touchpoints: ['app/src/pages/DataPage/LogsPage/LogsPage.tsx', 'server/src/routes/logs/logs.ts'],
    depends_on: ['agent'],
    reversible: false,
    tests: ['server/src/routes/logs/logsHelpers.test.ts'],
    upstream_offer: false,
    rationale: 'Baseline, not a toggle. This shipped as a flag that also had the log API '
      + 'refuse a direct request, on the reasoning that an operator might want logs '
      + 'unreadable. That reasoning does not hold here: there is one operator, who is '
      + 'the owner, and logs are how this pod gets diagnosed when something breaks. A '
      + 'switch whose only effect is to hide the evidence from the person debugging is '
      + 'not a feature. Retired 2026-07-16.',
  },
  {
    id: 'base-control',
    title: 'Adjustable base control',
    description: 'BLE control for an adjustable base, auto-hides when none is configured.',
    category: 'platform',
    version: '3.0.0',
    flag: 'auto: /persistent/AdjustableBaseConfiguration.json presence',
    default: 'n/a',
    touchpoints: ['server/src/8sleep/trimixBaseControl.ts', 'app/src/components/Navbar.tsx'],
    depends_on: ['agent'],
    reversible: true,
    tests: [],
    upstream_offer: false,
    rationale: 'Auto-gated by hardware presence, not a user-settable flag. Low priority: '
      + 'hardware not present on this pod, first candidate to drop if it stops being a clean '
      + 'dormant feature.',
  },
  {
    id: 'presence-auto-off',
    title: 'Presence auto-off',
    description: 'Turns a side off after 45 minutes with no one on it, outside its scheduled on-window.',
    category: 'biometrics',
    version: '3.4.0',
    flag: 'presenceAutoOff',
    default: true,
    touchpoints: ['server/src/8sleep/presenceAutoOffMonitor.ts', 'app/src/pages/SettingsPage/FeaturesSection'],
    depends_on: ['biometrics'],
    reversible: true,
    tests: ['server/src/8sleep/presenceAutoOffMonitor.test.ts'],
    upstream_offer: false,
    rationale: 'On by default so existing pods behave as before. Needs presence from '
      + 'biometrics and holds whenever presence is unknown, so it never acts without it. '
      + 'Off keeps tracking state, so turning it back on mid-session measures idle time '
      + 'correctly.',
  },
  {
    id: 'daily-reboot',
    title: 'Daily reboot',
    description: 'Restarts the pod an hour before daily priming.',
    category: 'platform',
    version: '3.4.0',
    flag: 'settings.rebootDaily',
    default: true,
    touchpoints: ['server/src/jobs/primeScheduler.ts', 'app/src/pages/SettingsPage/DailyPriming.tsx'],
    depends_on: ['agent'],
    reversible: true,
    tests: [],
    upstream_offer: false,
    rationale: 'A setting since upstream 2.x with no control in the app until 3.4.0. It is '
      + 'scheduled with daily priming, so it only runs while priming is on, and the control '
      + 'sits with priming for that reason.',
  },
  {
    id: 'raw-archive-retention',
    title: 'RAW archive retention',
    description: 'Keeps overnight sensor files past the firmware\'s rolling buffer for a set number of days.',
    category: 'biometrics',
    version: '3.3.0',
    flag: 'settings.rawArchiveRetentionDays',
    default: 'n/a',
    touchpoints: [
      'scripts/archive-raw.sh', 'server/src/jobs/rawArchiveConf.ts',
      'app/src/pages/SettingsPage/DeviceSettingsSection/RawArchiveRetention.tsx',
    ],
    depends_on: ['biometrics'],
    reversible: true,
    tests: [],
    upstream_offer: false,
    rationale: 'A number of days rather than on or off. Without the archive the daily sleep '
      + 'analysis sees only the last ~75 minutes of data, so it is not offered as a switch.',
  },
  {
    id: 'water-tank-status',
    title: 'Water tank status',
    description: 'A Status page entry for the water tank level, with its last change recorded.',
    category: 'ui',
    version: '3.3.0',
    flag: null,
    default: true,
    touchpoints: ['server/src/8sleep/waterLevelTracker.ts', 'app/src/pages/StatusPage/statusMeta.ts'],
    depends_on: ['agent'],
    reversible: false,
    tests: [],
    upstream_offer: false,
    rationale: 'Always on: a read-only status row with nothing to turn off.',
  },
  {
    id: 'service-memory-limits',
    title: 'Service memory limits',
    description: 'Memory caps for the Nightstand services so a runaway job cannot take memory from the pod\'s firmware.',
    category: 'safety',
    version: '3.3.0',
    flag: null,
    default: true,
    touchpoints: ['scripts/setup_resource_limits.sh'],
    depends_on: ['agent'],
    reversible: true,
    tests: ['server/src/resourceLimitsScript.test.ts'],
    upstream_offer: false,
    rationale: 'Always on, as a safety measure. Revert to stock removes the limits.',
  },

  {
    id: 'primary-navigation',
    title: 'Named primary navigation',
    description: 'Bed, Schedule, Sleep and Settings links follow the current page and support browser history.',
    category: 'ui',
    version: '3.3.1',
    flag: null,
    default: true,
    touchpoints: ['app/src/components/Navbar.tsx', 'app/src/AppRoutes.tsx'],
    depends_on: ['agent'],
    reversible: false,
    tests: ['app/src/components/Navbar.test.tsx', 'app/e2e/navigation.spec.ts'],
    upstream_offer: false,
    rationale: 'Navigation is required to reach the application pages.',
  },
  {
    id: 'system-status-summary',
    title: 'Service status summary',
    description: 'System groups service states and shows errors before healthy details.',
    category: 'ui',
    version: '3.3.1',
    flag: null,
    default: true,
    touchpoints: ['app/src/pages/StatusPage'],
    depends_on: ['agent'],
    reversible: false,
    tests: ['app/src/pages/StatusPage/StatusPage.test.tsx'],
    upstream_offer: false,
    rationale: 'Service errors must remain visible without an optional display setting.',
  },
  {
    id: 'log-connection-status',
    title: 'Log connection status',
    description: 'Logs show live, paused and disconnected states and replace replayed tails on reconnect.',
    category: 'ui',
    version: '3.3.1',
    flag: null,
    default: true,
    touchpoints: ['app/src/pages/DataPage/LogsPage'],
    depends_on: ['agent'],
    reversible: false,
    tests: ['app/src/pages/DataPage/LogsPage/LogsPage.connection.test.tsx'],
    upstream_offer: false,
    rationale: 'Connection state is needed to interpret the displayed log lines.',
  },
  {
    id: 'calibration-confirmation',
    title: 'Manual calibration confirmation',
    description: 'Manual presence calibration asks the user to leave the selected side empty.',
    category: 'ui',
    version: '3.3.1',
    flag: null,
    default: true,
    touchpoints: ['app/src/pages/StatusPage/StatusRow.tsx'],
    depends_on: ['agent'],
    reversible: false,
    tests: ['app/src/pages/StatusPage/StatusRow.test.tsx'],
    upstream_offer: false,
    rationale: 'The occupancy precondition applies whenever manual calibration is requested.',
  },
];
