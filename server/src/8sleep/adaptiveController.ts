import { sensorState } from './sensorState.js';
import type { DeviceStatus } from '../routes/deviceStatus/deviceStatusSchema.js';
import settingsDB from '../db/settings.js';
import servicesDB from '../db/services.js';
import serverStatus from '../serverStatus.js';
import { prisma } from '../db/prisma.js';
import logger from '../logger.js';
import { getPresenceData } from '../routes/metrics/presence.js';
import { getDeviceStatusCoalesced } from './frankenServer.js';
import { updateDeviceStatus } from '../routes/deviceStatus/updateDeviceStatus.js';
import { adaptiveStore } from './adaptiveState.js';
import { proposeTemperature, ThermalSide, ThermalDecision, ThermalContext } from './adaptivePolicy.js';

export interface CirculationSample {
  at: number; left: boolean; right: boolean;
  readings?: Record<ThermalSide, { rpm: number | null; water: boolean | null }>;
}
let circulation: CirculationSample | null = null;
export function acceptCirculation(sample: CirculationSample): void {
  // Accept only increasing source timestamps, never make replay look current.
  if (sample.at <= Date.now() && Date.now() - sample.at <= 30000 && (!circulation || sample.at > circulation.at)) circulation = sample;
}
const presentSince: Record<ThermalSide, number | null> = { left: null, right: null };
export const adaptiveDecisions: Record<ThermalSide, ThermalDecision> = {
  left: { kind: 'hold', reason: 'starting' }, right: { kind: 'hold', reason: 'starting' },
};
let timer: ReturnType<typeof setInterval> | undefined;
let busy = false;
let stopped = true;
let lastTick = 0;
const fresh = (timestamp: string | undefined, maximumAge: number): boolean => {
  const epoch = Date.parse(timestamp ?? '');
  return Number.isFinite(epoch) && epoch <= Date.now() && Date.now() - epoch <= maximumAge;
};
function hardwareReady(side: ThermalSide): boolean {
  const button = serverStatus.status.buttonMonitor;
  const monitor = serverStatus.status.frankenMonitor;
  return sensorState.ready(side) && !!circulation && circulation[side] && Date.now() - circulation.at <= 30000 &&
    circulation.at <= Date.now() && button.status === 'healthy' && fresh(button.timestamp, 15000) &&
    settingsDB.data.features.coverButtons && monitor.status === 'healthy' && fresh(monitor.timestamp, 15000);
}
export function adaptiveStatus() {
  return { fault: adaptiveStore.fault, circulation, sensors: sensorState.snapshot(),
    left: { ...adaptiveStore.data.left, decision: adaptiveDecisions.left },
    right: { ...adaptiveStore.data.right, decision: adaptiveDecisions.right }, observations: adaptiveStore.data.events.length,
    sleepInput: 'Sustained presence with fresh vitals; not a clinically validated sleep-stage detector.' };
}
async function tick(): Promise<void> {
  if (busy || stopped) return;
  busy = true;
  try {
    const now = Date.now();
    if (lastTick && (now < lastTick || now - lastTick > 90000)) {
      adaptiveStore.intent('left'); adaptiveStore.intent('right');
    }
    lastTick = now;
    await settingsDB.read();
    await servicesDB.read();
    const status = await getDeviceStatusCoalesced();
    const presence = getPresenceData();
    for (const side of ['left', 'right'] as const) {
      const state = adaptiveStore.data[side];
      const present = presence[side].present === true && fresh(presence[side].lastUpdatedAt, 90000);
      if (!present || !status[side].isOn) presentSince[side] = null;
      else if (presentSince[side] === null) presentSince[side] = now;
      if (!status[side].isOn && !state.ready) { state.ready = true; adaptiveStore.save(); }
      if (present && status[side].isOn && state.ready && (!state.session || now >= state.session.end)) {
        state.session = { start: now, end: now + 12 * 3600000, baselineF: status[side].targetTemperatureF, lastAutomaticAt: null };
        state.ready = false;
        state.expectedF = status[side].targetTemperatureF;
        adaptiveStore.save();
      }
      if (!state.session) { adaptiveDecisions[side] = { kind: 'hold', reason: 'waiting-for-bedtime' }; continue; }
      const session = state.session;
      if (state.expectedF !== null && Math.abs(state.expectedF - status[side].targetTemperatureF) > 0.6) {
        adaptiveStore.intent(side);
      }
      if (state.expectedF !== status[side].targetTemperatureF) {
        state.expectedF = status[side].targetTemperatureF;
        adaptiveStore.save();
      }
      const vital = await prisma.vitals.findFirst({ where: { side, timestamp: { gte: Math.floor(now / 1000) - 120,
        lte: Math.floor(now / 1000) } }, orderBy: { timestamp: 'desc' } });
      const stream = servicesDB.data.biometrics.jobs.stream;
      const settled = presentSince[side] !== null && now - presentSince[side]! >= 30 * 60000;
      const context: ThermalContext = {
        side, now, nightStart: session.start, nightEnd: session.end, baselineF: session.baselineF,
        minimumF: state.minimumF, maximumF: state.maximumF, targetF: status[side].targetTemperatureF,
        enabled: state.mode !== 'off', isOn: status[side].isOn,
        asleep: settled && !!vital?.heart_rate && servicesDB.data.biometrics.enabled &&
          stream.status === 'healthy' && fresh(stream.timestamp, 120000),
        away: settingsDB.data.left.awayMode || settingsDB.data.right.awayMode,
        priming: status.isPriming || status[side].isAlarmVibrating,
        waterOkay: String(status.waterLevel) === 'true', pumpHealthy: hardwareReady(side),
        telemetryAt: circulation?.at ?? 0, eventsComplete: !adaptiveStore.fault,
        historyLoaded: !adaptiveStore.fault, lastAutomaticAt: session.lastAutomaticAt, adjustments: adaptiveStore.data.events,
      };
      const decision = state.holdUntil > now
        ? { kind: 'hold' as const, reason: 'manual-or-scheduled-hold-until-night-end' } : proposeTemperature(context);
      adaptiveDecisions[side] = decision;
      if (decision.kind !== 'propose' || state.mode !== 'active' || adaptiveStore.fault) continue;
      const revision = adaptiveStore.revision[side];
      const allowed = (latest?: DeviceStatus) =>
        (!latest || Math.abs(latest[side].targetTemperatureF - context.targetF) < 0.6) &&
        !stopped && !adaptiveStore.fault && adaptiveStore.revision[side] === revision &&
        state.mode === 'active' && state.holdUntil <= Date.now() && Date.now() < session.end &&
        Date.now() - now < 15000 && hardwareReady(side) &&
        !settingsDB.data.left.awayMode && !settingsDB.data.right.awayMode &&
        getPresenceData()[side].present === true && fresh(getPresenceData()[side].lastUpdatedAt, 90000);
      // Persist the rate limit before dispatch. A crash or unconfirmed write cannot retry immediately.
      session.lastAutomaticAt = now;
      adaptiveStore.save();
      await updateDeviceStatus({ [side]: { targetTemperatureF: decision.targetF } }, 'automatic', allowed);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    adaptiveDecisions.left = { kind: 'hold', reason };
    adaptiveDecisions.right = { kind: 'hold', reason };
    logger.warn(`[adaptiveTemperature] ${reason}`);
  } finally { busy = false; }
}
export function startAdaptiveTemperature(): void {
  if (timer) return;
  stopped = false;
  timer = setInterval(() => { void tick(); }, 10000);
  timer.unref();
  void tick();
}
export function stopAdaptiveTemperature(): void {
  stopped = true;
  if (timer) clearInterval(timer);
  timer = undefined;
}
