FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt requirements-cv.txt ./
# INSTALL_CV=true (default) adds YOLO/OpenCV so phone and extra-person detection works.
# CPU-only torch keeps the image far smaller than the default CUDA wheels. Use INSTALL_CV=false for an API-only image.
ARG INSTALL_CV=true
RUN if [ "$INSTALL_CV" = "true" ]; then \
      pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu && \
      pip install --no-cache-dir -r requirements-cv.txt; \
    else \
      pip install --no-cache-dir -r requirements.txt; \
    fi
# Fetch the weights now instead of on the first candidate frame, which would otherwise wait for a download from GitHub
# (and be dropped as "detector busy"). It lands in /app/yolo11n.pt, where YOLO_MODEL_PATH's default finds it.
RUN if [ "$INSTALL_CV" = "true" ]; then python -c "from ultralytics import YOLO; YOLO('yolo11n.pt')"; fi
COPY . .
RUN useradd --system --create-home --uid 10001 app && chown -R app /app
USER app
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)"
# Exactly one worker: WebSocket rooms and rate-limit counters live in process memory (see docs/deployment.md).
CMD ["sh", "-c", "alembic upgrade head && python -m app.seed && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1"]
