FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt requirements-cv.txt ./
ARG INSTALL_CV=false
RUN if [ "$INSTALL_CV" = "true" ]; then pip install --no-cache-dir -r requirements-cv.txt; else pip install --no-cache-dir -r requirements.txt; fi
COPY . .
CMD ["sh", "-c", "python -m app.seed && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
