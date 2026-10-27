import Link from 'next/link';
import type { MyDoctorProfile } from '@/lib/types';
import { PersonAvatar } from './person-avatar';

export function DoctorOverview({ profile }: { profile: MyDoctorProfile }) {
  const { doctor, clinic } = profile;
  return <>
    <header className="page-heading"><div><h1>My workspace</h1><p>Your place in the care team at {clinic.name}.</p></div><Link className="button secondary" href="/account">My account</Link></header>
    <section className="panel"><div className="section-heading"><h2>Your consultation profile</h2><Link href="/consultation-profile">View details</Link></div>
      {doctor ? <><div className="identity-cell"><PersonAvatar name={doctor.name} large/><div><h2>{doctor.name}</h2><p className="muted">{doctor.specialty}</p></div></div><dl className="profile-summary"><div><dt>Consultation</dt><dd>{doctor.consultationMinutes} minutes</dd></div><div><dt>Clinic</dt><dd>{clinic.name}</dd></div><div><dt>Time zone</dt><dd>{clinic.timezone}</dd></div></dl></> : <div className="empty-state"><h3>Profile details are missing</h3><p>Ask your clinic administrator to complete your consultation profile.</p></div>}
    </section><section className="next-step"><h2>Your appointments</h2><p>Review your confirmed visits, record attendance, and check appointments affected by schedule changes.</p><Link className="text-link" href="/appointments">Open my appointments</Link></section>
  </>;
}
