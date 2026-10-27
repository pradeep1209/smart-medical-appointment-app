import { AuthShell } from '@/components/auth-shell';
import { RecoverForm } from '@/components/recover-form';
export const metadata = { title: 'Recover account' };
export default function RecoverPage() { return <AuthShell><div className="auth-intro"><h1>Recover your account</h1><p>Contact your clinic to verify your identity and receive a recovery code. No email is sent in this development version.</p></div><RecoverForm/><p className="auth-note"><a href="/login">Back to sign in</a></p></AuthShell>; }
