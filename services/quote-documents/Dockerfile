FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-writer fonts-liberation fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --create-home renderer
COPY app.py renderer.py ./
USER renderer
ENV SOFFICE_PATH=/usr/bin/soffice
EXPOSE 8080
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "2", "--timeout", "50", "--limit-request-line", "2048", "app:application"]
