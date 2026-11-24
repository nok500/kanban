FROM python:3.12-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/* \
  && pip install --no-cache-dir fpdf2

WORKDIR /app
COPY packages/core/agent-runner/runner.py /app/runner.py

EXPOSE 4850
CMD ["python", "/app/runner.py"]
