'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { House, Stethoscope, Users, UserRound, ContactRound, Building2, Menu, CalendarDays, ClipboardList } from 'lucide-react';
import type { User } from '@/lib/types';
import { roleName } from '@/lib/types';
import { Brand } from './brand';
import { PersonAvatar } from './person-avatar';
import { SignOutButton } from './sign-out-button';
export function Sidebar({ user, clinic, role }: { user: User; clinic: string; role: 'ADMIN' | 'DOCTOR' | 'RECEPTIONIST' }) {
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (menu.current) menu.current.open = false; }, [pathname]);
  const links = [
    { href: '/', label: role === 'DOCTOR' ? 'My workspace' : 'Overview', icon: House },
    { href: '/appointments', label: role === 'DOCTOR' ? 'My appointments' : 'Appointments', icon: CalendarDays },
    ...(role === 'DOCTOR' ? [{ href: '/care', label: 'Prescriptions & refills', icon: ClipboardList }] : []),
    role === 'DOCTOR'
      ? { href: '/consultation-profile', label: 'Consultation profile', icon: Stethoscope }
      : { href: '/doctors', label: 'Doctors', icon: Stethoscope },
    ...(role !== 'DOCTOR' ? [{ href: '/patients', label: 'Patients', icon: ContactRound }] : []),
    { href: '/availability', label: role === 'DOCTOR' ? 'My availability' : 'Availability', icon: CalendarDays },
    ...(role !== 'RECEPTIONIST' ? [{ href: '/planning', label: 'Scheduling simulation', icon: CalendarDays }] : []),
    ...(role === 'ADMIN' ? [{ href: '/team', label: 'Care team', icon: Users }] : []),
    { href: '/account', label: 'My account', icon: UserRound },
    { href: '/records', label: role === 'ADMIN' ? 'Clinic details' : role === 'DOCTOR' ? 'Visit records' : 'Appointment documents', icon: ClipboardList },
    { href: '/notifications', label: 'Notifications', icon: CalendarDays },
  ];
  const navigation = <nav aria-label="Clinic navigation">{links.map(link => <Link key={link.href} href={link.href} className={pathname === link.href ? 'nav-link selected' : 'nav-link'} aria-current={pathname === link.href ? 'page' : undefined}><link.icon size={18} strokeWidth={1.6}/>{link.label}</Link>)}<SignOutButton className="sign-out mobile-sign-out"/></nav>;
  return <aside className="sidebar"><div className="sidebar-brand"><Brand/></div><div className="clinic-scope"><Building2 size={18} strokeWidth={1.5} aria-hidden="true"/><div><span>Current clinic</span><strong>{clinic}</strong></div></div><div className="desktop-nav"><p className="nav-group-label">Workspace</p>{navigation}</div><details className="mobile-nav" ref={menu}><summary><Menu size={18} aria-hidden="true"/>Menu</summary>{navigation}</details><div className="sidebar-footer"><div className="sidebar-account"><PersonAvatar name={user.displayName}/><div><p>{user.displayName}</p><small>{roleName(role)}</small></div></div><SignOutButton/></div></aside>;
}
