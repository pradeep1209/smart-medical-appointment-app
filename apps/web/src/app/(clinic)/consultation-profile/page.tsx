import { redirect } from 'next/navigation';
import { clinicContext, serverApi } from '@/lib/server-api';
import type { MyDoctorProfile } from '@/lib/types';
import { PersonAvatar } from '@/components/person-avatar';
import Link from 'next/link';

export const metadata = { title: 'My consultation profile' };

export default async function ConsultationProfilePage() {
  const { membership } = await clinicContext();
  if (membership.role !== 'DOCTOR') redirect('/doctors');
  const { doctor, clinic } = await serverApi<MyDoctorProfile>(`/clinics/${membership.clinicId}/doctor-profile`);
  return <>
    <header className="page-heading"><div><h1>My consultation profile</h1><p>The consultation details patients see at {clinic.name}.</p></div></header>
    <div className="settings-layout"><section className="settings-intro">{doctor && <PersonAvatar name={doctor.name} large/>}<div><h2>{doctor?.name ?? 'Your consultation profile'}</h2><p>{doctor?.specialty ?? 'Ask your clinic to add your consultation details.'}</p></div></section><section className="panel account-panel">
      {doctor ? <>
        <div className="section-heading"><h2>{doctor.name}</h2><span className="status active">Visible to patients</span></div>
        <dl><div><dt>Specialty</dt><dd>{doctor.specialty}</dd></div><div><dt>Consultation length</dt><dd>{doctor.consultationMinutes} minutes</dd></div><div><dt>Clinic</dt><dd>{clinic.name}</dd></div><div><dt>Clinic time zone</dt><dd>{clinic.timezone}</dd></div></dl>
        <Link className="text-link" href="/availability">Edit consultation details and availability</Link>
      </> : <div className="empty-state"><h2>Complete your consultation profile</h2><p>Your consultation details have not been configured. Contact your clinic administrator to complete them.</p></div>}
    </section></div>
  </>;
}
