import { AuthForm } from '@/components/auth-form';
import { AuthShell } from '@/components/auth-shell';
export const metadata = { title: 'Clinic sign in' };
export default function LoginPage() { return <AuthShell><div className="auth-intro"><h1>Welcome back.</h1><p>Sign in to your clinic workspace.</p></div><AuthForm/><p className="auth-note">Use the email address connected to your clinic account.</p><p className="auth-note"><a href="/recover">Recover account</a></p></AuthShell>; }
