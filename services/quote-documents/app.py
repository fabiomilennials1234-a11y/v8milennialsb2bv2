"""Internal WSGI document service. Deploy behind authenticated TLS ingress."""
import base64
import hmac
import json
import os
from pathlib import Path
from renderer import inspect, fill, convert_pdf

MAX_BODY = 8 * 1024 * 1024


def application(environ, start_response):
    def reply(status, payload):
        data = json.dumps(payload).encode()
        start_response(status, [("Content-Type", "application/json"), ("Cache-Control", "no-store"),
                                ("Content-Length", str(len(data)))])
        return [data]
    token = os.environ.get("QUOTE_DOCUMENT_TOKEN", "")
    if len(token) < 32 or not hmac.compare_digest(environ.get("HTTP_AUTHORIZATION", ""), "Bearer " + token):
        return reply("401 Unauthorized", {"error": "unauthorized"})
    path = environ.get("PATH_INFO")
    if path == "/health" and environ.get("REQUEST_METHOD") == "GET":
        return reply("200 OK", {"ready": True, "pdf": Path(os.environ.get("SOFFICE_PATH", "/usr/bin/soffice")).is_file()})
    if path not in ("/inspect", "/render") or environ.get("REQUEST_METHOD") != "POST":
        return reply("404 Not Found", {"error": "not_found"})
    try:
        size = int(environ.get("CONTENT_LENGTH", "0"))
        if not 0 < size <= MAX_BODY:
            return reply("413 Payload Too Large", {"error": "body_size"})
        data = json.loads(environ["wsgi.input"].read(size))
        template = base64.b64decode(data["template"], validate=True)
        manifest = inspect(template)
        if path == "/inspect":
            return reply("200 OK", manifest)
        if not isinstance(data.get("convert_to_pdf"), bool):
            raise ValueError("format_required")
        output = fill(template, data["values"], data["items"])
        if data["convert_to_pdf"]:
            output = convert_pdf(output, os.environ.get("SOFFICE_PATH", "/usr/bin/soffice"))
        return reply("200 OK", {"file": base64.b64encode(output).decode(), "format": "pdf" if data["convert_to_pdf"] else "docx"})
    except (ValueError, KeyError):
        return reply("422 Unprocessable Entity", {"error": "invalid_template_or_data"})
    except Exception:
        # Never expose customer data, paths or converter stderr.
        return reply("503 Service Unavailable", {"error": "document_processing_failed"})
