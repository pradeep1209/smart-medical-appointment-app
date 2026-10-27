import { redirect } from 'next/navigation';
import { clinicContext, serverApi } from '@/lib/server-api';
import { CareWorkspace, type CareData } from '@/components/care-workspace';
export const metadata = { title: 'Prescriptions and refills' };
export default async function CarePage({ searchParams }: { searchParams: Promise<{ appointmentId?: string }> }) {
  const { membership } = await clinicContext();
  if (membership.role !== 'DOCTOR') redirect('/appointments');
  const { appointmentId } = await searchParams;
  const data = await serverApi<CareData>(`/clinics/${membership.clinicId}/care${appointmentId ? `?appointmentId=${encodeURIComponent(appointmentId)}` : ''}`);
  return <><header className="page-heading"><div><h1>Prescriptions & refills</h1><p>Your patients’ visit prescriptions and refill reviews · {data.clinic.timezone}</p></div></header><CareWorkspace data={data}/></>;
}
