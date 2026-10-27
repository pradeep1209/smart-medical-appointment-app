'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import type { Role, User } from '@/lib/types';
import { roleName } from '@/lib/types';
import { PersonAvatar } from './person-avatar';

export function WorkspaceBar({ user, role }: { user: User; role: Role }) {
  const path = usePathname();
  const pages: Record<string, string> = { '/': role === 'DOCTOR' ? 'My workspace' : 'Overview', '/doctors': 'Doctors', '/appointments': 'Appointments', '/care': 'Prescriptions & refills', '/planning': 'Scheduling simulation', '/patients': 'Patients', '/team': 'Care team', '/account': 'My account', '/consultation-profile': 'Consultation profile', '/availability': role === 'DOCTOR' ? 'My availability' : 'Availability' };
  return <header className="workspace-bar"><div className="breadcrumbs"><span>Clinic workspace</span><ChevronRight size={13} aria-hidden="true"/><span>{pages[path] ?? 'CareSlot'}</span></div><Link className="workspace-user" href="/account" aria-label={`My account: ${user.displayName}`}><div><strong>{user.displayName}</strong><small>{roleName(role)}</small></div><PersonAvatar name={user.displayName}/></Link></header>;
}
