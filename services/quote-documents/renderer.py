"""Restricted DOCX templates: scalar markers and one repeatable item row.

No expression evaluation, URL fetching or execution of template content.
The caller supplies already-authorized commercial data.
"""
import copy
import io
import re
import subprocess
import tempfile
import zipfile
from pathlib import Path
from lxml import etree as ET

MAX_FILE = 5 * 1024 * 1024
MAX_EXPANDED = 25 * 1024 * 1024
NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
MARKER = re.compile(r"\{\{([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?)\}\}")
ITEM_FIELDS = {"code", "description", "unit", "quantity", "unit_price", "total"}


def package(data):
    if not isinstance(data, bytes) or len(data) > MAX_FILE:
        raise ValueError("template_size")
    archive = zipfile.ZipFile(io.BytesIO(data))
    entries = archive.infolist()
    names = [e.filename for e in entries]
    if len(entries) > 300 or len(set(names)) != len(names):
        raise ValueError("template_entries")
    if sum(e.file_size for e in entries) > MAX_EXPANDED:
        raise ValueError("template_expanded_size")
    if "word/document.xml" not in names or "[Content_Types].xml" not in names:
        raise ValueError("not_docx")
    for e in entries:
        name = e.filename.lower()
        if e.flag_bits & 1 or name.startswith("/") or ".." in name.split("/"):
            raise ValueError("unsafe_zip")
        if any(s in name for s in ("vbaproject", "embeddings/", "activex/", "customxml/")):
            raise ValueError("active_content")
        if e.file_size > 1024 * 1024 and e.file_size > max(e.compress_size, 1) * 200:
            raise ValueError("compression_ratio")
    parts = {e.filename: archive.read(e) for e in entries}
    for name, content in parts.items():
        if name.endswith((".xml", ".rels")):
            if b"<!DOCTYPE" in content.upper() or b"<!ENTITY" in content.upper():
                raise ValueError("xml_entities")
            root = ET.fromstring(content, ET.XMLParser(resolve_entities=False, no_network=True))
            if root.xpath('//*[@TargetMode="External"]'):
                raise ValueError("external_relationship")
            if root.xpath("//w:altChunk | //w:object | //w:instrText | //w:fldSimple", namespaces=NS):
                raise ValueError("active_word_fields")
            if b"macroEnabled" in content:
                raise ValueError("macros")
    return parts


def text(element):
    return "".join(element.xpath(".//w:t/text()", namespaces=NS))


def document_parts(parts):
    for name, content in parts.items():
        if re.fullmatch(r"word/(document|header\d+|footer\d+)\.xml", name):
            yield name, ET.fromstring(content, ET.XMLParser(resolve_entities=False, no_network=True))


def inspect(data):
    parts = package(data)
    fields = set()
    items = set()
    repeat_rows = 0
    for _, root in document_parts(parts):
        for row in root.xpath("//w:tr", namespaces=NS):
            if "{{items." in text(row):
                repeat_rows += 1
        for paragraph in root.xpath("//w:p", namespaces=NS):
            value = text(paragraph)
            tokens = MARKER.findall(value)
            residue = MARKER.sub("", value)
            if "{{" in residue or "}}" in residue:
                raise ValueError("invalid_marker")
            for token in tokens:
                if token.startswith("items."):
                    if token[6:] not in ITEM_FIELDS or not paragraph.xpath("ancestor::w:tr", namespaces=NS):
                        raise ValueError("invalid_item_marker")
                    items.add(token[6:])
                elif "." in token:
                    raise ValueError("scalar_keys_use_underscores")
                else:
                    fields.add(token)
    if not fields or repeat_rows != 1 or not {"description", "quantity", "unit_price", "total"} <= items:
        raise ValueError("template_requires_fields_and_one_item_row")
    return {"fields": sorted(fields), "item_fields": sorted(items)}


def replace(paragraph, values):
    nodes = paragraph.xpath(".//w:t", namespaces=NS)
    original = "".join(n.text or "" for n in nodes)
    # Right to left preserves offsets, including markers split across Word runs.
    for match in reversed(list(MARKER.finditer(original))):
        key = match.group(1)
        if key not in values:
            raise ValueError("missing_field:" + key)
        replacement = values[key]
        if not isinstance(replacement, str) or len(replacement) > 2000 or "{{" in replacement or "}}" in replacement:
            raise ValueError("invalid_value:" + key)
        offset = 0
        for node in nodes:
            value = node.text or ""
            end = offset + len(value)
            if offset < match.end() and end > match.start():
                left = max(0, match.start() - offset)
                right = min(len(value), match.end() - offset)
                node.text = value[:left] + (replacement if offset <= match.start() < end else "") + value[right:]
                node.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
            offset = end


def fill(data, values, items):
    manifest = inspect(data)
    if not isinstance(values, dict) or set(values) != set(manifest["fields"]):
        raise ValueError("fields_mismatch")
    if not isinstance(items, list) or not 1 <= len(items) <= 100:
        raise ValueError("items_count")
    parts = package(data)
    for name, root in document_parts(parts):
        for row in list(root.xpath("//w:tr", namespaces=NS)):
            if "{{items." not in text(row):
                continue
            parent = row.getparent()
            for item in items:
                clone = copy.deepcopy(row)
                for p in clone.xpath(".//w:p", namespaces=NS):
                    replace(p, {**values, **{"items." + k: v for k, v in item.items()}})
                parent.insert(parent.index(row), clone)
            parent.remove(row)
        for paragraph in root.xpath("//w:p", namespaces=NS):
            replace(paragraph, values)
        if "{{" in text(root) or "}}" in text(root):
            raise ValueError("unresolved_marker")
        parts[name] = ET.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in parts.items():
            archive.writestr(name, content)
    result = output.getvalue()
    if len(result) > MAX_FILE:
        raise ValueError("output_size")
    return result


def convert_pdf(docx, executable):
    if not executable or not Path(executable).is_file():
        raise ValueError("pdf_converter_unavailable")
    with tempfile.TemporaryDirectory(prefix="torque-quote-") as directory:
        root = Path(directory)
        source = root / "quote.docx"
        source.write_bytes(docx)
        subprocess.run([executable, "-env:UserInstallation=" + (root / "profile").as_uri(),
                        "--headless", "--convert-to", "pdf", "--outdir", str(root), str(source)],
                       check=True, timeout=35, capture_output=True)
        result = (root / "quote.pdf").read_bytes()
        if not result.startswith(b"%PDF-") or len(result) > MAX_FILE:
            raise ValueError("invalid_pdf_output")
        return result
