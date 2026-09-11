# Sensor coverage release 3.4.0

This release addresses the September 10 component audit. Deployment is a separate step; a successful local build does not verify the live Pod.

## Implemented

- Seven existing firmware streams are normalized into `/api/sensors`: hub temperatures, pumps/water/fans/TEC reports, thermal-controller state, cover temperatures/humidity, cover connections, blanket-connector orientation, and capacitance health. No raw waveforms or logs enter this API.
- `/sensors` shows source age, missing/stale channels, unavailable fields, and latest stored biometric-estimate freshness. Status and adaptive temperature link to it. Structured hardware history samples each kind at most once per minute, retains 90 days, and supports a bounded 24-hour JSON export. Existing private RAW retention remains 36 hours.
- Adaptive writes additionally require fresh, valid cover temperatures, a connected cover and enabled/valid thermal-controller reports for that side. Existing manual-override priority and Observe mode remain intact.
- Pump monitoring uses commanded power, explicit water detection and fresh RPM, reports unknown when evidence is missing, refreshes healthy status, and excludes duplicate/replayed samples from dwell counters. It does not issue an automatic power-off command.
- Cached hub temperatures expire instead of being collected as new measurements.
- HRV/breathing windows require continuous 500 Hz records and established presence. Eligibility no longer depends on being the dominant side. Per-metric timestamps prevent stale estimates being saved as current; unavailable estimates are SQL NULL and UI unavailable rather than physiological zero. HRV is labeled SDNN.
- Noon analysis covers the preceding calendar day, including the previous evening and daylight-saving transitions. Sleep stages remain estimates.

## Validation

Server: 456 tests passed; UI: 172 tests passed. Python suite: 177 tests passed before final defensive normalizer and comment cleanup; final affected tests passed (17 pump, 4 telemetry, 1 stream-window). A plain system-Python full rerun lacked scientific dependencies; this is not an additional full-suite pass. Both production builds and typechecks passed; lint has existing warnings but no errors. A temporary SQLite migration check preserved existing rows, accepted nullable metrics, enforced unique history timestamps and passed integrity_check. Synthetic browser inspection confirmed missing/stale/unavailable rendering.

A read-only, low-priority replay inside the Pod tested the changed eligibility against recent RAW records, with all writes/control calls disabled. It confirmed newly eligible HRV attempts and some accepted breathing estimates. HRV attempts still failed the existing HeartPy signal-quality checks. This release does not weaken those checks or claim positive HRV has been verified. No raw waveform was exported.

## Still requires live verification

Deploy committed code using `ops/deploy.sh` while the bed is idle. Verify the additive migration, fresh advancing sensor snapshots, history persistence, unchanged Observe mode, and stream/server health. Verify overnight accepted HRV and breathing separately; live heart rate alone does not validate those metrics.

Physical button identity/override behavior, vibration, LEDs, optional accessory inventory, empty-bed calibration and measured thermal response require a suitable physical test session. Connector flags cannot establish accessory installation. Legacy calibration provenance cannot be recreated without collecting a new known empty-bed baseline. No additional firmware update is justified by this audit.
