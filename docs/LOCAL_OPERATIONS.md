# Running and recovering CareSlot locally

CareSlot remains on this Windows computer. PostgreSQL stays in the global `postgresql-x64-18` service and the built dashboard stays on loopback port 3000. The API supports explicit trusted-Wi-Fi development access on port 3001 while retaining loopback access for the dashboard. The phone can synchronize over the same Wi-Fi without USB forwarding. Disconnected clinical copies remain read-only. No public hosting or router port forwarding is configured.

## Start, stop and inspect

For a fresh computer, install Node.js 24 and PostgreSQL 18, start PostgreSQL, and run `.\tools\initialize-local.ps1` from the extracted source folder before using the start commands. It installs Node dependencies, prompts locally for the PostgreSQL administrator password, creates dedicated roles/database, generates private configuration/signing credentials, applies the migrations and seeds the initial administrator. The generated sign-in note is `.local/bootstrap-account.txt`. It refuses pre-existing installations; `-Resume` continues only a matching owned recovery journal. The PostgreSQL administrator password is never saved or printed. See the numbered fresh-computer guide in README.md for Wi-Fi and Android setup.

Start PostgreSQL in Windows Services if it is stopped. From the project folder:

```powershell
# First start or after source changes; API/dashboard ports must be free for rebuilding.
.\tools\start-local.ps1 -Build

# Subsequent starts reuse the saved build.
.\tools\start-local.ps1
node tools/local-status.cjs

# Stop only the API/dashboard started by this helper. PostgreSQL stays running.
.\tools\stop-local.ps1
```

The helper uses hidden processes and private logs under `.local/local-services/`. It checks readiness before reporting success and records process IDs, entry paths and start times. Stop verifies all three before acting, preventing a reused PID from stopping an unrelated process. A pre-existing healthy service can be reused but is not adopted or stopped by the helper. No Windows startup task or recurring automation is installed.

Open `http://127.0.0.1:3000/login`. Keep the same browser hostname after signing in. For the installed **1.6.1 Wi-Fi APK**, put the phone and computer on the same trusted Wi-Fi and keep the computer awake, PostgreSQL running and the API running. The current API address is `http://192.168.0.3:3001/api/v1`. USB is used only for installation/device inspection, not app synchronization.

Wi-Fi setup was explicitly authorized for this trusted network. Run `tools/configure-wifi.ps1 -Address 192.168.0.3 -TrustPrivateNetwork` as administrator to configure the network. It sets only the Wi-Fi profile to Private and creates the named `CareSlot-Local-WiFi-API` inbound rule. The rule permits Node TCP 3001 only on that Wi-Fi address, interface, Private profile and local subnet. It does not add a database/dashboard rule or change PostgreSQL configuration. The API rejects requests arriving through the computer's other interface addresses. Production mode rejects this development option.

Setup stores API host/address in private `.env` and the debug build URL in ignored `.local/android-wifi.properties`, so future debug builds retain Wi-Fi access. A Gradle `-PcareslotApiUrl=...` argument overrides that setting. The debug network policy is generated for the selected host only; release builds still reject HTTP. HTTP Wi-Fi mode is for this fictional-data development setup; public deployment remains a separate HTTPS decision.

If the router changes the computer's Wi-Fi address, stop the API/dashboard, rerun setup with the new address, rebuild/install the APK and restart the services. Reserving the computer's address in your router avoids repeated setup. Guest Wi-Fi or client isolation can prevent communication despite matching subnet addresses.

For an intentionally built **loopback/USB APK** only, connect/unlock the phone, allow USB debugging, and run:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" reverse tcp:3001 tcp:3001
```

To disable Wi-Fi access, stop the services, set `ALLOW_LAN_DEV=false` and `API_HOST=127.0.0.1`, remove `API_LAN_ADDRESS` from `.env`, remove `.local/android-wifi.properties`, and remove only the named firewall rule as administrator. Rebuild/install a loopback APK if needed. The trusted network profile change is retained unless you choose to change it back in Windows settings.

## Backup and verified restoration

```powershell
node tools/backup-local.cjs
node tools/backup-local.cjs --verify-restore
```

The first command creates a private custom-format PostgreSQL dump using an exported repeatable-read snapshot. Its manifest contains per-table row counts/content hashes, the dump checksum and copied model artifacts. It uses the owner connection from `.env`; no password is passed on the command line or printed. `.env` itself is not included. Windows backup-directory permissions are restricted to the current user and SYSTEM.

The second command additionally initializes a **disposable verification cluster** on loopback port 55433, restores into a fresh database, and compares every public table against the same snapshot. This is a restore drill, not the app's active database. It stops/removes only that generated cluster. The active service, database, roles and `.env` are unchanged. A stopped/unremoved verification cluster or failed comparison is an error, not a successful recovery. Private command diagnostics are kept beside the backup.

Backups live under `.local/database-backups/backup-*`; checksums are in each `manifest.json`. They contain account hashes, sessions and clinical data: keep them private, retain a separate protected copy off this computer, and store the environment secrets separately. The latest verified drill receipt is `qa/shared/local-readiness/backup-restore.json`. Run another backup before schema changes and after records you need to preserve have changed; no schedule is created automatically.

For an actual recovery, stop the API/dashboard, retain the damaged database, and have the PostgreSQL administrator create a **new empty database owned by `careslot_owner`** in the global service. Verify the chosen dump's checksum against its manifest, then restore with `pg_restore --no-owner --exit-on-error` using the owner account, retaining the existing dedicated roles/ACLs. Do not restore over the active `careslot` database. Compare table contents and migration history before switching connection paths in the private `.env`. Revoke all restored authentication sessions and unused recovery codes before opening the recovered app, since a backup may predate a logout/revocation. Keep the previous database until acceptance succeeds. This live cutover is deliberately not automated or performed by the verification helper.

The API schema and model artifacts belong together. Model version/fingerprint in attendance snapshots identifies the archived parameters. Android caches are disposable copies; authoritative visits/prescriptions are in PostgreSQL. Losing the phone does not remove server records, but a new phone must sign in again.

## Security and dependency maintenance

Configuration rejects missing/placeholder JWT secrets, mismatched public/origin URLs, administrator/schema-owner runtime usernames and invalid ports. Development defaults to loopback; trusted-Wi-Fi binding needs explicit opt-in and a private address. Production requires HTTPS and secure cookies. `local-status.cjs` checks the actual runtime database role has no superuser/create-role/create-database permissions, database connectivity/migration count, Wi-Fi API reachability when configured, and response security headers. Authenticated clinic writes require current membership and CSRF validation; patient writes derive ownership from the signed-in user. Password changes have a separate rate limit. Existing-account invitation acceptance rechecks password state under the user lock so a reset cannot race acceptance.

Authentication limits apply to the relevant POST endpoints, not the entire `/auth` path. Login counts failed attempts only (40 per 15 minutes per source IP, shared between web/mobile login); routine identity checks and logout stay available. Registration and invitation acceptance have independent 40-request windows; failed refresh attempts have an independent 120-request window. On this local setup, traffic shares the loopback source IP. A restart clears in-memory rate counters while preserving database sessions and records.

Use the preserved lockfile:

```powershell
npm.cmd ci
npm.cmd run check:runtime
npm.cmd audit --omit=dev
```

The runtime patch uses express-rate-limit 8.7.1, ip-address 10.7.5 and a root override for Multer 2.5.0, without downgrading NestJS. [Multer's advisory](https://github.com/advisories/GHSA-q7qp-rjg7-q26m) and the [rate-limit advisory](https://github.com/advisories/GHSA-46wh-pxpv-q5gq) explain the patched issues. Patient documents use authenticated JSON/base64 uploads with per-file/owner quotas and type/signature checks. That route has a 7 MB JSON limit; ordinary routes retain a 100 KB limit. PDFs use locally bundled fonts and server-side PDFKit/QR generation.

The installed npm 11 workspace resolver can misreport an applied override as invalid and can revert it during updates; see the [upstream npm issue](https://github.com/npm/cli/issues/9514). The reviewed lockfile resolves the patched package, and the post-install/startup dependency guard verifies the versions actually loaded by Nest. Avoid an unreviewed `npm update`/forced audit fix; any dependency change needs the guard, audit, builds and relevant regressions again. A clean audit is a point-in-time package check, not a claim that the application has no security flaws.

## Remaining human acceptance

Automated checks and the primary agent's device checks are recorded under `qa/shared/local-readiness/`. Human usability observations and a complete TalkBack pass are still pending. Try patient registration/login, booking/rescheduling/cancellation, viewing care/refills and reconnecting after an outage; then try the assigned-doctor queue, prescribing/refill review and administrator access controls. Use fictional records and report confusing labels or unnecessary steps. Real model validation, live overbooking, multi-clinic onboarding and public deployment remain outside this local release.

Before moving the project folder, stop its API/dashboard. Move the source/config together, then rebuild/start at the new location. The global PostgreSQL database does not move with the folder and must be backed up separately.
