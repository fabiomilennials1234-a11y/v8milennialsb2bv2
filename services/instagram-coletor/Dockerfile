# Coletor de Instagram com login real. Contexto de build: esta pasta.
#   docker build -t instagram-coletor services/instagram-coletor
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
# Versão FIXADA: a API da biblioteca foi conferida nesta versão (ver coletor/ig.py).
RUN pip install --no-cache-dir -r requirements.txt
COPY coletor ./coletor
RUN useradd --create-home --uid 10001 coletor && mkdir -p /data && chown coletor /data
USER coletor
ENV IG_DADOS=/data PYTHONUNBUFFERED=1
VOLUME ["/data"]
# Sem EXPOSE/publicação: só o worker, pela rede interna do compose.
CMD ["python", "-m", "coletor"]
