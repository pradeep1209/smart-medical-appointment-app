# CareSlot user journeys and acceptance criteria

This offline college demonstration uses fictional profiles on one phone. Profile switching demonstrates ownership and workflows, not authentication. All medication decisions are entered by a clinician demo profile. No account, backend, or internet connection is needed.

## Patient journey

1. Choose a local patient profile, or add a named fictional profile.
2. Home shows that patient's next visit and the doctor directory.
3. Select a doctor, read specialty and consultation duration, and open booking.
4. Choose a date within 60 days and an available time. Past slots, blocked periods, and patient overlaps are rejected.
5. Review patient, doctor, date, time, visit length, shared-slot status, and reminder preference before confirmation.
6. Visits opens on Upcoming with the confirmed appointment. Details allow rescheduling and cancellation with confirmation.
7. Rescheduling validates the new slot before changing the original appointment. Failure leaves the original unchanged. Appointment identity and history are preserved.
8. Notification permission can be declined without blocking booking. Reminder settings explain approximate delivery and device restrictions.
9. Plans shows only the selected patient's prescriptions and legacy care plans. A refill request becomes Pending; another request is unavailable until reviewed.
10. A reviewed request shows Approved or Rejected, the clinic note, and its history. Approval records a demo decision; it does not dispense medication.

## Clinic journey

1. Explicitly switch to Clinic demo mode. Patient screens and clinic operations are separate destinations.
2. Dashboard shows today's visits, outstanding bookings, refill requests, and schedule conflicts.
3. Select a doctor to edit working weekdays, start/end time, consultation duration, and date-specific blocks.
4. Schedule changes retain existing visits and flag affected future bookings for review. Clinic can inspect and reschedule conflicts.
5. Record Attended or No-show only after the scheduled start, or cancel a booked appointment. Completed outcomes cannot be silently overwritten.
6. Choose an attended visit to issue clinician-entered medication, dose, frequency, duration, and instructions. Required fields have inline errors. Legacy plans remain readable.
7. Review pending refills with an approve/reject decision and a required review note. Duplicate review attempts are rejected.
8. Model status explains synthetic training, version, fallback behavior, and history-derived prediction inputs. Overbooking is explicitly a simulation and is off by default.

## UI behavior

| Situation | Required behavior |
| --- | --- |
| No upcoming visits | Explain the empty list and offer Book a visit. |
| No previous visits | Explain that completed, missed, and cancelled visits appear in Past. |
| No care plans | Explain when clinic instructions become available. |
| No availability | Show a specific reason and allow changing date or doctor. |
| Invalid form | Keep entered values and identify the field to correct. |
| Cancel visit | Ask confirmation; show Cancelled afterward and release future capacity. |
| Confirm/reschedule | Show a review summary before mutation, then a persisted result. |
| Model unavailable | Standard booking works; predicted percentages and simulation are unavailable. |
| Notifications denied | Booking succeeds; show a clear reminder status. |
| Storage failure | Show a retryable error without pretending the mutation succeeded. |
| Device rotation | Preserve navigation, filters, and the booking draft. |
| Large text | Text wraps or scrolls; actions remain reachable. |

## Per-phase acceptance gates

Each phase requires an APK build, installation over existing data, a dedicated testing subagent, actual phone checks, evidence under `qa/phase-XX`, and a defect retest when necessary. Documentation phases verify current UI and record future capabilities as gaps rather than failed implemented behavior. Unit/domain checks complement phone testing; they do not replace it.

Human volunteer usability sessions must be performed by real people. Automated tests may prepare the script and record results but cannot claim human observations.
