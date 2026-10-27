# Archived Android demonstration

Reference source only. These Kotlin files, manifests and QA helpers are outside the Android app source sets and are not included in the delivered APK. The connected patient app is the sole application experience. Existing on-device prototype records are retained without being opened or uploaded. The embedded attendance model interface and asset remain in the active app for later integration.

The notes below describe the retired prototype, not the current app. Historical paths are relative to the original project root.

## Earlier offline Android prototype

The retained native Kotlin demonstration provides appointment and prescription workflows inspired by the supplied paper. Those demonstration workflows work locally without a server or account. Open **Open offline demo** in the debug app to reach them. Android 8.0 or later is required.

The interface uses a forest green and teal palette, outlined cards, icon navigation, Upcoming/Past visit filters, and a selectable booking time grid. See [DESIGN.md](DESIGN.md) for reusable colors, spacing, typography, and screen patterns.

## Run

Install Android SDK Platform 35 and Build Tools 35 through Android Studio. Use JDK 17 or newer and set your SDK location in Android Studio or `local.properties`. On Windows, build with `gradlew.bat assembleDebug`. The debug APK is written to `app/build/outputs/apk/debug/app-debug.apk`.

### Install on your phone

Transfer the debug APK to your Android phone and open it there. If prompted, permit installation from the app used to open the APK, then install CareSlot. Alternatively, connect your phone to Android Studio with USB debugging enabled, select the phone as the deployment target, and run `app`. A device running Android 8.0 or later is required. The rebuilt APK uses the same application ID and debug signing key, so it can normally update the earlier prototype and keep its local records.

## Included workflows

- Profiles: explicitly switch between fictional patient profiles and the clinic demonstration workspace. Stable patient IDs determine record ownership.
- Home: choose among three demonstration doctors and book a visit in the next 60 days. Past appointment times, blocked periods, occupied slots, and simultaneous patient bookings are rejected.
- Visits: inspect appointments, reschedule while retaining appointment identity and history, or cancel a booking. Failed changes preserve the original appointment.
- Clinic: edit doctor working days, hours, consultation length, and blocked periods; inspect conflicts and the queue; record attendance once the appointment starts.
- Clinic offers an explicit sample attended visit when no attended history exists, so care plans and refill requests can be demonstrated immediately.
- Plans: view clinician-entered medication, dose, frequency, duration, and instructions, alongside retained legacy care plans. Request and review refills with status and review history.
- Reminders: approximate local notifications about 24 hours before eligible visits. Denying notification permission keeps booking available. A labelled debug action provides a short-delay device check.
- Records persist in app-private Room storage. Old SharedPreferences appointment and care-plan records are imported once. Lightweight preferences hold profile selection and settings.

Features are exposed progressively using `-ProadmapPhase=N` (1–14). The default build exposes the final feature set. A feature's presence in source does not mean its device acceptance gate has passed: see [qa/README.md](qa/README.md) and each phase report for verified delivery status. Development helpers target the authorized project phone; generic installation uses `adb -s YOUR_SERIAL install -r app/build/outputs/apk/debug/app-debug.apk`.

## Model inside the app

`app/src/main/assets/attendance_model.json` contains a trained binary logistic regression: coefficients, intercept, feature order, normalization, provenance, and synthetic holdout metrics. `LocalLogisticPredictor` performs normalization and sigmoid inference in Kotlin. There is no Python interpreter or ML runtime bundled with the app.

Training runs separately on a development machine using `python tools/train_model.py` with NumPy installed. It generates 6,000 independent synthetic appointment records, fits regularized logistic regression with gradient descent on 80%, and exports the model. The remaining 20% supplies synthetic holdout AUC and Brier score. The generating process explicitly assumes relationships between the input features and no-shows; these metrics measure a synthetic demonstration only and establish no performance on real patients. This implementation is original; no third-party no-show repository or pretrained patient model has been copied.

Inputs are booking lead days, smoothed historical no-show rate, previous appointment count, and whether a reminder is eligible and planned. Smoothing is `(prior_missed + 1) / (prior_appointments + 4)`. Up to the latest 20 completed outcomes known at booking supply history for the selected patient ID. Future visits and cancellations are excluded. Training and Kotlin feature definitions must change together. The model does not retrain itself from attendance outcomes.

Run `python tools/evaluate_model.py` with NumPy to reproduce independent synthetic AUC, Brier score, calibration bins, reference probabilities, and paired scheduling comparisons under `evaluation/`. See [docs/MODEL_CARD.md](docs/MODEL_CARD.md) for the assumptions and class meaning. Normal booking remains available if model loading fails; prediction-dependent simulation is unavailable.

To replace this demo model, train using representative, authorized appointment records and export the same JSON schema with identical feature definitions, bounds, class meaning, and scaling. Evaluate probability calibration and scheduling outcomes before enabling operational overbooking. `AttendancePredictor` is the replacement boundary for a future SVM or ONNX model.

## Scheduling

Normal booking accepts one patient per doctor/date/time. Demo overbooking is off by default. When enabled in Clinic, it permits up to two booked patients only when their combined predicted attendance is at most 1.2. This is a simple heuristic inspired by the paper, not an integer programming optimizer and not a capacity safety guarantee. Completed and missed bookings remain historical occupants. Cancelling releases capacity.

## Offline demonstration limits

The offline Clinic screen is a local demonstration workspace available through profile switching. Use fictional data. Medication fields and refill decisions are entered manually. Notification timing depends on Android permissions and scheduling restrictions. Synthetic model and simulation results establish no performance on real patients. Shared authentication is implemented separately as described above; the demo's clinical records are not yet connected to that service. SMS, video calls, blockchain, drug interaction checks, and automated prescribing remain future extensions.

## Project documentation

- [Architecture and database](docs/ARCHITECTURE.md)
- [User journeys and acceptance criteria](docs/USER_JOURNEYS.md)
- [UI system](DESIGN.md)
- [Model card](docs/MODEL_CARD.md)
- [Human usability protocol](docs/USABILITY_PROTOCOL.md)
- [Physical phone test ledger](qa/README.md)
