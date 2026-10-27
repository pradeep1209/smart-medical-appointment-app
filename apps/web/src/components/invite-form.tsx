'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientApi } from '@/lib/client-api';
export function InviteForm({ clinicId }: { clinicId: string }) {
  const router = useRouter();
  const [role, setRole] = useState('DOCTOR'), [pending, setPending] = useState(false), [error, setError] = useState(''), [url, setUrl] = useState(''), [copied, setCopied] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    setPending(true); setError(''); setUrl(''); setCopied(false);
    try {
      const result = await clientApi<{ invitationUrl: string }>(`/clinics/${clinicId}/invitations`, { displayName: String(data.get('name')).trim(), email: String(data.get('email')).trim(), role, specialty: role === 'DOCTOR' ? String(data.get('specialty')).trim() : '' });
      setUrl(result.invitationUrl); form.reset(); setRole('DOCTOR'); router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The invitation could not be created.'); }
    finally { setPending(false); }
  }
  return <section className="panel invite-panel" id="invite"><div className="section-heading"><h2>Invite a colleague</h2></div><p className="muted">Give a doctor or receptionist access to this clinic.</p><form className="invite-form" onSubmit={submit}><div className="field"><label htmlFor="invite-name">Full name</label><input id="invite-name" name="name" required minLength={2} maxLength={100} autoComplete="off"/></div><div className="field"><label htmlFor="invite-email">Email address</label><input id="invite-email" name="email" type="email" required maxLength={254} autoComplete="off"/></div><div className="field"><label htmlFor="invite-role">Clinic role</label><select id="invite-role" value={role} onChange={e => setRole(e.target.value)}><option value="DOCTOR">Doctor</option><option value="RECEPTIONIST">Receptionist</option></select></div>{role === 'DOCTOR' && <div className="field"><label htmlFor="invite-specialty">Specialty</label><input id="invite-specialty" name="specialty" required maxLength={100}/></div>}{error && <p className="form-error" role="alert">{error}</p>}<button className="button" disabled={pending}>{pending ? 'Creating invitation…' : 'Create invitation'}</button></form>{url && <div className="invitation-result" role="status"><h3>Invitation ready</h3><p>Share this private link with your colleague. It expires in seven days and can be used once.</p><label htmlFor="invitation-url">Private invitation link</label><input id="invitation-url" value={url} readOnly onFocus={e => e.target.select()}/><button className="button secondary" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setError('Select and copy the invitation link above.'); } }}>{copied ? 'Copied' : 'Copy invitation link'}</button></div>}</section>;
}
