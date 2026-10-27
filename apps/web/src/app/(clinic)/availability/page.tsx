import { clinicContext, serverApi } from '@/lib/server-api';
import { ScheduleWorkspace, type Schedules } from '@/components/schedule-workspace';
export const metadata = { title: 'Consultation availability' };
export default async function AvailabilityPage() {
  const { membership } = await clinicContext();
  const data = await serverApi<Schedules>(`/clinics/${membership.clinicId}/schedules`);
  return <><header className="page-heading"><div><h1>{membership.role === 'DOCTOR' ? 'My availability' : 'Consultation availability'}</h1><p>Set the hours patients can book. Existing visits keep their confirmed time; affected appointments are flagged for review.</p></div></header><ScheduleWorkspace data={data}/></>;
}
