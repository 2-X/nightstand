import GlassCard from '@design/GlassCard';
import StatusRow from './StatusRow.tsx';
import { ServerStatusKey, ServerStatus, StatusInfo } from '@api/serverStatusSchema.ts';

type GroupCardProps = {
  label: string;
  keys: ServerStatusKey[];
  data: ServerStatus;
};

export default function GroupCard({ label, keys, data }: GroupCardProps) {
  if (keys.length === 0) return null;
  return (
    <GlassCard label={ label }>
      { keys.map((key, index) => (
        <StatusRow key={ key } job={ key } statusInfo={ data[key] as StatusInfo } divider={ index > 0 } />
      )) }
    </GlassCard>
  );
}
