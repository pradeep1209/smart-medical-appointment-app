import { redirect } from 'next/navigation';
import { clinicContext, serverApi } from '@/lib/server-api';
import { SchedulingLab, type ModelMetadata } from '@/components/scheduling-lab';
export const metadata = { title: 'Scheduling simulation' };
export default async function PlanningPage() {
  const { membership } = await clinicContext();
  if (membership.role === 'RECEPTIONIST') redirect('/appointments');
  const model = await serverApi<ModelMetadata>(`/clinics/${membership.clinicId}/prediction`);
  return <><header className="page-heading"><div><h1>Scheduling simulation</h1><p>Explore attendance and capacity trade-offs before changing a scheduling policy.</p></div></header><SchedulingLab clinicId={membership.clinicId} model={model}/></>;
}
