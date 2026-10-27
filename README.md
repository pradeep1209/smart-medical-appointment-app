# CareSlot

For the current local setup, use [local operation and recovery instructions](docs/LOCAL_OPERATIONS.md): managed start/stop, health checks, private backups and an isolated restore drill. The global PostgreSQL service remains authoritative; no public deployment is configured.

**Sharing the project or setting it up on another Windows computer? Start with [Fresh-computer setup: step 1 to first working booking](#fresh-computer-setup-step-1-to-first-working-booking).** The later migration/folder-move notes describe the original computer and are not first-install instructions.

CareSlot now has a shared account and clinic-directory foundation: a Kotlin patient app, a Next.js clinic dashboard, a NestJS API, and PostgreSQL. The patient app is the sole Android experience. The earlier offline demonstration is archived outside the app build; any existing on-device demo records are retained without being opened or uploaded.

## Shared local version

**Local discovery (1.7.0):** one APK can find its clinic on trusted shared Wi-Fi or a hotspot, save the server identity and reconnect after an IP change. **Clinic connection** is available on sign-in and Account, with discovery, server selection and a manual fallback. Router Wi-Fi and a phone-hosted hotspot were directly tested on the physical iQOO phone; the laptop-hosted hotspot path remains pending. Use the updated network setup in step 5; no per-IP APK rebuild is needed.

Implemented: patient registration and login, encrypted mobile sessions, clinic staff login, administrator-created doctor/receptionist invitations, clinic-scoped patient registrations, doctor directories, logout, and an account-scoped Room directory cache. Clinic staff and patients use individual accounts in the same identity database. The API checks roles and clinic ownership on every protected request; neither client connects directly to PostgreSQL.

The patient app and clinic dashboard share the taste skill's Accent ladder direction: bundled DM Sans, forest-green accents, pale mint surfaces, clearer forms and identity rows. The native app has labelled bottom navigation and read-only doctor profiles; the web workspace has responsive navigation and searchable directories. Counts and directory entries come from PostgreSQL. See DESIGN.md for the shared system and visual-review evidence.

Doctor setup, shared appointments, prescriptions/refills, account/synchronization/reminders and server attendance prediction are implemented. Patients can book/manage visits, view prescriptions and request refills. Doctors manage schedules and assigned visits, issue prescriptions after attendance, and review refills. Administration/reception retain the clinic queue without access to clinical prescribing. Focused local operational checks pass, including backup restoration and service restart; human usability and complete TalkBack acceptance remain pending. This is a local development release using fictional data.

### Patient care tools and clinic records (1.6.0)

Android 1.6.1 uses five persistent tabs: **Clinic · Visits · Care · Inbox · Account**. Care has **Medicines, Reminders and Documents** sections; Inbox opens notifications directly. Account contains optional health details and care-history export. Prescription and visit cards open their relevant documents/summaries with the bottom navigation retained. The old combined tools menu is removed. New tools require a live clinic connection; the existing dated clinical cache remains read-only when disconnected.

Doctors use dashboard **Visit records** for consultation summaries, prescription documents/corrections, documents explicitly shared by patients, and professional details. Administrators edit clinic identity, address, contact information and a PNG logo in **Clinic details**. Reception can use appointment documents but cannot read clinical prescriptions, summaries or shared reports.

- **Prescription copies:** preview, save or share a clinic-branded PDF. Newly issued prescriptions retain the patient/issuer/clinic identity and medicine details captured at issue. Old records explicitly identify when their identity was captured. QR verification shows only the issuer, reference and current status, never patient or medicine details. Corrections create replacement documents; revocation retains history. Copies are electronically issued records without a cryptographic digital signature; registration details are supplied by the clinic.
- **Visit tools:** appointment confirmation PDF, a calendar composer/ICS export, directions when an address is provided, and issued consultation summaries. A doctor can save a private draft for an attended visit, then issue a read-only summary and optional follow-up date. The patient's follow-up action opens that doctor's availability; it does not reserve a slot.
- **Medication reminders:** the patient selects a prescribed medicine and confirms one to six times, time zone and dates matching clinician instructions. CareSlot does not infer dosing. Taken/skipped entries are patient reports. WorkManager revalidates current prescription status before notification delivery; changed prescriptions disable stale schedules. Connectivity and notification permission are required, and Android may delay delivery. A debug-only ten-second test is labelled.
- **Private documents:** patient-owned PDF/PNG/JPEG uploads, at most 5 MB each, 20 active files/50 MB total. A patient must explicitly share a file for a booked or attended consultation. Only its assigned doctor can download it, until the earlier of 30 days after the visit or 90 days after sharing. Cancellation, expiry, revocation and removal end server access. Previously downloaded copies remain separate.
- **Notifications and history:** each account has its own role-scoped inbox and read state. A patient can export a selected period of visits, issued summaries and prescriptions to a care-history PDF; uploaded reports are excluded. Calendar/PDF exports are snapshots, so check the app for current status.

The additive migration preserves existing records. Focused evidence is under `qa/shared/experience/`. The user is handling the remaining PDF acceptance checks. Human usability/full TalkBack and public deployment remain separate; family profiles, chat, payments and video are deferred.

### Server attendance estimates and scheduling simulation (1.5.0)

The API computes an experimental attendance estimate when a visit is booked or rescheduled. It uses the patient's latest 20 recorded attended/missed outcomes in that clinic, with smoothing for new patients. Estimates, inputs, prediction time and model version/fingerprint are retained as snapshots. Android **My visits → About this estimate** shows their meaning; clinic queue details show historical input counts. Connected Android screens perform no local inference. A missing/invalid/disabled model leaves booking usable and records the estimate as unavailable.

In the web dashboard, administrators/doctors can open **Scheduling simulation**. Standard comparison is the default. The optional controlled-overbooking comparison permits at most two synthetic bookings per slot and combined expected attendance at most 1.2. Both policies receive identical synthetic demand/attendance/service draws. The tool reports bookings, attendance, unused slots, collisions, waiting and overtime; it never changes real appointments. Live scheduling retains one booking per slot.

The model is trained on fictional data, not validated patients. Reminder input is false because the server cannot verify phone eligibility. The stress simulation's high-missed-history mix is intentionally different from the independent model evaluation. See [MODEL_CARD.md](docs/MODEL_CARD.md) for these limits. Reproduce deployed-policy metrics using `tools/evaluate_server_model.py` (NumPy required), and compare scenarios by retaining the same seed/session count. Set `ATTENDANCE_MODEL_ENABLED=false` and restart the API to exercise model-unavailable fallback; restore it and restart afterward.

### Accounts, saved records and reminders (1.4.0)

**My account** in both clients supports name editing, password changes and signing out other sessions. Password changes revoke every session and require signing in again. Email changes are not offered without a verified delivery channel. Administrators can remove/restore another staff member's clinic access and revoke unused invitations from **Care team**; existing visits and clinical records are retained. Self-removal is blocked.

Because development addresses are fictional, recovery uses administrator-issued codes. The administrator verifies the person through the clinic's established process, enters a verification note and creates a private code in **Care team**. The patient/staff member enters it in **Recover account**. Codes expire after 30 minutes, work once, supersede earlier codes and revoke all sessions when redeemed. Only hashes are stored. Administrators cannot issue these codes for administrator accounts. A trusted operator with local database access can instead run `node tools/recover-admin.cjs admin-email` in an interactive terminal; its password prompts are hidden. This helper is never an HTTP endpoint. Clinic onboarding remains the existing local setup/seed flow for one configured clinic; self-service multi-clinic onboarding is deferred.

Android saves the latest first page of each visit list and prescriptions in an encrypted, account-scoped Room cache. When the service is unreachable, **Saved copy · read only** includes its timestamp and disables booking changes/refills. More pages require the service. Sign-out and a detected revoked session remove that account's cache and scheduled reminders. Remote revocation cannot erase a disconnected phone until it contacts the API. Request identities for booking/refill retries survive process restarts; no clinical writes are queued or confirmed offline. Reschedule/cancel conflicts still require refreshing the authoritative list.

In Android **My account → Records & reminders**, enable notifications and reminders explicitly. WorkManager schedules a reminder about 24 hours before confirmed visits (or shortly after synchronization for a visit already within 24 hours). Delivery checks the server again, so connectivity is required. Schedule changes/cancellations are reconciled on synchronization and patient changes; background refresh is approximately every 15 minutes when connected. Android battery restrictions may delay work. There are no exact alarms or server push notifications. WorkManager persists work across process/device restarts; a force-stop can prevent work until the app is opened again. The debug-only **Send test reminder (10 seconds)** control is clearly labelled. Notification text contains no medication or doctor details.

### Configure consultation availability

In the clinic dashboard, open **Availability** (or **My availability** as a doctor). Choose a clinician, edit specialty and consultation minutes, enable working days, set opening/closing times, and save. One session per day is supported; use a blocked period for a break. Closing at `00:00` means midnight at the end of that day. All times use the clinic's displayed time zone. Add or remove blocked periods for time off; reasons are private to staff. Concurrent edits are rejected with a reload message rather than silently overwriting another save.

In the Android app, open a doctor's profile and tap **Available times**, then choose a date. The app excludes elapsed times, closed days, partial consultations, blocked periods and overlaps with the doctor's or your existing bookings. Tap a time, review the clinic/date/time/time zone, then **Confirm booking**. Viewing a time alone does not reserve it. A live connection is required; the server rechecks availability when confirming.

### Manage shared appointments

**Cancellation attribution (1.5.2):** cancelled visit cards and Visit history identify whether the patient, doctor, reception or clinic administrator cancelled, with the cancellation time. New events retain actor role/name snapshots. Older patient/assigned-doctor events use their recorded actor identity; other older staff events say “Cancelled by clinic” rather than guessing a historical staff role. Cached records need refreshing before the extra fields appear. The [1.5.2 Wi-Fi APK](output/apk/CareSlot-1.5.2-WiFi.apk) is installed and directly tested on the physical phone; all four cancellation labels and history dialogs passed. Test fixtures were removed and original records/session preserved.

Open **My visits** in the Android app to review upcoming appointments, reschedule with the same doctor, cancel, or inspect visit history. A failed reschedule keeps the original visit. Cancelled and completed records stay under **Past & cancelled**. If a connection fails during a write, the result may be uncertain: refresh My visits after reconnecting before retrying. Retried booking confirmations reuse their request identity while the same confirmation remains in memory; the server also rejects overlapping visits.

Open **Appointments** in the web dashboard and choose the visit date in the clinic time zone. Doctors see only their assigned visits. Staff can cancel future visits; attendance becomes available after the start, and marking missed becomes available after the end. Finished statuses are final in this version. Both clients use the same PostgreSQL records; refresh to see another client's updates. Patient visits are paginated; the daily clinic queue displays up to 500 visits and identifies truncation.

Editing availability never moves or deletes a confirmed appointment. Visits that no longer fit are flagged for review on both clients, with their original time/duration retained. Contact the patient or have them reschedule. Live overbooking, offline confirmation, clinician reassignment and staff-created booking are not implemented. Opt-in reminder delivery follows the synchronization/verification rules above.

### Prescriptions and refill reviews

As the assigned doctor, mark the visit attended, then open **Prescriptions & refills** or the **Visit prescriptions** link from that appointment. Select the attended visit and enter 1–10 medicines with name, dose, frequency, duration and optional instructions. Review the summary, then confirm issuance. One initial prescription is allowed per visit; issued documents are read-only.

The patient opens **My care** to view medicines and instructions. **Request refill** collects a note for the doctor and creates one pending review for that prescription. Patients cannot change medicine details. A rejected request retains its decision note/history and permits a later request. Approval requires the doctor to review and confirm the new medicine details; it creates a separate linked renewal and retains the original document. Older renewed documents can no longer initiate another request. Refill requests cover the prescription as a whole, with the patient's note available to the doctor.

Use **Refresh care records** in the dashboard and **Refresh care** in the app to see changes from the other client. The latest first page of clinical records has a dated, encrypted read-only cache; writes and the new care tools require a live API connection. Approval does not record pharmacy dispensing. Prescription replacement, revocation and PDF export are available in Visit records. Automatic course expiry, drug-interaction checking and pharmacy integration remain outside this release. The doctor enters all medicine decisions; there are no generated treatment suggestions. Legacy offline care-plan text remains retained in the old private database without upload.

## Fresh-computer setup: step 1 to first working booking

This path creates a new local installation with its own accounts and database. The source ZIP does not contain the original computer's PostgreSQL data. To retain existing accounts/records, use the separate backup/restore procedure in [LOCAL_OPERATIONS.md](docs/LOCAL_OPERATIONS.md) instead of creating a fresh database. The helper scripts below target Windows and PostgreSQL 18's standard service name, `postgresql-x64-18`.

### 1. Prepare the source ZIP

Exclude `.env`, `.local/`, `.gradle/`, `.gradle-user/`, `.kotlin/`, `.idea/`, `.taste-skill/`, `node_modules/`, `tmp/`, all generated `build/`/`dist/`/`.next/`/`__pycache__/` directories, `local.properties` and `*.tsbuildinfo`. Exclude `qa/` and `output/` unless deliberately sharing test evidence/APKs. Exclude files from the ZIP without deleting the original private backups or working configuration.

Keep `.env.example`, `package.json`, `package-lock.json`, all application source, `apps/api/prisma/` including migrations, `apps/api/models/`, `app/schemas/`, fonts/assets/licenses, `tools/`, documentation, Gradle configuration, `gradlew`, `gradlew.bat`, and **`gradle/` without the dot**. The included server model is sufficient for inference; Python/retraining is optional.

### 2. Install prerequisites and extract the ZIP

Install Node.js 24, PostgreSQL 18 (pgAdmin optional), and Android Studio. In Android Studio's SDK Manager install Android SDK Platform 35, the required SDK Build-Tools when prompted, and Android SDK Platform-Tools. Use JDK 17 or 21 for this project's Gradle build; configure Android Studio's Gradle JDK and, for terminal builds, `JAVA_HOME` to that JDK. Keep the PostgreSQL administrator password available locally.

Extract the source into a writable project folder. Open PowerShell there; every following project command runs from that folder. Internet access is needed for the first npm/Gradle dependency downloads. Check:

```powershell
node --version
npm.cmd --version
java -version
```

Node must report version 24. Start `postgresql-x64-18` in Windows Services if stopped. Use a standard PowerShell terminal for project commands; Windows network/firewall configuration in step 5 requires an administrator terminal. If scripts are blocked, `Set-ExecutionPolicy -Scope Process Bypass` affects only the current PowerShell session; respect any organization-managed policy.

### 3. Run the automatic first-install initializer

With PostgreSQL running, run this from the extracted project folder. Do not copy `.env.example` to `.env` first—the initializer creates the private configuration itself:

```powershell
.\tools\initialize-local.ps1
```

It installs the locked Node dependencies, then asks for the existing PostgreSQL administrator password in a hidden local prompt. That password is passed only to the initializer process; it is not saved, printed, reset or passed on the command line. The initializer then:

1. Refuses an existing `.env`, database, or conflicting `careslot_owner`/`careslot_app` roles rather than overwriting them.
2. Creates the `careslot` database and separate schema-owner/application roles with the required permissions.
3. Generates independent database passwords, a JWT signing secret and the initial clinic administrator password.
4. Creates private `.env`, `.local/bootstrap-account.txt` and a restricted setup-recovery journal.
5. Generates Prisma Client, applies the migrations and seeds the initial clinic/administrator.
6. Verifies that the administrator exists and the runtime account has no administrator powers.

No manual SQL, JWT generation or password copying is required. By default, the new clinic administrator email is `admin@careslot.local`. Read its generated password from **`.local/bootstrap-account.txt` on that computer** after setup succeeds. The initial server configuration is loopback-only; Wi-Fi setup follows in step 5. Both `.env` and `.local/` remain private and must be excluded from the shared ZIP.

For a different PostgreSQL port/account or clinic identity, supply the relevant options (example):

```powershell
.\tools\initialize-local.ps1 -PostgresPort 5433 -AdminUser postgres -AdminEmail admin@example.local -ClinicName 'Example Clinic'
```

PostgreSQL must already be installed and running; the initializer does not install/start the Windows service. It uses the Node PostgreSQL client and does not require `psql.exe` on PATH. Node.js 24 and internet access for the initial dependency installation are required. If you already ran `npm.cmd ci`, `-SkipDependencyInstall` avoids reinstalling the dependencies.

If a run is interrupted after provisioning begins, preserve `.env` and `.local/initial-setup/`. Resolve the reported error and rerun with **the same options plus `-Resume`**:

```powershell
.\tools\initialize-local.ps1 -Resume
```

Resume verifies the generated configuration, role/database identities and ownership markers, then continues without resetting passwords or duplicating the administrator. It refuses manually changed configuration or mismatched database objects. A completed initializer is a no-op with `-Resume`; ordinary repeat runs refuse the existing configuration. No failed run automatically deletes a database or role. Existing installations should use `setup-shared.ps1` to check their connection and `start-local.ps1` to start services; this is a fresh-install tool, not a database restore/migration replacement.

The fresh installer handles a historical migration-name ordering issue in a private deployment copy, then retains the canonical migration names and original SQL checksums. Applied source migrations and existing databases are not rewritten. Future upgrades use the normal `npm.cmd run db:migrate` command.

### 4. Build/start the API and dashboard

Keep ports 3000 and 3001 available. From the project folder:

```powershell
.\tools\start-local.ps1 -Build
node tools/local-status.cjs
```

Both commands must succeed. Open `http://localhost:3000/login` and sign in with `BOOTSTRAP_ADMIN_EMAIL` and the generated password in `.local/bootstrap-account.txt`. Stay on the same browser hostname after login. Do not use credentials from the original developer's computer. If a different service occupies a port, identify it first; the startup helper refuses to stop unrelated processes.

### 5. Configure this computer's trusted Wi-Fi

Connect the computer and phone to the same trusted local network. Both may use a router, the phone may provide a hotspot to the computer, or the computer may provide a mobile hotspot to the phone. Enable the hotspot and connect the other device before running setup so its adapter can be detected.

Stop CareSlot's helper-managed API/dashboard:

```powershell
.\tools\stop-local.ps1
```

Open **PowerShell as administrator**, change to the project folder, and run:

```powershell
.\tools\configure-wifi.ps1 -TrustPrivateNetwork
```

Use `-TrustPrivateNetwork` only for a trusted network. The helper detects active Wi-Fi/Wi-Fi Direct adapters, records their names rather than a fixed IP, and adds Private/local-subnet firewall rules for TCP 3001 (API) and UDP 3002/5353 (local discovery), scoped to Node and those adapters. PostgreSQL and the web dashboard stay local. A specific adapter can be selected with `-InterfaceAlias 'Wi-Fi'`; multiple names are accepted, including the actual adapter name Windows uses for Mobile Hotspot. `-Address YOUR_CURRENT_IPV4` remains supported to identify one adapter. The script prints its current clinic address for manual connection. Return to the standard project terminal:

```powershell
.\tools\start-local.ps1
node tools/local-status.cjs
```

Both must succeed. The scripts create their needed `.local/` directories; the original `.local/` is not required. Each tool creates only its own files—old database backups, account notes and test state are not regenerated automatically.

### 6. Build the Android APK for this computer

Open the extracted project in Android Studio, let it locate/configure the Android SDK, and sync Gradle. Its generated `local.properties` must refer to this computer's SDK. In the project PowerShell terminal, confirm `JAVA_HOME` points to JDK 17 or 21 and run:

```powershell
.\gradlew.bat assembleDebug
```

The resulting APK is **`app/build/outputs/apk/debug/app-debug.apk`**. CareSlot 1.7 discovers the backend at runtime; this APK can be shared between computers without rebuilding for each IP. An old configured URL is only a starting hint. A new installation automatically selects a single reachable server; if several are found, use **Clinic connection** on the sign-in screen (also available under Account) to select yours. It remembers a signed server identity and rediscovers the same installation when its IP changes. Choosing a different server requires signing out first. An existing session upgrading from an old APK must first reach its original configured address to establish the identity, or explicitly sign out before choosing another connection.

Discovery combines mDNS/DNS-SD and a bounded local UDP broadcast fallback for hotspots. If discovery is blocked, use **Clinic connection → Enter an address** with the computer's current address. Network isolation can block even manual communication. Connect only to trusted local networks: the development APK allows private-IP HTTP through an application URL allowlist; release builds continue to require HTTPS. Server identity pinning prevents accidental cross-server session forwarding; it does not encrypt development HTTP traffic. Rotating the server's JWT signing secret also changes its discovery identity, requiring sign-out and reselection.

On an already-approved adapter, DHCP address changes are followed without restarting the API or rebuilding the APK. If switching to a new adapter (for example, first enabling Windows Mobile Hotspot), rerun step 5 to approve it. Each new Windows network must be marked Private before its scoped firewall rules apply. Physical router, phone-hotspot and laptop-hotspot operation must still be checked on the target hardware; a successful build or computer-only probe is not that validation.

### 7. Install on the physical phone

For a manual installation, send `app/build/outputs/apk/debug/app-debug.apk` to the phone, open it and allow installation from the selected file manager/browser. No USB debugging is required for that method.

Alternatively, enable Developer options and USB debugging, connect a data-capable USB cable, unlock the phone, and accept its debugging prompt. With the default Android SDK installation:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" -s YOUR_DEVICE_SERIAL install -r app/build/outputs/apk/debug/app-debug.apk
```

Replace `YOUR_DEVICE_SERIAL` with the serial reported by `adb devices`; its state must be `device`, not `unauthorized`. Use the actual SDK path if different. A first install is supported. `install -r` preserves data on a compatible update. An existing APK signed with a different computer's debug key may cause `INSTALL_FAILED_UPDATE_INCOMPATIBLE`; do not uninstall to bypass this when on-device records need preserving. Coordinate the signing key or use a separate test device/profile instead.

USB can be disconnected afterward: the app communicates over Wi-Fi. Keep the computer awake, PostgreSQL and the API running. No `adb reverse` is needed for this Wi-Fi build.

### 8. Complete the first patient/doctor workflow

1. In the dashboard, the administrator opens **Care team** and invites a fictional doctor. Open the invitation in another browser session, create the doctor's password, and sign in as that doctor.
2. Set the doctor's specialty, consultation duration and working hours under **My availability**. Add clinic address/contact details from the administrator's **Clinic details** page as desired.
3. On Android, create a fictional patient account. Confirm it appears in the administrator's Patients directory and that the app's Clinic tab lists the doctor.
4. Open the doctor, choose an available future time and confirm a booking. Check the same visit in the doctor's dashboard queue.
5. Once the visit's start time has passed, the assigned doctor can mark it attended, issue a fictional prescription and consultation summary, and recommend a follow-up. The app shows these in **Care → Medicines**, the visit's details and **Inbox**. Future visits cannot be marked attended early.
6. Use **Care → Reminders/Documents** for reminder schedules/private reports and **Account** for health details/history export. Manually verify PDF preview/save/share/QR workflows on the chosen devices.

This is a fresh database: the original doctor's/patient's login and records will not appear automatically. Use fictional medical content for the local demo.

### 9. Stop and restart later

```powershell
.\tools\stop-local.ps1
```

This stops only helper-managed API/dashboard processes, leaving the global PostgreSQL service intact. After a computer restart, start PostgreSQL if needed, then run `.\tools\start-local.ps1` and `node tools/local-status.cjs`. Use `-Build` after API/dashboard source changes, with those services stopped. For backups and recovery, see [LOCAL_OPERATIONS.md](docs/LOCAL_OPERATIONS.md).

### Quick troubleshooting for the new computer

| Problem | Check |
| --- | --- |
| Database connection/role error | PostgreSQL service/port and initializer error; preserve its journal and use `-Resume` for an incomplete setup. |
| Missing table or permission error | Successful initializer completion, correct generated connection URLs and owner-role migrations. |
| JWT configuration rejected | The initializer generates it; check that the private `.env` was preserved and no template replaced it. |
| Port already occupied/unexpected health response | Identify the listener on 3000/3001; stop/reconfigure only a service you own. |
| Phone says clinic cannot be reached | Shared local network/hotspot, running updated API, approved adapter, Private firewall rules and awake computer. Open Clinic connection and search, or check its printed current address manually; isolation can block both. |
| ADB unauthorized/no device | Unlock/allow debugging, check cable/drivers and SDK Platform-Tools. |
| Cannot run PowerShell scripts | Process-scoped execution policy if permitted, or ask the machine administrator. |
| Empty doctor directory/no slots | Accept a doctor invitation, configure working hours, and check the clinic date/time zone. |

The initializer is tested against a disposable local PostgreSQL cluster with actual migrations and seeding, interruption recovery, collision/overwrite refusal, runtime permissions and secret-redaction checks. A separate Windows computer and its Android toolchain still require a recipient-side setup check.

## Existing installation and relocation notes

The following sections describe the original working installation, development commands and its historical database move. A friend starting fresh should follow the numbered guide above.

### Start the shared services on Windows

Requirements: Node.js 24, the running PostgreSQL 18 Windows service, Android SDK 35, and JDK 17 or newer. CareSlot uses a dedicated `careslot` database in the existing service at `127.0.0.1:5432`. Its database files are managed by that service outside the project folder. Application and schema-migration roles remain separate. Local connection settings live in ignored `.env`; `.local/` contains development credentials and migration backups.

The earlier project-owned database on port `55432` has been transferred with its records, account passwords, IDs, and Prisma history preserved. The retired cluster was stopped after verification. Its data files and original private folder were not carried into the relocated source folder. A fresh backup of the active service database is now in `.local/database-backups/`. Historical transfer evidence is in `qa/shared/database-service-migration.json`; the completed folder move is recorded in `qa/shared/relocation.json`.

For another copy of the earlier setup that still uses port `55432`, close its API, disconnect its old pgAdmin connection, and run `.\tools\migrate-to-service.ps1`. Enter the existing `postgres` administrator password at the hidden local prompt. This helper refuses to overwrite an existing target database or role, verifies every public table's row count and content hash, then changes `.env` and stops only the old project cluster. No PostgreSQL administrator password is saved or reset.

From the project folder, use these commands after installing dependencies or restoring the project (already completed on this computer):

```powershell
npm.cmd ci
.\tools\setup-shared.ps1
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run db:seed
```

On subsequent starts, keep the Windows PostgreSQL service running; `.\tools\setup-shared.ps1` is an optional connection check and does not start another database. Keep two terminals open:

On this computer, `postgresql-x64-18` currently has **Manual** startup. After a Windows restart, start it through the Services application before starting CareSlot. You can choose Automatic startup there if you want PostgreSQL to start with Windows.

```powershell
# Terminal 1: compile and start the API on 127.0.0.1:3001
npm.cmd run dev:api
```

```powershell
# Terminal 2: clinic dashboard on localhost:3000
npm.cmd run dev:web
```

Open **http://localhost:3000**. Sign in with `BOOTSTRAP_ADMIN_EMAIL` and the administrator password configured when this database was first seeded. An older local setup may have an account note in `.local/bootstrap-account.txt`, but the seed does not create that file or reset an existing administrator's password. Invitation links are copied manually in this release; no email is sent. Open a copied invitation in a separate browser session to create a doctor's or receptionist's password, then sign in.

In development, `http://127.0.0.1:3000` also works: login and CSRF validation accept loopback aliases only when their protocol and port match `WEB_ORIGIN`. Production accepts only the configured origin. Stay on the same address after signing in because browser cookies belong to that address. After API source changes, restart `npm.cmd run dev:api` to compile them.

Use Ctrl+C in each terminal to stop the API and web dashboard. Leave the shared PostgreSQL service running. `stop-shared-db.ps1` is retained only for the legacy project cluster; it never stops the Windows service. Keep `.env` when moving the project; it contains the connection credentials and JWT secret.

Stop the web development server before running `npm.cmd run build:web`, then restart it afterward. Running both against the same generated output has produced stale server/client navigation during local testing.

### View the database in pgAdmin

Use your existing PostgreSQL server connection on port `5432`, then refresh **Databases** to see `careslot`. Expand **careslot → Schemas → public → Tables**. Alternatively, register a separate connection with host `127.0.0.1`, port `5432`, maintenance database `careslot`, username `careslot_app`, and its password from `DATABASE_URL` in `.env`. The old port `55432` connection is no longer active.

### Project location and future folder moves

Current folder: `C:\project\smart medical appointment app`. Workspace links and Prisma have been regenerated here. `.env` was retained; the development login note and a fresh service database backup were recreated because the previous `.local` folder was not carried over.

For future moves:

1. Stop the API and web development terminals and close Android Studio's project. The legacy database cluster must be stopped; the completed transfer is recorded in `qa/shared/database-service-migration.json`.
2. Move the entire folder to your desired Projects directory, including hidden `.env` and `.local` files. The active PostgreSQL database stays in the service's data directory and needs no folder move or connection change.
3. Open PowerShell in the new project folder. Run `npm.cmd ci` to rebuild workspace links for the new location, then `npm.cmd run db:generate` and `.\tools\setup-shared.ps1` to confirm the database connection.
4. Reopen the relocated folder in Android Studio and Codex, and sync Gradle. Shared-service scripts resolve paths from their own project location. Existing build outputs and IDE caches can contain the old location; rebuild the API, web app, and APK in the new folder when needed.
5. Start the API/dashboard as before. A move on this computer keeps the Wi-Fi address and local Android build setting; a different computer/network requires Wi-Fi setup and an updated APK.

Moving to a different computer also requires a PostgreSQL backup/restore, installing the toolchains, and checking `.env` host/port settings. Keep `.local/database-backups/` private: its backups contain application data and credentials. If a transfer stops with `NEEDS_REVIEW` or `PENDING_CONNECTION_SWITCH`, review its status and backups before retrying or moving the folder; do not delete databases or reset account passwords as a shortcut.

### Connect your physical Android phone

The installed **1.6.1 (226) Wi-Fi APK** calls `http://192.168.0.3:3001/api/v1`. Keep the phone and computer on the same trusted Wi-Fi, keep the computer awake, and run the API/PostgreSQL. USB forwarding is not needed. The existing signed-in patient and records are preserved. See [Wi-Fi setup and address-change instructions](docs/LOCAL_OPERATIONS.md).

USB debugging is still useful for installing an update (use the Android SDK `platform-tools` path if `adb` is not on PATH):

```powershell
adb devices
adb -s YOUR_SERIAL install -r output/apk/CareSlot-identity.apk
```

Open CareSlot and choose **Create a patient account** for a new identity. Use a fictional name and email with a password of at least 12 characters. Staff accounts sign in on the web dashboard. Install as an update; uninstalling would delete local records. An intentionally built loopback APK still requires `adb reverse tcp:3001 tcp:3001`; the Wi-Fi APK does not.

To rebuild: `.\gradlew.bat assembleDebug`. The ignored `.local/android-wifi.properties` and `-PcareslotApiUrl=...` supply a starting hint for older sessions; CareSlot 1.7 saves and discovers its selected server at runtime. The original output is `app/build/outputs/apk/debug/app-debug.apk`. The current discovery APK is [CareSlot-1.7.0-Local.apk](output/apk/CareSlot-1.7.0-Local.apk). Debug builds permit changing private-IP HTTP endpoints through the app's URL validation. A deployed release requires an HTTPS API URL via `-PcareslotReleaseApiUrl=https://YOUR_HOST/api/v1` and proper release signing.

### Your manual acceptance checks

Build verification and database provisioning are separate from acceptance. At your updated request, the primary agent tests each completed mobile pass directly on your physical phone; no testing subagents are used. You can also perform the acceptance checks below. The authenticated mobile regression is recorded in `qa/shared/mobile-pass-20261025/`; availability API, browser, and phone evidence is in `qa/shared/availability/`. Sign-in/registration and full TalkBack acceptance remain pending.

1. Sign in as the administrator. Confirm the clinic directory and registration counts match saved records.
2. Invite a fictional doctor, open its private link in a separate browser session, choose a password, and sign in. Confirm the doctor has no Care team or Patients administration links. Reusing the accepted link must fail.
3. Register a fictional patient in the Android app. Confirm its name/email on Account and the invited doctor in the clinic directory. Refresh the web Patients page and confirm the registration appears.
4. Invite and sign in as a receptionist. Confirm Patients is available and Care team is unavailable. Attempting an administrator-only URL directly must not expose team data.
5. Try an incorrect password, duplicate patient email, invalid registration fields, and a staff account in the patient app. Confirm clear errors and no accidental role changes.
6. Close/reopen the app. After loading the directory once, disconnect Wi-Fi to inspect the dated cached directory; reconnect afterward. First-time registration and login require the API connection. Disconnecting USB does not interrupt the Wi-Fi APK.
7. Sign out, then sign in as a second fictional patient. Confirm the identity changes and the previous account's cache is not displayed. Keep the Wi-Fi/API connection available for online logout; offline logout explicitly explains that only this phone's saved session is removed.
8. Reopen the updated app and confirm the existing patient account remains signed in. The retired demo screens and profile switch are no longer part of the app.

Doctor accounts open **My workspace**, their consultation profile, availability, assigned appointments, prescriptions/refills and scheduling simulation. Their previous `/doctors` link redirects to the personal profile. Administrators and receptionists retain the clinic Doctors directory. The doctor's workspace links to the actual assigned appointment queue and does not show clinic administration counts. For the manual role check, inspect the personal screens and old `/doctors` URL, confirm assigned visit ownership, and verify administrator/reception accounts still see their directory.

Record any failures and reproduction steps for fixes. The user has confirmed patient registration appears in the administrator dashboard and the doctor appears in the patient app. Remaining manual checks, including the updated app without the demo, are **pending your testing**. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the boundaries and subsequent implementation stages.

## Attendance model development

The connected API uses the server JSON artifact; the Android adapter/asset remain reference material only. Training runs on the development computer through [tools/train_model.py](tools/train_model.py), which exports the parameters and archives server artifacts by SHA-256. Original and server-policy evaluations are separate and reproducible. See [docs/MODEL_CARD.md](docs/MODEL_CARD.md) for synthetic-data assumptions and model limitations.

## Archived prototype

The retired local appointment, prescription, and reminder screens and QA helpers are preserved under [legacy/android-demo](legacy/android-demo/README.md), outside the Android source sets. They are not included in the APK. Updating the app retains its old private databases but removes demo entry points and retires old reminder alarms and the demo notification channel. The connected account, directory cache, and PostgreSQL records are unchanged.

## Project documentation

- [Architecture and implementation stages](docs/ARCHITECTURE.md)
- [UI system](DESIGN.md)
- [Model card](docs/MODEL_CARD.md)
- [Historical test ledger and shared-version checks](qa/README.md)
