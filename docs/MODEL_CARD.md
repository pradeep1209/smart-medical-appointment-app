# Attendance model: authoritative server inference

## Purpose and provenance

The logistic regression estimates appointment no-show probability for a college prototype. Training is an original NumPy implementation; the connected version performs authoritative inference in the NestJS API. The retained Kotlin adapter/asset are reference material and are not called by the connected patient app. No pretrained clinic model or real patient dataset has been copied. Training uses 6,000 synthetic records with seed 42; 4,800 fit the model and 1,200 form a synthetic holdout. Original independent evaluation uses seed 20261015 and 4,000 generated records. Server-policy evaluation uses another 4,000 generated records with seed 20261025 and the reminder feature fixed to false.

## Features and class meaning

The positive class is **no-show**. Attendance probability is `1 - no_show_probability`. Feature order is booking lead days, smoothed prior no-show rate, prior completed appointments, and reminder planned. History smoothing is `(prior_missed + 1) / (prior_appointments + 4)`.

Training bounds are 0–60 lead days and 0–20 previous appointments. The server selects the latest 20 attended/missed outcomes from this patient in this clinic, ordered by visit end and UUID. The visit must have ended and its attendance event must be recorded by prediction time. Future visits, cancellations, missing/late events, other patients and other clinics are excluded. Lead days use clinic calendar dates and are capped at 60 while the booking window stays 90 days; snapshots retain raw lead and the clamping flag. New patients have rate 1/4. Reminder planned is always **false** because the server cannot verify phone opt-in/eligibility. Client-submitted features/probabilities are rejected.

## Inference and failure behavior

The API validates `apps/api/models/attendance_model.json` at startup: schema/order, positive class, finite parameters, positive scales, smoothing and bounds. It normalizes features and applies a sigmoid to a weighted sum clipped to logits [-30,30]. Training runs on the development computer; neither server requests nor phone retrain the model. `tools/train_model.py` exports identical parameter files to the server and retained Android reference locations, archiving previous/current server bytes under `apps/api/models/archive/<sha256>.json`. Restart the API when deploying a model change.

Booking/rescheduling save an `AttendanceSnapshot` in the same transaction, with prediction time, appointment version/time, model version/SHA-256, inputs, selected history IDs and probability. Rescheduling adds a snapshot; replay/cancellation retain existing snapshots. Older visits receive no retrospective prediction. Patient responses omit history IDs/counts; clinic queue details show counts/provenance but omit historical appointment IDs. Android renders server snapshots and can read their dated encrypted cache offline; it performs no local inference.

Standard booking remains available when model loading is disabled, missing or invalid. An unavailable snapshot records this state, and prediction-assisted simulation is disabled. `ATTENDANCE_MODEL_ENABLED=false` provides a controlled server failure configuration. Recovery does not silently rewrite historical unavailable snapshots. Every live appointment retains standard one-booking capacity.

## Evaluation limits

The synthetic generator explicitly assumes a relationship between lead time, attendance history, reminders, and no-shows. Reported AUC, Brier score, log loss, and calibration therefore measure recovery of those artificial relationships. They establish no accuracy, fairness, or clinical suitability for a real clinic.

Scheduling comparisons use paired generated attendance draws and service durations. Increased attendance can increase waiting and overtime. The server's greedy overbooking heuristic is not integer programming and is disabled by default. It is available only in a separate simulation to web clinic administrators/doctors. It allows at most two bookings per slot and combined expected attendance at most 1.2, and never writes appointments. The server scenario uses 18 candidates, 12 slots and paired attendance/service draws; every third candidate uses a high-missed-history stress generator (0.8 vs 0.24 for others), so its results are distinct from the original NumPy comparison and are not estimates of clinic demand.

Original evaluation/reference cases are reproduced by `tools/evaluate_model.py`. Deployed reminder=false evaluation/calibration are reproduced by `tools/evaluate_server_model.py` into `evaluation/server-results.json`. Server scheduling output is reproduced from the clinic tool using its seed/session count; phase QA saves a copy under `qa/shared/prediction/simulation.json`. No claims from the research paper are treated as measurements of this app. Real validation, subgroup/fairness analysis, live overbooking and trusted reminder-delivery telemetry remain future work.
