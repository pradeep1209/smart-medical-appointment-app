import Link from 'next/link';
import { clinicContext, serverApi } from '@/lib/server-api';
import type { Doctors, MyDoctorProfile, Overview } from '@/lib/types';
import { roleName } from '@/lib/types';
import { DoctorOverview } from '@/components/doctor-overview';
import { PersonAvatar } from '@/components/person-avatar';
export default async function OverviewPage() {
  const { user, membership } = await clinicContext();
  if (membership.role === 'DOCTOR') {
    const profile = await serverApi<MyDoctorProfile>(`/clinics/${membership.clinicId}/doctor-profile`);
    return <DoctorOverview profile={profile}/>;
  }
  const [overview, roster] = await Promise.all([serverApi<Overview>(`/clinics/${membership.clinicId}/overview`), serverApi<Doctors>(`/clinics/${membership.clinicId}/doctors`)]);
  return <><header className="page-heading"><div><h1>Clinic overview</h1><p>{overview.clinic.name} · {overview.clinic.timezone}</p></div>{membership.role === 'ADMIN' && <Link className="button" href="/team">Manage care team</Link>}</header><section className="metrics" aria-label="Clinic accounts"><div><span>Active doctors</span><strong>{overview.counts.doctors}</strong></div><div><span>Active staff</span><strong>{overview.counts.staff}</strong></div><div><span>Registered patients</span><strong>{overview.counts.patients}</strong></div></section><div className="overview-grid"><section className="panel"><div className="section-heading"><h2>Your doctors</h2><Link href="/doctors">View directory</Link></div>{!roster.doctors.length ? <div className="empty-state"><h3>Your care team starts here</h3><p>A doctor will appear in the patient app after accepting a clinic invitation.</p>{membership.role === 'ADMIN' && <Link className="text-link" href="/team">Invite your first doctor</Link>}</div> : <ul className="doctor-list">{roster.doctors.slice(0, 5).map(d => <li key={d.id}><PersonAvatar name={d.membership.user.displayName}/><div><h3>{d.membership.user.displayName}</h3><p>{d.specialty}</p></div><span className="duration">{d.consultationMinutes} min</span></li>)}</ul>}</section><section className="panel access-panel"><h2>Your clinic access</h2><h3>{user.displayName}</h3><p className="muted">{roleName(membership.role)}</p><dl><div><dt>Email</dt><dd>{user.email}</dd></div><div><dt>Clinic</dt><dd>{membership.clinicName}</dd></div></dl><Link className="text-link" href="/account">View my account</Link></section></div><section className="next-step"><h2>Patient connections</h2><p>New registrations from the CareSlot app appear in your clinic directory. Keep your care team up to date so patients know who is looking after them.</p><Link className="text-link" href="/patients">View patient registrations</Link></section></>;
}
