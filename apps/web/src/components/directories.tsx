'use client';
import { useId, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { Doctors, Patients } from '@/lib/types';
import { PersonAvatar } from './person-avatar';

function DirectorySearch({ value, onChange, label, count }: { value: string; onChange: (value: string) => void; label: string; count: string }) {
  const id = useId();
  return <div className="directory-toolbar"><div className="search-field"><label className="sr-only" htmlFor={id}>{label}</label><Search size={16} aria-hidden="true"/><input id={id} type="search" value={value} onChange={event => onChange(event.target.value)} placeholder={label}/>{value && <button className="search-clear" aria-label="Clear search" onClick={() => onChange('')}><X size={15}/></button>}</div><span className="directory-count" aria-live="polite">{count}</span></div>;
}

export function DoctorDirectory({ doctors }: Doctors) {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => doctors.filter(doctor => `${doctor.membership.user.displayName} ${doctor.specialty}`.toLowerCase().includes(query.trim().toLowerCase())), [doctors, query]);
  return <section className="panel directory-panel"><DirectorySearch value={query} onChange={setQuery} label="Search by name or specialty" count={`${visible.length} ${visible.length === 1 ? 'doctor' : 'doctors'}${query ? ` of ${doctors.length}` : ''}`}/>{!visible.length ? <div className="empty-state"><h2>{doctors.length ? 'No matching doctors' : 'Your care team starts here'}</h2><p>{doctors.length ? 'Try another name or specialty.' : 'Doctors appear here and in the patient app after accepting their clinic invitation.'}</p>{query && <button className="text-button" onClick={() => setQuery('')}>Clear search</button>}</div> : <div className="table-scroll"><table className="directory-table"><caption className="sr-only">Clinic doctor directory</caption><thead><tr><th>Doctor</th><th>Specialty</th><th className="numeric">Consultation</th></tr></thead><tbody>{visible.map(doctor => <tr key={doctor.id}><td data-label="Doctor"><div className="identity-cell"><PersonAvatar name={doctor.membership.user.displayName}/><strong>{doctor.membership.user.displayName}</strong></div></td><td data-label="Specialty">{doctor.specialty}</td><td data-label="Consultation" className="numeric">{doctor.consultationMinutes}<span className="muted"> minutes</span></td></tr>)}</tbody></table></div>}</section>;
}

export function PatientDirectory({ items, total }: Patients) {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => items.filter(item => `${item.patient.user.displayName} ${item.patient.user.email}`.toLowerCase().includes(query.trim().toLowerCase())), [items, query]);
  return <section className="panel directory-panel"><DirectorySearch value={query} onChange={setQuery} label="Search these registrations" count={`${visible.length} ${visible.length === 1 ? 'patient' : 'patients'} shown`}/>{!visible.length ? <div className="empty-state"><h2>{items.length ? 'No matching registrations' : 'Your first patient connection'}</h2><p>{items.length ? 'Try another name or email address.' : 'Patients appear here when they create a CareSlot account in the Android app.'}</p>{query && <button className="text-button" onClick={() => setQuery('')}>Clear search</button>}</div> : <div className="table-scroll"><table className="directory-table"><caption className="sr-only">Patient registrations</caption><thead><tr><th>Patient</th><th>Email address</th><th className="numeric">Registered</th></tr></thead><tbody>{visible.map(item => <tr key={item.patient.id}><td data-label="Patient"><div className="identity-cell"><PersonAvatar name={item.patient.user.displayName}/><strong>{item.patient.user.displayName}</strong></div></td><td data-label="Email address">{item.patient.user.email}</td><td data-label="Registered" className="numeric">{new Date(item.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' })}</td></tr>)}</tbody></table></div>}<p className="table-caption">{query ? `${visible.length} matches in the latest ${items.length} registrations.` : `Showing the latest ${items.length} of ${total} registrations.`}</p></section>;
}
