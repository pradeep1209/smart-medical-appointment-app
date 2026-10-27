export type Role = 'ADMIN' | 'DOCTOR' | 'RECEPTIONIST';
export type User = { id: string; email: string; displayName: string; patientId: string | null; memberships: { id: string; clinicId: string; clinicName: string; role: Role }[] };
export type Overview = { clinic: { id: string; name: string; timezone: string }; role: Role; counts: { staff: number; doctors: number; patients: number } };
export type Team = { members: { id: string; role: Role; active: boolean; user: { displayName: string; email: string; status: string }; doctor: { specialty: string } | null }[]; invitations: { id: string; displayName: string; email: string; role: Role; expiresAt: string }[] };
export type Doctors = { doctors: { id: string; specialty: string; consultationMinutes: number; membership: { user: { displayName: string } } }[] };
export type MyDoctorProfile = { clinic: { id: string; name: string; timezone: string }; doctor: { id: string; name: string; specialty: string; consultationMinutes: number } | null };
export type Patients = { items: { createdAt: string; patient: { id: string; user: { displayName: string; email: string } } }[]; total: number };
export const roleName = (role: Role) => ({ ADMIN: 'Clinic administrator', DOCTOR: 'Doctor', RECEPTIONIST: 'Receptionist' })[role];
