import { clinicContext, serverApi } from '@/lib/server-api';
import { AppointmentQueue, type Queue } from '@/components/appointment-queue';
export const metadata = { title: 'Appointments' };
export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { membership } = await clinicContext();
  const { date } = await searchParams;
  const data = await serverApi<Queue>(`/clinics/${membership.clinicId}/appointments${date ? `?date=${encodeURIComponent(date)}` : ''}`);
  return <><header className="page-heading"><div><h1>{membership.role === 'DOCTOR' ? 'My appointments' : 'Appointments'}</h1><p>{membership.role === 'DOCTOR' ? 'Your assigned visits' : 'Your clinic’s confirmed visits'} · all times use {data.timezone}</p></div></header><AppointmentQueue data={data} clinicId={membership.clinicId} canPrescribe={membership.role === 'DOCTOR'}/></>;
}
