import base64
import io
import json
import os
import unittest
from unittest.mock import patch
from app import application
from test_renderer import fixture


class ApplicationTests(unittest.TestCase):
    def request(self, payload=None, token=None, path="/render", method="POST"):
        body = json.dumps(payload or {}).encode()
        env = {"REQUEST_METHOD": method, "PATH_INFO": path, "CONTENT_LENGTH": str(len(body)),
               "wsgi.input": io.BytesIO(body), "HTTP_AUTHORIZATION": "Bearer " + (token or "")}
        response = []
        with patch.dict(os.environ, {"QUOTE_DOCUMENT_TOKEN": "x" * 32}):
            result = application(env, lambda status, headers: response.append(status))
        return response[0], json.loads(b"".join(result))

    def payload(self, pdf=False):
        return {"template": base64.b64encode(fixture()).decode(), "values": {"customer": "Teste", "total": "20,00"},
                "items": [{"description": "Motor", "quantity": "2", "unit_price": "10,00", "total": "20,00"}], "convert_to_pdf": pdf}

    def test_requires_service_auth(self):
        status, _ = self.request(self.payload())
        self.assertTrue(status.startswith("401"))

    def test_false_returns_docx_without_calling_converter(self):
        with patch("app.convert_pdf") as convert:
            status, result = self.request(self.payload(), token="x" * 32)
        self.assertTrue(status.startswith("200"))
        self.assertEqual(result["format"], "docx")
        self.assertTrue(base64.b64decode(result["file"]).startswith(b"PK"))
        convert.assert_not_called()

    def test_pdf_failure_does_not_return_word(self):
        with patch("app.convert_pdf", side_effect=TimeoutError("sensitive details")):
            status, result = self.request(self.payload(True), token="x" * 32)
        self.assertTrue(status.startswith("503"))
        self.assertNotIn("file", result)
        self.assertNotIn("sensitive", json.dumps(result))

    def test_requires_boolean_format(self):
        payload = self.payload(); payload["convert_to_pdf"] = "false"
        status, _ = self.request(payload, token="x" * 32)
        self.assertTrue(status.startswith("422"))


if __name__ == "__main__":
    unittest.main()
