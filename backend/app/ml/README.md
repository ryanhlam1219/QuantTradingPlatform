# app/ml/ — Machine Learning Layer
**Roadmap Phase: p3 (ML Models)**

Planned files:
- `features.py`     — centralised feature engineering pipeline (RSI, vol percentile, momentum rank, etc.) — **p1t3**
- `signal_classifier.py` — XGBoost/LightGBM signal quality classifier (prob of profitable signal) — **p3t1**
- `regime.py`       — Hidden Markov Model market regime detector (4 states) — **p3t2**
- `return_forecast.py` — LightGBM return forecaster (5/10-day forward returns) — **p3t3**
- `anomaly.py`      — Isolation Forest portfolio anomaly circuit breaker — **p3t4**
- `slippage.py`     — Ridge regression slippage predictor — **p3t5**
- `retrain.py`      — Walk-forward online retraining scheduler — **p5t1**

All inference modules load models from `backend/models/<name>_<date>.pkl` (joblib).
All training scripts live in `backend/scripts/train_*.py`.
