# IsItAI model worker (self-hosted ensemble)

Avoids Hugging Face Inference API rate limits. Runs TruFor/AIDE-style CNN
detectors + openai-detector text model + optional ASVspoof audio model behind
one small FastAPI app.

## Run locally
```bash
cd worker
python -m venv .venv && .venv/bin/pip install -r requirements.txt
WORKER_TOKEN=secret123 .venv/bin/python main.py
```

## Connect the web app
```
MODEL_WORKER_URL=http://localhost:8000
MODEL_WORKER_TOKEN=secret123
```

## Deploy free tier
- **Modal**: `modal deploy modal_deploy.py` (see file header).
- **RunPod**: serverless container with `CMD uvicorn main:app --host 0.0.0.0 --port 8000`,
  env `WORKER_TOKEN`, min-replicas 0.

Endpoints: `/health`, `/classify` (image bytes → aiScore), `/text-classify`,
`/audio-classify` (raw f32 PCM). All degrade with 503 rather than guess.
