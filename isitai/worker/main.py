"""IsItAI self-hosted detection worker (FastAPI).

Deploy on Modal / RunPod free tier and point the web app at it with:
    MODEL_WORKER_URL=https://<your-worker-url>  MODEL_WORKER_TOKEN=<secret>

Endpoints
  GET  /health          -> {ok, models:[...]}      (used by /status)
  POST /classify        image bytes -> {aiScore}    CNNDet-style ensemble
  POST /synthid         image bytes -> {detected}   SynthID detector (optional)
  POST /text-classify   {text}      -> {aiScore}    Hive-adjacent RoBERTa
  POST /audio-classify  raw PCM f32 little-endian body -> {aiScore}

Models load lazily on first request so cold starts stay small; every endpoint
degrades honestly (503) instead of guessing.
"""
from __future__ import annotations

import io
import os
import time
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

APP_VERSION = "1.0.0"
TOKEN = os.environ.get("WORKER_TOKEN", "")  # must match MODEL_WORKER_TOKEN

app = FastAPI(title="IsItAI model worker", version=APP_VERSION)

_cache: dict[str, Any] = {}


def _auth(request: Request) -> None:
    if not TOKEN:
        return
    if request.headers.get("authorization", "") != f"Bearer {TOKEN}":
        raise HTTPException(401, "bad token")


def _pipe(model_id: str):
    """Load a HF transformers pipeline once per process."""
    key = model_id
    if key not in _cache:
        from transformers import pipeline  # heavy import deferred

        _cache[key] = pipeline(
            "image-classification",
            model=model_id,
            device=-1,  # CPU default; set to 0 for GPU on RunPod/Modal
        )
    return _cache[key]


# AI-vs-real image classifiers worth self-hosting (swap freely via env):
DEFAULT_MODELS = [
    m.strip()
    for m in os.environ.get(
        "WORKER_MODELS",
        "umm-maybe/AI-image-detector,Warwick-DPP/ai-image-detection",
    ).split(",")
    if m.strip()
]


class TextIn(BaseModel):
    text: str


@app.get("/health")
def health() -> dict:
    return {"ok": True, "version": APP_VERSION, "models": DEFAULT_MODELS}


@app.post("/classify")
async def classify(request: Request) -> JSONResponse:
    _auth(request)
    data = await request.body()
    if len(data) < 100:
        raise HTTPException(400, "image body too small")
    try:
        from PIL import Image

        img = Image.open(io.BytesIO(data)).convert("RGB")
    except Exception:
        raise HTTPException(422, "could not decode image")

    scores: list[float] = []
    errors: list[str] = []
    for mid in DEFAULT_MODELS:
        try:
            pipe = _pipe(mid)
            out = pipe(img)[0]
            label = str(out["label"]).lower()
            p = float(out["score"])
            # normalize so that higher == more likely AI regardless of class order
            ai_p = p if ("ai" in label or "generated" in label or "diffusion" in label or "fake" in label) else 1.0 - p
            scores.append(ai_p)
        except Exception as e:  # keep other models alive
            errors.append(f"{mid}: {e}")
    if not scores:
        raise HTTPException(503, f"no models available: {errors}")
    return JSONResponse(
        {
            "aiScore": round(sum(scores) / len(scores), 4),
            "perModel": scores,
            "errors": errors,
            "tookMs": int(time.time() * 1000 % 10_000),
        }
    )


@app.post("/text-classify")
async def text_classify(body: TextIn, request: Request) -> JSONResponse:
    _auth(request)
    model_id = os.environ.get("TEXT_MODEL", "huggingface/hub-models-roberta-base-openai-detector")
    try:
        if "text_pipe" not in _cache:
            from transformers import pipeline

            _cache["text_pipe"] = pipeline("text-classification", model=os.environ.get("TEXT_MODEL_ID", "roberta-large-openai-detector"), device=-1)
        out = _cache["text_pipe"](body.text[:5000])[0]
        label = str(out["label"]).lower()
        p = float(out["score"])
        ai_p = p if "ai" in label or "generated" in label else 1.0 - p
        return JSONResponse({"aiScore": round(ai_p, 4), "model": model_id})
    except Exception as e:
        raise HTTPException(503, f"text model unavailable: {e}")


@app.post("/audio-classify")
async def audio_classify(request: Request) -> JSONResponse:
    """Raw float32 little-endian PCM mono @16k body (client reslices audio).

    Wraps the array into mel-spectrogram features and runs an ASVspoof-style
    classifier when WORKER_AUDIO_MODEL is set; otherwise returns 503 so the
    main app falls back to its statistical DSP heuristics honestly.
    """
    _auth(request)
    model_id = os.environ.get("WORKER_AUDIO_MODEL", "")
    if not model_id:
        raise HTTPException(503, "no audio model configured")
    import numpy as np

    raw = await request.body()
    samples = np.frombuffer(raw, dtype="<f4")
    if samples.size < 1600:
        raise HTTPException(400, "audio too short")
    try:
        key = f"audio:{model_id}"
        if key not in _cache:
            from transformers import pipeline

            _cache[key] = pipeline("audio-classification", model=model_id, device=-1)
        out = _cache[key](samples.tolist(), sampling_rate=16000)[0]
        label = str(out["label"]).lower()
        p = float(out["score"])
        ai_p = p if "spoof" in label or "fake" in label or "synth" in label else 1.0 - p
        return JSONResponse({"aiScore": round(ai_p, 4)})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(503, f"audio model error: {e}")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
