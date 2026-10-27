"""Independent synthetic evaluation for deployed server reminder=false inputs."""
import hashlib
import json
from pathlib import Path
import numpy as np

root = Path(__file__).resolve().parents[1]
raw = (root / "apps/api/models/attendance_model.json").read_bytes()
model = json.loads(raw)
rng = np.random.default_rng(20261025)
n = 4000
lead, visits = rng.integers(0, 61, n), rng.integers(0, 21, n)
missed = rng.binomial(visits, .24)
history = (missed + 1) / (visits + 4)
x = np.column_stack([lead, history, visits, np.zeros(n)])
truth = 1 / (1 + np.exp(-(-2 + .025 * lead + 2 * history - .025 * visits)))
y = rng.binomial(1, truth)
p = 1 / (1 + np.exp(-np.clip(((x - np.array(model["mean"])) / np.array(model["scale"])) @ np.array(model["weights"]) + model["intercept"], -30, 30)))
def metrics(pred):
    pos, neg = pred[y == 1], pred[y == 0]
    safe = np.clip(pred, 1e-10, 1 - 1e-10)
    return {"auc": float(np.mean(pos[:, None] > neg) + .5 * np.mean(pos[:, None] == neg)), "brier": float(np.mean((pred-y)**2)), "log_loss": float(-np.mean(y*np.log(safe)+(1-y)*np.log(1-safe)))}
calibration = []
for lower in np.arange(0, 1, .1):
    mask = (p >= lower) & (p < lower + .1)
    calibration.append({"lower": float(lower), "upper": float(lower+.1), "count": int(mask.sum()), "predicted_no_show": float(p[mask].mean()) if mask.any() else None, "observed_no_show": float(y[mask].mean()) if mask.any() else None})
result = {"source": "Independent synthetic generator only; not real-patient validation.", "seed": 20261025, "rows": n, "reminder_feature": False, "model": model["version"], "model_sha256": hashlib.sha256(raw).hexdigest(), "logistic": metrics(p), "constant_baseline": metrics(np.full(n, model["training_no_show_rate"])), "baseline_basis": "Constant overall synthetic training no-show rate, including both original reminder states.", "calibration": calibration}
(root / "evaluation/server-results.json").write_text(json.dumps(result, indent=2)+"\n", encoding="utf-8")
print(json.dumps({"rows": n, "logistic": result["logistic"], "baseline": result["constant_baseline"]}))
