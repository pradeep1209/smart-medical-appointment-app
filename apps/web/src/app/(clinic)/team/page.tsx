import { redirect } from 'next/navigation';
import { InviteForm } from '@/components/invite-form';
import { AccessButton, RecoveryIssuer } from '@/components/account-controls';
import { clinicContext, serverApi } from '@/lib/server-api';
import type { Team } from '@/lib/types';
import { roleName } from '@/lib/types';
export const metadata = { title: 'Care team' };
export default async function TeamPage() {
  const { membership } = await clinicContext();
  if (membership.role !== 'ADMIN') redirect('/');
  const team = await serverApi<Team>(`/clinics/${membership.clinicId}/team`);
  return <><header className="page-heading"><div><h1>Care team</h1><p>People with access to {membership.clinicName}.</p></div></header><div className="team-grid"><div>
    <section className="panel"><div className="section-heading"><h2>Clinic members</h2><span className="muted">{team.members.length} total</span></div><div className="table-scroll"><table><thead><tr><th>Name</th><th>Role</th><th>Access</th></tr></thead><tbody>{team.members.map(m => <tr key={m.id}><td><strong>{m.user.displayName}</strong><small>{m.user.email}</small></td><td>{roleName(m.role)}</td><td className="access-cell"><span className={m.active && m.user.status === 'ACTIVE' ? 'status active' : 'status'}>{m.active && m.user.status === 'ACTIVE' ? 'Active' : 'Inactive'}</span>{m.id !== membership.id && m.user.status === 'ACTIVE' && <AccessButton path={`/clinics/${membership.clinicId}/members/${m.id}/access`} active={m.active}/>}</td></tr>)}</tbody></table></div></section>
    <section className="panel pending-panel"><div className="section-heading"><h2>Pending invitations</h2><span className="muted">{team.invitations.length} awaiting acceptance</span></div>{!team.invitations.length ? <p className="empty-line">No invitations are waiting for a response.</p> : <ul className="invitation-list">{team.invitations.map(i => <li key={i.id}><div><strong>{i.displayName}</strong><small>{i.email} · {roleName(i.role)}</small><small>Expires {new Date(i.expiresAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })}</small></div><AccessButton path={`/clinics/${membership.clinicId}/invitations/${i.id}/revoke`} invitation/></li>)}</ul>}</section>
  </div><InviteForm clinicId={membership.clinicId}/></div><div className="admin-account-recovery"><RecoveryIssuer clinicId={membership.clinicId}/></div></>;
}
