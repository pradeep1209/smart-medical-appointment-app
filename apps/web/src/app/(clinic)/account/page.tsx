import { clinicContext, serverApi } from '@/lib/server-api';
import { AccountControls } from '@/components/account-controls';
import { roleName } from '@/lib/types';
import { PersonAvatar } from '@/components/person-avatar';
import { SignOutButton } from '@/components/sign-out-button';
export const metadata = { title: 'My account' };
export default async function AccountPage() {
  const { user, membership } = await clinicContext();
  const sessions = await serverApi<{ items: { id: string; client: string; current: boolean; createdAt: string }[] }>('/account/sessions');
  return <><header className="page-heading"><div><h1>My account</h1><p>Your identity, password and signed-in sessions.</p></div><SignOutButton className="button secondary"/></header><div className="settings-layout"><section className="settings-intro"><PersonAvatar name={user.displayName} large/><div><h2>{user.displayName}</h2><p>{user.email}</p><p>{roleName(membership.role)} at {membership.clinicName}.</p></div></section><AccountControls name={user.displayName} sessions={sessions.items}/></div></>;
}
