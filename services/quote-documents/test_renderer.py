import io
import unittest
import zipfile
from lxml import etree as ET
from renderer import fill, inspect, package, NS


def fixture(extra=None):
    xml = '''<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
    <w:p><w:r><w:t>{{cus</w:t></w:r><w:r><w:t>tomer}} / {{total}}</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>{{items.description}} {{items.quantity}} {{items.unit_price}} {{items.total}}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    </w:body></w:document>'''
    target = io.BytesIO()
    with zipfile.ZipFile(target, "w") as z:
        z.writestr("word/document.xml", xml)
        z.writestr("[Content_Types].xml", '<Types/>')
        z.writestr("word/media/image1.png", b"preserved-logo")
        for name, data in (extra or {}).items():
            z.writestr(name, data)
    return target.getvalue()


class RendererTests(unittest.TestCase):
    def test_split_runs_repetition_and_xml_escaping(self):
        model = fixture()
        self.assertEqual(inspect(model)["fields"], ["customer", "total"])
        item = {"description": "Aço & <motor>", "quantity": "2", "unit_price": "10,00", "total": "20,00"}
        result = package(fill(model, {"customer": "João & Filhos", "total": "40,00"}, [item, item]))
        root = ET.fromstring(result["word/document.xml"])
        self.assertEqual(len(root.xpath("//w:tr", namespaces=NS)), 2)
        self.assertIn("João & Filhos", "".join(root.itertext()))
        self.assertEqual(result["word/media/image1.png"], b"preserved-logo")
        self.assertNotIn("{{", "".join(root.itertext()))

    def test_reject_external_relationship(self):
        with self.assertRaisesRegex(ValueError, "external_relationship"):
            inspect(fixture({"word/_rels/document.xml.rels": '<Relationships><Relationship TargetMode="External" Target="http://internal"/></Relationships>'}))

    def test_reject_macro_and_entities(self):
        for name, content in [("word/vbaProject.bin", b"x"), ("word/test.xml", b'<!DOCTYPE x [<!ENTITY x SYSTEM "file:///secret">]><x/>')]:
            with self.assertRaises(ValueError):
                inspect(fixture({name: content}))

    def test_missing_field_blocks_output(self):
        with self.assertRaisesRegex(ValueError, "fields_mismatch"):
            fill(fixture(), {"customer": "Example"}, [])

    def test_requires_nonempty_items(self):
        with self.assertRaisesRegex(ValueError, "items_count"):
            fill(fixture(), {"customer": "Example", "total": "0"}, [])


if __name__ == "__main__":
    unittest.main()
