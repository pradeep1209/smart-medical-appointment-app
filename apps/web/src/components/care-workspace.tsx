'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { clientApi } from '@/lib/client-api';
export type Medicine = { name: string; dose: string; frequency: string; duration: string; instructions: string };
export type Refill = { id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; version: number; patientNote: string; requestedAt: string; reviewedAt: string | null; reviewNote: string | null; renewalId: string | null };
export type Prescription = { id: string; appointmentId: string; issuedAt: string; visitStartsAt: string; notes: string; renewalOfId: string | null; renewalId: string | null; medicines: Medicine[]; refillRequests: Refill[]; canRequestRefill: boolean; doctor: { name: string }; clinic: { id: string; name: string; timezone: string }; patient: { id: string; name: string; email: string } };
export type CareData = { clinic: { id: string; name: string; timezone: string }; eligibleVisits: { id: string; startsAt: string; timezone: string; patient: string }[]; selectedVisitId: string | null; items: Prescription[]; pending: (Refill & { prescription: Prescription })[]; recent: (Refill & { prescription: Prescription })[]; pendingCount: number };
const blankMedicine = (): Medicine => ({ name: '', dose: '', frequency: '', duration: '', instructions: '' });
const validLines = (lines: Medicine[]) => lines.length > 0 && lines.every(m => m.name.trim() && m.dose.trim() && m.frequency.trim() && m.duration.trim());
const dateText = (value: string, timezone: string) => new Intl.DateTimeFormat('en-IN', { timeZone: timezone, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
export function MedicineFields({ lines, change, prefix }: { lines: Medicine[]; change: (value: Medicine[]) => void; prefix: string }) {
  const fields: { key: keyof Medicine; label: string; max: number }[] = [{ key: 'name', label: 'Medicine name', max: 120 }, { key: 'dose', label: 'Dose', max: 100 }, { key: 'frequency', label: 'Frequency', max: 160 }, { key: 'duration', label: 'Duration', max: 100 }];
  return <div className="medicine-editor">{lines.map((line, index) => <section className="medicine-block" key={index}><div className="section-heading"><h3>Medicine {index + 1}</h3>{lines.length > 1 && <button className="text-button" type="button" onClick={() => change(lines.filter((_, i) => i !== index))}>Remove medicine</button>}</div><div className="medicine-fields">{fields.map(field => <div className="field" key={field.key}><label htmlFor={`${prefix}-${index}-${field.key}`}>{field.label}</label><input id={`${prefix}-${index}-${field.key}`} value={line[field.key]} required maxLength={field.max} onChange={e => change(lines.map((m, i) => i === index ? { ...m, [field.key]: e.target.value } : m))}/></div>)}<div className="field medicine-instructions"><label htmlFor={`${prefix}-${index}-instructions`}>Instructions <span className="muted">(optional)</span></label><textarea id={`${prefix}-${index}-instructions`} value={line.instructions} maxLength={500} rows={2} onChange={e => change(lines.map((m, i) => i === index ? { ...m, instructions: e.target.value } : m))}/></div></div></section>)}<button className="button secondary" type="button" disabled={lines.length >= 10} onClick={() => change([...lines, blankMedicine()])}>Add medicine</button></div>;
}
function MedicineReadout({ lines, notes }: { lines: Medicine[]; notes: string }) {
  return <><ol className="medicine-readout">{lines.map((medicine, index) => <li key={index}><h3>{medicine.name}</h3><dl><div><dt>Dose</dt><dd>{medicine.dose}</dd></div><div><dt>Frequency</dt><dd>{medicine.frequency}</dd></div><div><dt>Duration</dt><dd>{medicine.duration}</dd></div></dl>{medicine.instructions && <p>{medicine.instructions}</p>}</li>)}</ol>{notes && <div className="prescription-notes"><strong>Additional instructions</strong><p>{notes}</p></div>}</>;
}
export function CareWorkspace({ data }: { data: CareData }) {
  const router = useRouter(), [message, setMessage] = useState('');
  const [task, setTask] = useState<'issue' | 'refills'>(data.pendingCount > 0 ? 'refills' : 'issue');
  const saved = (text: string) => { setMessage(text); router.refresh(); };
  return <div className="care-workspace">
    {message && <p className="schedule-success" role="status">{message}</p>}
    <div className="care-toolbar"><nav className="care-tasks" aria-label="Care tasks">
      <button className={task === 'issue' ? 'care-task active' : 'care-task'} aria-pressed={task === 'issue'} onClick={() => setTask('issue')}>Issue a prescription</button>
      <button className={task === 'refills' ? 'care-task active' : 'care-task'} aria-pressed={task === 'refills'} onClick={() => setTask('refills')}>Refill reviews <span className="status">{data.pendingCount} pending</span></button>
    </nav><button className="button secondary" onClick={() => router.refresh()}>Refresh care records</button></div>
    <div className="care-panels">
      <div hidden={task !== 'issue'}><IssueForm data={data} saved={saved}/></div>
      <div hidden={task !== 'refills'}><section className="panel"><div className="section-heading"><h2>Refill reviews</h2><span className="status">{data.pendingCount} pending</span></div>
        <p className="field-help">Review the patient’s request and enter a decision note. Approval issues a new prescription with the medicine details you confirm.</p>
        {data.pending.length ? data.pending.map(request => <ReviewCard key={`${request.id}:${request.version}`} request={request} clinicId={data.clinic.id} saved={saved}/>) : <div className="empty-state"><h3>No requests waiting</h3><p>Requests from your patients will appear here.</p></div>}
        {data.pendingCount > data.pending.length && <p className="table-caption">Showing the first 50 waiting requests.</p>}
        <div className="care-recent"><h3>Recent decisions</h3>{!data.recent.length && <p className="empty-line">No refill decisions yet.</p>}
          {data.recent.map(request => <details key={request.id} className="care-decision"><summary>{request.prescription.patient.name} · {request.status === 'APPROVED' ? 'Approved' : 'Rejected'}</summary><p>{request.patientNote}</p><p><strong>Your note:</strong> {request.reviewNote}</p><small>{request.reviewedAt && dateText(request.reviewedAt, data.clinic.timezone)}</small>{request.status === 'APPROVED' && <p className="field-help">A new prescription was issued to the patient.</p>}</details>)}
        </div>
      </section></div>
    </div>
    <section className="panel"><div className="section-heading"><h2>Issued prescriptions</h2><span className="muted">Latest {data.items.length}{data.items.length === 50 ? ' · limited to 50' : ''}</span></div><p className="field-help"><Link className="text-link" href="/records">Open visit records for prescription PDFs, corrections and consultation summaries.</Link></p>
      {!data.items.length ? <div className="empty-state"><h3>No prescriptions issued yet</h3><p>Choose an attended visit to write your first prescription.</p></div> : <div className="issued-prescriptions">{data.items.map(rx => <details className="issued-prescription" key={rx.id}><summary><span><strong>{rx.patient.name}</strong><small>{dateText(rx.issuedAt, rx.clinic.timezone)} · {rx.renewalOfId ? 'Renewal' : 'Visit prescription'}</small></span><span className="status">{rx.medicines.length} {rx.medicines.length === 1 ? 'medicine' : 'medicines'}</span></summary><MedicineReadout lines={rx.medicines} notes={rx.notes}/><p className="field-help">Visit: {dateText(rx.visitStartsAt, rx.clinic.timezone)} · {rx.clinic.timezone}</p>{rx.renewalId && <p className="field-help">A newer prescription has been issued. This record is retained as history.</p>}</details>)}</div>}
    </section>
  </div>;
}
function IssueForm({ data, saved }: { data: CareData; saved: (message: string) => void }) {
  const [visit, setVisit] = useState(data.eligibleVisits.some(v => v.id === data.selectedVisitId) ? data.selectedVisitId! : '');
  const [lines, setLines] = useState<Medicine[]>([blankMedicine()]), [notes, setNotes] = useState(''), [reviewing, setReviewing] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState('');
  const confirmation = useRef({ fingerprint: '', key: '' });
  const selected = data.eligibleVisits.find(v => v.id === visit);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    if (!selected || !validLines(lines)) { setError('Choose an attended visit and complete each medicine’s name, dose, frequency and duration.'); return; }
    if (!reviewing) { setReviewing(true); return; }
    if (pending) return;
    const fingerprint = JSON.stringify({ visit, lines, notes });
    if (confirmation.current.fingerprint !== fingerprint) confirmation.current = { fingerprint, key: crypto.randomUUID() };
    setPending(true);
    try { const result = await clientApi<{ message: string }>(`/clinics/${data.clinic.id}/prescriptions`, { appointmentId: visit, requestKey: confirmation.current.key, medicines: lines, notes }); saved(result.message); setVisit(''); setLines([blankMedicine()]); setNotes(''); setReviewing(false); confirmation.current = { fingerprint: '', key: '' }; }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'The prescription could not be issued. Reload care records before retrying.'); }
    finally { setPending(false); }
  }
  return <section className="panel" id="issue-prescription"><div className="section-heading"><h2>Issue a prescription</h2></div><p className="field-help">Only your attended visits can receive a prescription. Issued medicine details are retained as a read-only record.</p>{!data.eligibleVisits.length ? <div className="empty-state"><h3>No visits ready</h3><p>Record attendance in Appointments first. Visits with an issued prescription are listed below.</p></div> : <form onSubmit={submit} className="care-form"><fieldset className="care-fields" disabled={pending}>{reviewing && selected ? <div className="prescription-preview"><h3>Review before issuing</h3><p>{selected.patient} · {dateText(selected.startsAt, selected.timezone)}</p><MedicineReadout lines={lines} notes={notes}/><p className="field-help">Confirming issues this prescription to the selected patient.</p></div> : <><div className="field"><label htmlFor="prescription-visit">Attended visit · {data.clinic.timezone}</label><select id="prescription-visit" required value={visit} onChange={e => { setVisit(e.target.value); setError(''); }}><option value="">Choose an attended visit</option>{data.eligibleVisits.map(v => <option key={v.id} value={v.id}>{v.patient} · {dateText(v.startsAt, v.timezone)}</option>)}</select></div><MedicineFields lines={lines} change={setLines} prefix="issue"/><div className="field"><label htmlFor="prescription-notes">Additional instructions <span className="muted">(optional)</span></label><textarea id="prescription-notes" rows={3} maxLength={1000} value={notes} onChange={e => setNotes(e.target.value)}/></div></>}{error && <p className="form-error" role="alert">{error}</p>}<div className="care-form-actions">{reviewing && <button className="button secondary" type="button" onClick={() => setReviewing(false)}>Edit details</button>}<button className="button" disabled={pending}>{pending ? 'Issuing…' : reviewing ? 'Confirm prescription' : 'Review prescription'}</button></div></fieldset></form>}</section>;
}
function ReviewCard({ request, clinicId, saved }: { request: Refill & { prescription: Prescription }; clinicId: string; saved: (message: string) => void }) {
  const [decision, setDecision] = useState(''), [reviewNote, setNote] = useState(''), [reviewing, setReviewing] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState('');
  const [lines, setLines] = useState<Medicine[]>(request.prescription.medicines.map(m => ({ ...m }))), [notes, setNotes] = useState(request.prescription.notes);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    if (!decision || reviewNote.trim().length < 2 || (decision === 'APPROVED' && !validLines(lines))) { setError('Choose a decision, write a review note and complete medicine details for an approval.'); return; }
    if (!reviewing) { setReviewing(true); return; }
    if (pending) return;
    setPending(true);
    try { const result = await clientApi<{ message: string }>(`/clinics/${clinicId}/refills/${request.id}/review`, { version: request.version, status: decision, reviewNote, ...(decision === 'APPROVED' ? { medicines: lines, notes } : {}) }); saved(result.message); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'The decision could not be saved. Reload care records.'); }
    finally { setPending(false); }
  }
  return <article className="refill-review"><div className="section-heading"><div><h3>{request.prescription.patient.name}</h3><small>{dateText(request.requestedAt, request.prescription.clinic.timezone)}</small></div><span className="status">Pending</span></div><div className="patient-request"><strong>Patient’s request</strong><p>{request.patientNote}</p></div><details className="original-prescription"><summary>Original prescription · {request.prescription.medicines.length} {request.prescription.medicines.length === 1 ? 'medicine' : 'medicines'}</summary><MedicineReadout lines={request.prescription.medicines} notes={request.prescription.notes}/></details><form onSubmit={submit} className="care-form"><fieldset disabled={pending} className="care-fields">{reviewing ? <div className="prescription-preview"><h3>{decision === 'APPROVED' ? 'Approve and issue renewal' : 'Reject this request'}</h3><p>{reviewNote}</p>{decision === 'APPROVED' && <MedicineReadout lines={lines} notes={notes}/>}</div> : <><div className="field"><label htmlFor={`decision-${request.id}`}>Decision</label><select id={`decision-${request.id}`} required value={decision} onChange={e => setDecision(e.target.value)}><option value="">Choose a decision</option><option value="APPROVED">Approve and issue renewal</option><option value="REJECTED">Reject request</option></select></div><div className="field"><label htmlFor={`review-note-${request.id}`}>Review note for the patient</label><textarea id={`review-note-${request.id}`} required minLength={2} maxLength={1000} rows={3} value={reviewNote} onChange={e => setNote(e.target.value)}/></div>{decision === 'APPROVED' && <><p className="field-help">Review every medicine below. These details will form the new prescription.</p><MedicineFields lines={lines} change={setLines} prefix={`renewal-${request.id}`}/><div className="field"><label htmlFor={`renewal-notes-${request.id}`}>New prescription instructions</label><textarea id={`renewal-notes-${request.id}`} rows={3} maxLength={1000} value={notes} onChange={e => setNotes(e.target.value)}/></div></>}</>}{error && <p className="form-error" role="alert">{error}</p>}<div className="care-form-actions">{reviewing && <button className="button secondary" type="button" onClick={() => setReviewing(false)}>Edit decision</button>}<button className="button" disabled={pending}>{pending ? 'Saving…' : reviewing ? 'Confirm decision' : 'Review decision'}</button></div></fieldset></form></article>;
}
