'use client';
import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { clientApi } from '@/lib/client-api';

export function SignOutButton({ className = 'sign-out' }: { className?: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function logout() {
    setPending(true);
    setError('');
    try {
      await clientApi('/auth/logout', {});
      window.location.assign('/login');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Sign-out could not be completed.');
      setPending(false);
    }
  }

  return <><button type="button" className={className} onClick={logout} disabled={pending}><LogOut size={16} aria-hidden="true"/>{pending ? 'Signing out…' : 'Sign out'}</button>{error && <p className="form-error small" role="alert">{error}</p>}</>;
}
