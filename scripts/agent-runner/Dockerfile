FROM python:3.12-slim

WORKDIR /app
COPY scripts/agent-runner/runner.py /app/runner.py

EXPOSE 4850
CMD ["python", "/app/runner.py"]
