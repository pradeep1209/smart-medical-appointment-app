"""Train a small logistic regression and export all inference parameters.

Requires NumPy only. Data and metrics are synthetic demonstration data.
Run from any directory: python tools/train_model.py
"""
import json
import hashlib
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
rng = np.random.default_rng(42)
n = 6000
# Features available at booking time, never future attendance outcomes.
lead = rng.integers(0, 61, n)
prior_visits = rng.integers(0, 21, n)
prior_missed = rng.binomial(prior_visits, 0.24)
history = (prior_missed + 1) / (prior_visits + 4)
reminder = rng.integers(0, 2, n)
x = np.column_stack([lead, history, prior_visits, reminder]).astype(float)
prob = 1 / (1 + np.exp(-(-2.0 + 0.025 * lead + 2.0 * history - 0.025 * prior_visits - 0.5 * reminder)))
y = rng.binomial(1, prob)
# Hold out the last 20% of independent generated records.
cut = int(n * 0.8)
mean = x[:cut].mean(axis=0)
scale = x[:cut].std(axis=0)
z = (x[:cut] - mean) / scale
w = np.zeros(x.shape[1])
b = 0.0
for _ in range(2500):
    p = 1 / (1 + np.exp(-np.clip(z @ w + b, -30, 30)))
    error = p - y[:cut]
    w -= 0.1 * (z.T @ error / cut + 0.001 * w)
    b -= 0.1 * error.mean()
pred = 1 / (1 + np.exp(-((x[cut:] - mean) / scale @ w + b)))
positive = pred[y[cut:] == 1]
negative = pred[y[cut:] == 0]
auc = float(((positive[:, None] > negative).sum() + 0.5 * (positive[:, None] == negative).sum()) / (len(positive) * len(negative)))
model = {
    "version": "synthetic-logistic-v1", "training_data": "synthetic",
    "positive_class": "no_show", "features": ["lead_days", "smoothed_prior_noshow_rate", "prior_appointments", "reminder_planned"],
    "mean": mean.tolist(), "scale": scale.tolist(), "weights": w.tolist(), "intercept": float(b),
    "training_rows": cut, "holdout_rows": n - cut,
    "training_no_show_rate": float(y[:cut].mean()),
    "synthetic_holdout_auc": auc, "synthetic_holdout_brier": float(np.mean((pred - y[cut:]) ** 2)),
    "history_smoothing": "(prior_missed + 1) / (prior_appointments + 4)",
    "feature_bounds": {"lead_days": [0, 60], "prior_appointments": [0, 20]},
}
out = ROOT / "app/src/main/assets/attendance_model.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(model, indent=2) + "\n", encoding="utf-8")
server_out = ROOT / "apps/api/models/attendance_model.json"
server_out.parent.mkdir(parents=True, exist_ok=True)
archive = server_out.parent / "archive"
archive.mkdir(exist_ok=True)
if server_out.exists():
    previous = server_out.read_bytes()
    (archive / (hashlib.sha256(previous).hexdigest() + ".json")).write_bytes(previous)
server_out.write_text(json.dumps(model, indent=2) + "\n", encoding="utf-8")
current = server_out.read_bytes()
(archive / (hashlib.sha256(current).hexdigest() + ".json")).write_bytes(current)
print(json.dumps({"output": str(server_out), "android_reference_output": str(out), "model_sha256": hashlib.sha256(current).hexdigest(), "synthetic_auc": auc, "synthetic_brier": model["synthetic_holdout_brier"]}))
