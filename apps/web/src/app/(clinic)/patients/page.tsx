import { redirect } from 'next/navigation';
import { clinicContext, serverApi } from '@/lib/server-api';
import type { Patients } from '@/lib/types';
import { PatientDirectory } from '@/components/directories';
export const metadata = { title: 'Patients' };
export default async function PatientsPage() {
  const { membership } = await clinicContext();
  if (membership.role === 'DOCTOR') redirect('/');
  const patients = await serverApi<Patients>(`/clinics/${membership.clinicId}/patients`);
  return <><header className="page-heading"><div><h1>Patients</h1><p>People connected to {membership.clinicName}.</p></div></header><PatientDirectory items={patients.items} total={patients.total}/></>;
}
