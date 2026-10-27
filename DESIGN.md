# CareSlot interface system

The 1.5.0 prediction extension retains Accent ladder seed 1874909154, DM Sans and the existing green face; no redraw. Scheduling simulation answers which capacity/waiting trade-offs a policy creates, with a paired numeric table and explicit synthetic assumptions. Patient estimates are secondary to confirmed visit details and open a provenance explanation. Model failure states preserve normal appointment actions. Comparison columns wrap within narrow screens rather than hiding the alternative policy off-screen.

The current interface covers the connected Kotlin patient app and Next.js clinic workspace. The offline prototype is archived; its old screen patterns are not the current design.

## Direction

Taste skill: Accent ladder, seed 1874909154. A new brief replaced the earlier framed-sheet layout because its large empty frame and weak native identity did not meet the user's visual expectations. The new draw kept the green brand palette and selected DM Sans. There were no redraws within this direction.

The face is CareSlot's forest-green tint scale and calendar/check mark. The signature content is the clinic connection, named clinician, specialty, and consultation duration. These are real objects with useful identity, not decorative charts or invented appointment counts.

## Shared tokens

| Role | Value |
| --- | --- |
| Ground | #F6F9F7 |
| Surface | #FFFFFF |
| Main ink | #1C3D31 |
| Body | #293B32 |
| Muted text | #607167 |
| Accent | #2C7057 |
| Pale accent | #EAF3ED |
| Border | #E1E9E3 |
| Input outline | #C8D6CC |
| Error | #9E3F34 |

DM Sans is bundled locally in both clients; no runtime font download is required. Source: Google Fonts' google/fonts repository, ofl/dmsans. The SIL Open Font License is included under assets/licenses, Android assets/licenses, and the web public/fonts folder. Weights are regular 400, medium 500, semibold 600, and title 700.

Use flat fills, pale tints, and quiet borders. Resting panels have no shadow. The mobile web menu is a floating overlay and is the sole shadow exception. Initials identify people; no stock doctor photos or medical illustrations imply verified identities.

## Native Android

Native Views remain in use. UiKit and CareTokens centralize the family, scale, fields, avatars, cards, controls, and bottom navigation. The theme also loads DM Sans for native dialogs.

Version 1.6.1 replaces the mixed care-tools menu with five persistent, short-labelled destinations: Clinic, Visits, Care, Inbox and Account. The same navigation component is used on the main patient screens and the care/document activities, with a selected state and at least 48 dp touch targets. Care groups Medicines, Reminders and Documents in a compact section switcher. Inbox is direct; health details/history export belong to Account. Document detail screens return to their relevant visit or care context, retaining the Past visit selection. Forest green, DM Sans and the existing pale tint system remain unchanged. Direct phone evidence is in `qa/shared/navigation/`; PDF actions remain user-tested.

- Titles are 30sp; names are 17-19sp; body is 13-15sp; secondary details are 11-12sp. All text scales in sp and wraps.
- Screen gutters are 24dp, cards have 20dp padding and an 18dp radius, and inputs have a 12dp radius.
- Primary buttons are at least 52dp tall; inputs at least 54dp; bottom destinations at least 68dp. The avatar account action has a 48dp hit area.
- Sign-in and Create account are a functional segmented control. Selecting the current tab preserves typed data. Password visibility is explicit, resets when the mode changes, and is not persisted to disk. Inputs show focused, disabled, error, and pending states.
- The care-team screen leads with the actual clinic and doctor identity. A doctor row opens a read-only profile dialog. Refresh is secondary, with a timestamp for cached data. Offline information is labelled clearly.
- My clinic and My account use labelled bottom navigation with selected semantics and a pale icon indicator. The account screen retains the existing sign-out behavior and offline confirmation.
- Booking, visit management and clinician-issued care use live API records. Saved clinical copies have a timestamp and read-only label; change actions return after a successful refresh.

Account controls extend the same Accent ladder direction and seed, with no redraw. The account screen answers who is signed in and how to manage access; Records & reminders answers what is saved and whether notifications are enabled. Staff access controls sit beside the affected membership. Recovery asks for verified identity before exposing a private single-use code. Tables stack into labelled identity/access groups on narrow screens. No new decorative assets or chart patterns were added.

## Clinic web workspace

The ruled frame uses a 224px sidebar and a 64px header with real page/account context. The canvas uses consistent 24-32px gutters and fluid columns. The sidebar folds into a labelled menu below 1100px, including sign out. Page titles are 26-30px; body 14px; labels 13px; secondary metadata 11-12px.

Overview counts come from PostgreSQL. Doctors see their own consultation profile instead of clinic administration metrics. Directory search filters the records already loaded by the API; patient search is explicitly limited to the latest registrations returned. Table rows become two-line groups below 600px without dropping email, specialty, duration, or registration date. Settings use a profile summary beside a key/value panel and stack on smaller screens.

Keyboard focus is visible, labels remain attached to inputs, and reduced-motion preferences disable the only spinner animation. Password visibility controls have explicit accessible names. The user continues to perform functional acceptance checks.

## Each screen's first question

| Screen | Question |
| --- | --- |
| Patient sign-in / registration | How do I connect to my own clinic account? |
| Patient My clinic | Who is on my care team, and where do I belong? |
| Patient My account | Which patient is signed in, and how do I sign out? |
| Clinic sign-in | How do I access my clinic workspace? |
| Administrator / reception overview | Who is connected to this clinic? |
| Doctor workspace | What consultation profile do my patients see? |
| Doctors | Which clinicians can patients find? |
| Patients | Which patients have registered with this clinic? |
| Care team | Who has clinic access, and who needs an invitation? |
| Account / consultation profile | Which identity, clinic, role, and consultation details am I using? |
| Consultation availability | When does this doctor work, and which periods are blocked? |
| Patient available times | Which full consultation times are currently available on this date? |
| Patient My visits | What is confirmed, and how do I change or cancel it? |
| Clinic appointments | Who is scheduled on this clinic day, and which visits need attention? |
| Patient My care | What did my doctor prescribe, and what happened to my refill request? |
| Doctor prescriptions/refills | Which attended visit needs a prescription, and which requests await my decision? |

## Visual review and limits

The taste inspector rendered the real sign-in page at 1440, 768, and 390px. The final report has zero failures. The desktop centered sign-in pane deliberately retains two measurement warnings: its form is capped at a readable width with equal internal side margins, and its vertical whitespace centers authentication rather than stretching a data card. Source lint has zero failures; its one shadow warning is the floating mobile menu, where the skill explicitly allows a shadow.

All three web screenshots and the actual phone's My clinic screen were reviewed. The phone screen showed the existing patient session, live clinic directory, and updated native typography/navigation. Account capture was skipped when CareSlot was no longer foreground. Native authentication and account screens, large text/TalkBack, protected web role screens, and end-to-end functional regression remain for the user's manual review. No testing subagents were used and no fictitious visual data was added.

Evidence: qa/shared/ui-refresh/. Keep the skill's measurements separate from functional acceptance: a successful build or a screenshot is not proof of every workflow.

The availability pass retains the same Accent ladder tokens and DM Sans. Weekly hours use labelled day toggles and paired time inputs; time off has its own form, explicit clinic time zone and staff-only reasons. Doctor and administrator writes show success/errors and reject stale edits; reception sees disabled fields. On the phone, doctor details lead to a date selector and a plain list of real consultation times with an explicit reservation disclaimer. No button implies that viewing a time books a visit.

The appointment pass adds a third labelled mobile destination, My visits, with Upcoming and Past & cancelled views. Consultation times are explicit touch targets leading to a confirmation summary. Rescheduling distinguishes the current time from selectable replacements and explains that the original visit stays confirmed until the replacement succeeds. Visit cards show actual server status, duration and clinic time zone, with separate reschedule, cancellation and history actions. Clinic queues place time first, patient identity second and context actions last; the layout stacks below 700px. Schedule conflicts use a small amber notice rather than changing the entire card's colour. Histories are expandable, with previous/new schedule values shown in words.

Appointment views were inspected on the actual phone at normal and 1.3 text scale and in confirmed landscape orientation. The authenticated doctor queue was reviewed at 1440, 768 and 390px, with zero final app-layout findings, horizontal overflow or browser exceptions. Source lint keeps only the existing permitted shadow and clock-format warnings. Evidence and the fixed reschedule crash are under qa/shared/appointments/.

My care adds a fourth labelled native navigation destination. Prescription cards identify the doctor, clinic and visit; medicine details are plain read-only text with separate dose/frequency/duration labels. The latest refill decision and doctor note remain visible, with full history in a scrollable dialog. Renewals are distinct documents; superseded records explain why they no longer offer a new request.

The doctor's workspace separates prescription entry and refill reviews into task views with mounted form state retained during switching. Entry/approval include a review step before confirmation. No medicine, dose or frequency is suggested by the UI. The screenshot loop replaced the initial uneven side-by-side forms and tightened excess spacing in decision history. The design continues the existing DM Sans/forest-green Accent ladder without introducing a new theme.

Authenticated availability screens were rendered and reviewed at 1440, 768 and 390px. App-layout checks reported zero failures, no horizontal page overflow, and one desktop warning for the independent weekly-hours and time-off panels ending at different heights. Those forms align at the top and keep natural content heights, avoiding stretched empty panels. The actual phone showed correct time-off exclusion and cross-client specialty updates. Larger text at 1.3, rotation, scrolling, error/retry, and account navigation were checked; original display settings were restored. Evidence: qa/shared/availability/. Full TalkBack and authentication regression remain pending.
