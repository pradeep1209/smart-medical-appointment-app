"""Independent synthetic evaluation and paired scheduling simulation, not clinical evidence."""
import json
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
model = json.loads((ROOT / "apps/api/models/attendance_model.json").read_text())
mean, scale, weights = (np.array(model[k]) for k in ("mean", "scale", "weights"))

def predict(x):
    return 1 / (1 + np.exp(-np.clip(((x - mean) / scale) @ weights + model["intercept"], -30, 30)))

def auc(y, p):
    pos, neg = p[y == 1], p[y == 0]
    return float(np.mean(pos[:, None] > neg) + 0.5 * np.mean(pos[:, None] == neg))

def metrics(y, p):
    safe = np.clip(p, 1e-10, 1 - 1e-10)
    return {"auc": auc(y, p), "brier": float(np.mean((p - y)**2)), "log_loss": float(-np.mean(y * np.log(safe) + (1-y) * np.log(1-safe)))}

rng = np.random.default_rng(20261015)
n = 4000
lead = rng.integers(0, 61, n)
visits = rng.integers(0, 21, n)
missed = rng.binomial(visits, .24)
history = (missed + 1) / (visits + 4)
reminder = rng.integers(0, 2, n)
x = np.column_stack([lead, history, visits, reminder])
truth = 1 / (1 + np.exp(-(-2 + .025 * lead + 2 * history - .025 * visits - .5 * reminder)))
y = rng.binomial(1, truth)
p = predict(x)
baseline = np.full(n, model["training_no_show_rate"])
calibration = []
for lower in np.arange(0, 1, .1):
    mask = (p >= lower) & (p < lower + .1)
    if mask.any():
        calibration.append({"bin": f"{lower:.1f}-{lower+.1:.1f}", "count": int(mask.sum()), "predicted": float(p[mask].mean()), "observed": float(y[mask].mean())})

results = {"source": "Independent fictional records drawn from the documented synthetic generator; no real-patient validation.", "seed": 20261015, "rows": n, "model": model["version"], "logistic": metrics(y, p), "constant_baseline": metrics(y, baseline), "calibration": calibration}
simulation = {"standard": [], "prediction_assisted": []}
for _ in range(500):
    # Same candidate demand, arrival draws and service durations for both policies.
    candidate = x[rng.integers(0, n, 18)]
    probs = predict(candidate)
    true_p = 1 / (1 + np.exp(-(-2 + .025*candidate[:,0] + 2*candidate[:,1] - .025*candidate[:,2] - .5*candidate[:,3])))
    arrived = rng.random(18) >= true_p
    service = rng.uniform(20, 40, 18)
    for policy in simulation:
        slots = [[] for _ in range(12)]
        for i in range(18):
            empty = next((s for s in slots if not s), None)
            if empty is not None:
                empty.append(i)
            elif policy == "prediction_assisted":
                extra = next((s for s in slots if len(s) < 2 and sum(1-probs[j] for j in s)+(1-probs[i]) <= 1.2), None)
                if extra is not None:
                    extra.append(i)
        end = 0.; waits = []; busy = 0.; unused = 0; collisions = 0
        for slot, ids in enumerate(slots):
            present = [i for i in ids if arrived[i]]
            unused += not present
            collisions += len(present) > 1
            for i in present:
                start = max(end, slot * 30)
                waits.append(start - slot * 30)
                busy += max(0., min(start + service[i], 360) - min(start, 360))
                end = start + service[i]
        simulation[policy].append({"booked": sum(map(len, slots)), "attended": len(waits), "unused_slots": unused, "collision_slots": collisions, "mean_wait_minutes": float(np.mean(waits)) if waits else 0., "overtime_minutes": max(0., end-360), "busy_capacity_fraction": busy/360})
results["simulation"] = {"sessions": 500, "assumptions": "18 candidates, 12 thirty-minute slots, independent attendance from synthetic generator, shared U(20,40) minute service durations; arrivals at booked slot start. Order-preserving greedy heuristic, not ILP.", "policies": {name: {key: float(np.mean([r[key] for r in rows])) for key in rows[0]} for name, rows in simulation.items()}}
out = ROOT / "evaluation"
out.mkdir(exist_ok=True)
(out / "results.json").write_text(json.dumps(results, indent=2)+"\n")
cases = []
for lead_days, count, absent, reminders in [(0,0,0,False), (30,10,5,False), (60,20,20,True), (1,20,0,False)]:
    values = np.array([lead_days, (absent+1)/(count+4), count, int(reminders)])
    cases.append({"leadDays": lead_days, "priorAppointments": count, "priorMissed": absent, "reminderPlanned": reminders, "expectedNoShow": float(predict(values))})
(out / "reference_predictions.json").write_text(json.dumps(cases, indent=2)+"\n")
print(json.dumps({"logistic": results["logistic"], "baseline": results["constant_baseline"], "simulation": results["simulation"]["policies"]}, indent=2))
