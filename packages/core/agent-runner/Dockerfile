FROM python:3.12-slim

WORKDIR /app
COPY packages/core/agent-runner/runner.py /app/runner.py

EXPOSE 4850
CMD ["python", "/app/runner.py"]
