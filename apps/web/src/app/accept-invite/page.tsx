import { AuthForm } from '@/components/auth-form';
import { AuthShell } from '@/components/auth-shell';
export const metadata = { title: 'Join your clinic' };
export default function InvitationPage() { return <AuthShell invitation><div className="auth-intro"><h1>A place on the team.</h1><p>Choose a password to accept your clinic invitation.</p></div><AuthForm invitation/><p className="auth-note">Your administrator has selected your clinic and role.</p></AuthShell>; }
