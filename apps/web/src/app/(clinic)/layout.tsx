import { Sidebar } from '@/components/sidebar';
import { clinicContext } from '@/lib/server-api';
import { WorkspaceBar } from '@/components/workspace-bar';
export const dynamic = 'force-dynamic';
export default async function ClinicLayout({ children }: { children: React.ReactNode }) {
  const { user, membership } = await clinicContext();
  return <div className="clinic-shell"><a className="skip-link" href="#clinic-content">Skip to clinic content</a><Sidebar user={user} clinic={membership.clinicName} role={membership.role}/><div className="workspace-main"><WorkspaceBar user={user} role={membership.role}/><main className="clinic-canvas" id="clinic-content">{children}</main></div></div>;
}
