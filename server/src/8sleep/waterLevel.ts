import moment from 'moment-timezone';
import { prisma } from '../db/prisma.js';
import serverStatus from '../serverStatus.js';
import eventBus from '../events/eventBus.js';
import { WaterLevel, WaterLevelStore, WaterLevelTracker, WaterTankState } from './waterLevelTracker.js';

const prismaStore: WaterLevelStore = {
  async latest() {
    const row = await prisma.water_level_events.findFirst({ orderBy: { id: 'desc' } });
    return row ? { level: row.level as WaterLevel, timestamp: row.timestamp } : null;
  },
  async append(event) {
    await prisma.water_level_events.create({ data: event });
  },
};

function publish(state: WaterTankState) {
  const entry = serverStatus.status.waterTank;
  entry.status = state.level === 'ok' ? 'healthy' : 'failed';
  entry.message = '';
  entry.timestamp = moment.unix(state.since).format();
  eventBus.emit('service-health', { waterTank: entry });
}

export const waterLevelTracker = new WaterLevelTracker(prismaStore, publish);

export async function initWaterLevel() {
  await waterLevelTracker.init();
  if (waterLevelTracker.state) publish(waterLevelTracker.state);
}
