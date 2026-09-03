FROM python:3.11-slim

# Pre-install standard popular libraries for zero cold-start delay
RUN pip install --no-cache-dir \
    requests==2.31.0 \
    httpx==0.27.0 \
    pydantic==2.8.2 \
    urllib3==2.2.2 \
    boto3==1.34.140 \
    PyYAML==6.0.1

# Copy the runtime engine into the container
WORKDIR /opt/runtime
COPY watchdog.py /opt/runtime/watchdog.py

# Mount directory for user code
RUN mkdir -p /var/task

# Runtime environment configurations
ENV PORT=8080
ENV PYTHONUNBUFFERED=1
EXPOSE 8080

CMD ["python", "/opt/runtime/watchdog.py"]
