'use client';
import { useEffect, useState } from 'react';
import { clientApi } from '@/lib/client-api';
import { ArrowRight, Eye, EyeOff, LoaderCircle } from 'lucide-react';
export function AuthForm({ invitation = false }: { invitation?: boolean }) {
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [complete, setComplete] = useState('');
  const [showPassword, setShowPassword] = useState(false), [invitationToken, setInvitationToken] = useState('');
  useEffect(() => { if (invitation) setInvitationToken(new URLSearchParams(window.location.hash.slice(1)).get('token') ?? ''); }, [invitation]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setPending(true);
    const data = new FormData(event.currentTarget);
    try {
      if (invitation) {
        if (!invitationToken) throw new Error('Open the complete private invitation link from your clinic administrator.');
        const result = await clientApi<{ message: string }>('/auth/accept-invitation', { token: invitationToken, password: String(data.get('password')) });
        window.history.replaceState(null, '', '/accept-invite'); setComplete(result.message);
      } else {
        await clientApi('/auth/web/login', { email: String(data.get('email')).trim(), password: String(data.get('password')) });
        window.location.assign('/');
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Sign-in could not be completed.'); }
    finally { setPending(false); }
  }
  if (complete) return <div className="success-box" role="status"><p>{complete}</p><a className="button" href="/login">Go to clinic sign in</a></div>;
  return <form onSubmit={submit} className="auth-form">
    {!invitation && <div className="field"><label htmlFor="email">Email address</label><input id="email" name="email" type="email" placeholder="you@clinic.com" required autoComplete="username" maxLength={254} disabled={pending}/></div>}
    <div className="field"><label htmlFor="password">{invitation ? 'Choose your password' : 'Password'}</label><div className="password-field"><input id="password" name="password" type={showPassword ? 'text' : 'password'} minLength={invitation ? 12 : 1} maxLength={128} required autoComplete={invitation ? 'new-password' : 'current-password'} disabled={pending}/><button className="password-toggle" type="button" onClick={() => setShowPassword(!showPassword)} aria-controls="password" aria-pressed={showPassword} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div>{invitation && <p className="field-help">At least 12 characters. Already have a CareSlot account? Use its existing password.</p>}</div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button full" disabled={pending} type="submit">{pending ? 'Please wait…' : invitation ? 'Join the clinic' : 'Sign in to clinic'}{pending ? <LoaderCircle className="loading-icon" size={17} aria-hidden="true"/> : <ArrowRight size={17} aria-hidden="true"/>}</button>
  </form>;
}
