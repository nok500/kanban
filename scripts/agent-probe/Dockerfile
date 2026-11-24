FROM python:3.12-alpine

WORKDIR /app
COPY scripts/agent-probe/probe.py /app/probe.py

EXPOSE 4747
CMD ["python", "/app/probe.py"]
