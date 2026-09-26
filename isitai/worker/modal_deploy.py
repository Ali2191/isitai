"""Deploy the IsItAI worker on Modal's free tier:

    pip install modal && modal setup
    modal deploy worker/modal_deploy.py

Then set on the web app:
    MODEL_WORKER_URL=https://<user>--isitai-worker.modal.run
    MODEL_WORKER_TOKEN=<same secret as WORKER_TOKEN below>
"""
import modal

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install_from_requirements("requirements.txt")
)

app = modal.App("isitai-worker", image=image)

with image.imports():
    from main import app as fastapi_app  # noqa: F401


@app.function(
    cpu=2,
    memory=8192,
    timeout=120,
    scaledown_window=300,     # scale to zero between requests — free-tier friendly
    secrets=[modal.Secret.from_name("isitai-worker-secret")],
)
@modal.fastapi_endpoint(method="POST")
def worker():
    pass  # placeholder; real serving uses the decorator below


# Serve the whole FastAPI app as one web endpoint:
@app.function(cpu=2, memory=8192, timeout=120, scaledown_window=300)
@modal.asgi_app()
def web():
    from main import app as fa

    return fa
