"""Public synthetic cache-only/visual control; never rewrites a provider workbook."""
from pathlib import Path
import hashlib
import struct
import zlib
import zipfile
import xml.etree.ElementTree as ET

root = Path(__file__).parent / "fixtures"
source = root / "representative.xlsx"
assert hashlib.sha256(source.read_bytes()).hexdigest() == "0ce74976d90b9fab8463dc701c8b30c888f08c25af3813d1fdca49180829a256"
ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
rels = "http://schemas.openxmlformats.org/package/2006/relationships"
rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
ct = "http://schemas.openxmlformats.org/package/2006/content-types"
ET.register_namespace("", ns)
ET.register_namespace("r", rel)


def png():
    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))
    rows = b"".join(b"\0" + b"".join(bytes((20, 100, 220, 255) if (x + y) % 2 else (20, 180, 100, 255)) for x in range(8)) for y in range(8))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 8, 8, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")


def anchor(col, row, end, bottom, body):
    return f'<xdr:twoCellAnchor><xdr:from><xdr:col>{col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>{row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>{end}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>{bottom}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>{body}<xdr:clientData/></xdr:twoCellAnchor>'


with zipfile.ZipFile(source) as archive:
    sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
    data = sheet.find(f"{{{ns}}}sheetData")
    assert data is not None
    for cell in data.iter(f"{{{ns}}}c"):
        if cell.get("r") == "A1":
            cell.find(f"{{{ns}}}v").text = "8"
    row = next(item for item in data if item.get("r") == "2")
    for name, kind, formula, value in [("E2", "str", '"LIVE RECALC"', "CACHED ONLY"), ("F2", "b", "FALSE()", "1"), ("G2", "str", 'WEBSERVICE("https://example.invalid/never")', "NO FETCH")]:
        cell = ET.SubElement(row, f"{{{ns}}}c", {"r": name, "t": kind})
        ET.SubElement(cell, f"{{{ns}}}f").text = formula
        ET.SubElement(cell, f"{{{ns}}}v").text = value
    row = ET.SubElement(data, f"{{{ns}}}row", {"r": "8"})
    cell = ET.SubElement(row, f"{{{ns}}}c", {"r": "A8", "t": "inlineStr"})
    ET.SubElement(ET.SubElement(cell, f"{{{ns}}}is"), f"{{{ns}}}t").text = "INERT LINK"
    dimension = sheet.find(f"{{{ns}}}dimension")
    if dimension is not None:
        dimension.set("ref", "A1:G8")
    links = ET.SubElement(sheet, f"{{{ns}}}hyperlinks")
    ET.SubElement(links, f"{{{ns}}}hyperlink", {"ref": "A8", f"{{{rel}}}id": "rIdLink"})
    ET.SubElement(sheet, f"{{{ns}}}drawing", {f"{{{rel}}}id": "rIdDrawing"})
    types = ET.fromstring(archive.read("[Content_Types].xml"))
    ET.SubElement(types, f"{{{ct}}}Default", {"Extension": "png", "ContentType": "image/png"})
    for part, mime in [("/xl/drawings/drawing1.xml", "application/vnd.openxmlformats-officedocument.drawing+xml"), ("/xl/charts/chart1.xml", "application/vnd.openxmlformats-officedocument.drawingml.chart+xml")]:
        ET.SubElement(types, f"{{{ct}}}Override", {"PartName": part, "ContentType": mime})
    picture = '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Synthetic blue green image"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>'
    chart = '<xdr:graphicFrame><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Synthetic cached chart"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rIdChart"/></a:graphicData></a:graphic></xdr:graphicFrame>'
    changes = {
        "xl/worksheets/sheet1.xml": ET.tostring(sheet),
        "[Content_Types].xml": ET.tostring(types),
        "xl/worksheets/_rels/sheet1.xml.rels": f'<Relationships xmlns="{rels}"><Relationship Id="rIdDrawing" Type="{rel}/drawing" Target="../drawings/drawing1.xml"/><Relationship Id="rIdLink" Type="{rel}/hyperlink" Target="https://example.invalid/never" TargetMode="External"/></Relationships>'.encode(),
        "xl/drawings/drawing1.xml": f'<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="{rel}">{anchor(0, 9, 2, 14, picture)}{anchor(3, 9, 8, 20, chart)}</xdr:wsDr>'.encode(),
        "xl/drawings/_rels/drawing1.xml.rels": f'<Relationships xmlns="{rels}"><Relationship Id="rIdImage" Type="{rel}/image" Target="../media/image1.png"/><Relationship Id="rIdChart" Type="{rel}/chart" Target="../charts/chart1.xml"/></Relationships>'.encode(),
        "xl/media/image1.png": png(),
        "xl/charts/chart1.xml": b'<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:ser><c:idx val="0"/><c:order val="0"/><c:cat><c:strLit><c:ptCount val="2"/><c:pt idx="0"><c:v>First</c:v></c:pt><c:pt idx="1"><c:v>Second</c:v></c:pt></c:strLit></c:cat><c:val><c:numRef><c:f>Data!$A$1:$A$2</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>8</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>',
    }
    with zipfile.ZipFile(root / "readonly-rich.xlsx", "w", compression=zipfile.ZIP_DEFLATED) as out:
        for item in archive.infolist():
            out.writestr(item, changes.pop(item.filename, archive.read(item.filename)))
        for name, body in changes.items():
            out.writestr(zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0)), body)
