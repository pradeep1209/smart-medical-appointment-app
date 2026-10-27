import { clinicContext, serverApi } from '@/lib/server-api';
import type { Doctors } from '@/lib/types';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { DoctorDirectory } from '@/components/directories';
export const metadata = { title: 'Doctors' };
export default async function DoctorsPage() {
  const { membership } = await clinicContext();
  if (membership.role === 'DOCTOR') redirect('/consultation-profile');
  const roster = await serverApi<Doctors>(`/clinics/${membership.clinicId}/doctors`);
  return <><header className="page-heading"><div><h1>Doctors</h1><p>The care team at {membership.clinicName}.</p></div>{membership.role === 'ADMIN' && <Link className="button" href="/team#invite">Invite a doctor</Link>}</header><DoctorDirectory doctors={roster.doctors}/></>;
}
