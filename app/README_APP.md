# App documentation

## Overview
This application is a React frontend for managing an Eight Sleep Pod's settings, schedules,
and temperature controls.
It communicates with the server's REST API and WebSocket stream to fetch, update, and
synchronize data.
The app uses Material-UI for styling and layout, Zustand for local state, and React Query
for server-state fetching and caching.


## Developing
1. **Optional**: If you also want to make changes to the back-end server at the same time, setup the back-end server to run in hot reload mode [server/README_SERVER.md](../server/README_SERVER.md#Developing)
1. Run vite hot reloading and specify the IP address for your Pod. This tells axios to make API requests at a different IP (see [src/api/api.ts](src/api/api.ts))
- `VITE_POD_IP=<YOUR_POD_IP> npm run dev`
- `VITE_POD_IP=192.168.1.50 npm run dev`

---

## Key features
- **Temperature control**: Adjust each side's target temperature with a circular slider.
- **Scheduling**: Set and manage daily schedules for power on/off, temperature, and alarms.
- **Alarms**: Scheduled daily alarms and one-off alarms, with vibration intensity, pattern,
  and duration, plus override and dismissal handling.
- **Settings**: Update timezone, enable/disable away mode, and configure daily priming.
- **Elevation (Pod 4+)**: Adjust the adjustable base's head/foot position with presets or
  manual control. Hidden automatically on pods with no adjustable base configured.
- **Device status**: Monitor and update the Pod's operational status; a status page shows
  the health of each server-side service.
- **Sleep and vitals data**: Charts for heart rate, HRV, breathing rate, movement, and
  sleep stages, plus a log viewer and an in-app changelog.
- **Software updates**: Channel picker, per-release install, and instant rollback, driven by
  the server's update system.
- **Multi-side control**: Configure settings independently for the left and right sides.

---

## Directory structure

### Main application files
- `main.tsx`: Entry point. Mounts the provider stack (React Query, theme, date
  localization, `AppStoreProvider`, router) and renders `AppRoutes`.
- `AppRoutes.tsx`: Route definitions, one lazy-loaded page per route.
- `vite-env.d.ts`: Type definitions for the Vite environment.

### State management
- `state/appStore.tsx`: Global state using Zustand, currently the selected
  side and an `isUpdating` flag synced from React Query's fetching state.

### API
- `api/`: One file per server resource, plus shared Zod schemas re-exported
  from the server's own schema files where the shapes must match exactly
  (device status, settings, schedules, storage, memory, calibration,
  changelog). Covers device status, settings, schedules, alarms, base
  control, sleep/vitals/movement/presence metrics, logs, server status,
  storage, memory, calibration, changelog, updates, timezones, and
  `eventStream.ts` (the WebSocket client for `/ws/events`).

### Components
- `Layout`: Root layout, renders the routed page plus the bottom navigation.
- `Navbar`: Bottom navigation bar; hides the Elevation tab when no adjustable
  base is configured and shows a "Reconnecting" tag when the WebSocket drops.
- `PageContainer`: Standardized container for page content.
- Chart and status components for the Sleep/Vitals pages
  (`SleepBarChart`, `VitalsLineChart`, `SleepStagesCard`, etc.).

### Pages
- **ControlTempPage**: Real-time temperature adjustment (slider, power
  button, away-mode and alarm notifications).
- **BaseControlPage**: Adjustable-base position control (Pod 4+).
- **SettingsPage**: Timezone, away mode, daily priming, and the versions/update screen.
- **SchedulePage**: Daily schedules (power, temperature, alarms), with apply-to-multiple-days support.
- **DataPage**: Sleep charts, vitals, and the log viewer.
- **StatusPage**: Health of each server-side service.

---

## State management
The app uses:
1. **Zustand**: For local, client-only state (selected side, update-in-progress flag).
2. **React Query**: For fetching and caching server data, with automatic refetching, retries,
   and cache updates driven by the WebSocket event stream.

---

## API integration
- **React Query** manages API interactions, including optimistic updates and error handling.
- Axios provides the underlying HTTP client setup in `api/api.ts`.
- A native `WebSocket` client (`api/eventStream.ts`) pushes device-status, service-health, and
  job events into the React Query cache; it reconnects with backoff and each hook falls back to
  its own polling interval while the socket is down.

---

## Themes and styles
- **Material-UI**: Provides theming and components.

---

## Error handling
- **Device status errors**: Prompts the user to retry fetching status.
- **Schedule validation**: Ensures times and temperatures are within valid ranges.

---

## Extensibility
- Add new pages by adding a lazy import and a route in `AppRoutes.tsx`.

---

## License and disclaimer
The app is open source under the MIT License. For full terms, see the license modal in the
settings page.
