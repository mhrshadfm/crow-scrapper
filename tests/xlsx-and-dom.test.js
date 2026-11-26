const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Core = require('../src/core.js');

function testXlsxWithPython() {
  console.log('1. Validating generated 10-column .xlsx ZIP integrity, XML schemas, styles, empty Price/REEL + ID/Phone columns, and clickable hyperlinks via Python...');
  const profiles = [
    Core.calculateProfileMetrics({
      username: 'mmd.fate',
      followers: 373760,
      posts: Array.from({ length: 6 }, (_, i) => ({ shortcode: `p${i}`, views: 120000, likes: 78007, comments: 878 }))
    }),
    Core.calculateProfileMetrics({
      username: 'gallery_mahshid',
      followers: 109928,
      posts: Array.from({ length: 6 }, (_, i) => ({ shortcode: `g${i}`, views: 45000, likes: 18361, comments: 417 }))
    }),
    Core.calculateProfileMetrics({
      username: 'million_creator',
      followers: 500000,
      posts: Array.from({ length: 6 }, (_, i) => ({ shortcode: `m${i}`, views: '1.5M', likes: 85000, comments: 1200 }))
    })
  ];

  const xlsxBytes = Core.generateXlsxBytes(profiles);
  const tmpXlsx = path.join(__dirname, 'test_output.xlsx');
  fs.writeFileSync(tmpXlsx, Buffer.from(xlsxBytes));

  const pyScript = `
import zipfile
import xml.etree.ElementTree as ET
import sys

xlsx_path = sys.argv[1]
with zipfile.ZipFile(xlsx_path, 'r') as zf:
    bad_file = zf.testzip()
    assert bad_file is None, f"Corrupt ZIP entry: {bad_file}"
    names = set(zf.namelist())
    required = {
        '[Content_Types].xml',
        '_rels/.rels',
        'xl/workbook.xml',
        'xl/_rels/workbook.xml.rels',
        'xl/styles.xml',
        'xl/sharedStrings.xml',
        'xl/worksheets/sheet1.xml',
        'xl/worksheets/_rels/sheet1.xml.rels'
    }
    assert required.issubset(names), f"Missing entries: {required - names}"

    # Parse every XML file to verify well-formedness
    for name in names:
        if name.endswith('.xml') or name.endswith('.rels'):
            ET.fromstring(zf.read(name))

    # Verify sharedStrings contain the 9 headers, usernames, and K/M AV VIEW strings
    sst = ET.fromstring(zf.read('xl/sharedStrings.xml'))
    strings = [t.text for t in sst.iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t')]
    expected_headers = ['USERNAME', 'Follower', 'ER', 'V.R.', 'AV VIEW', 'AV LIKE', 'AV COMMENTS', 'LIKES PER COMMENT', 'Price/REEL', 'ID/Phone']
    assert strings[:10] == expected_headers, f"Unexpected headers: {strings[:10]}"
    assert 'mmd.fate' in strings
    assert 'gallery_mahshid' in strings
    assert 'million_creator' in strings
    assert '120K' in strings, f"Expected '120K' in sharedStrings, got {strings}"
    assert '45K' in strings, f"Expected '45K' in sharedStrings, got {strings}"
    assert '1.5M' in strings, f"Expected '1.5M' in sharedStrings, got {strings}"

    # Verify styles.xml contains the 4 header fill colors (#78C8F0, #92D050, #D878D8, #F4B084)
    styles = zf.read('xl/styles.xml').decode('utf-8')
    for color in ['FF78C8F0', 'FF92D050', 'FFD878D8', 'FFF4B084']:
        assert color in styles, f"Missing header color {color} in styles.xml"

    # Verify dimension A1:I4, empty Price/REEL cells (I2, I3, I4), K/M AV VIEW cells (E2, E3, E4), and hyperlinks in sheet1.xml
    sheet = ET.fromstring(zf.read('xl/worksheets/sheet1.xml'))
    ns = {
        'main': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
        'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    }
    dim = sheet.find('main:dimension', ns)
    assert dim is not None and dim.attrib.get('ref') == 'A1:J4', f"Expected A1:J4 dimension, got {dim.attrib if dim is not None else None}"

    # Verify Column E (AV VIEW) cells are shared strings pointing to '120K', '45K', '1.5M'
    for cell_ref, expected_av_view in [('E2', '120K'), ('E3', '45K'), ('E4', '1.5M')]:
        cell = sheet.find(f".//main:c[@r='{cell_ref}']", ns)
        assert cell is not None and cell.attrib.get('t') == 's', f"Expected shared string cell at {cell_ref}"
        val_el = cell.find('main:v', ns)
        assert val_el is not None and strings[int(val_el.text)] == expected_av_view, f"Expected {expected_av_view} at {cell_ref}"

    # Check that I2..I4 (Price/REEL) and J2..J4 (ID/Phone) exist and are empty by default
    for cell_ref in ['I2', 'I3', 'I4', 'J2', 'J3', 'J4']:
        cell = sheet.find(f".//main:c[@r='{cell_ref}']", ns)
        assert cell is not None, f"Missing cell {cell_ref}"
        val_el = cell.find('main:v', ns)
        assert val_el is None, f"Expected empty cell for {cell_ref}, but found value {val_el.text if val_el is not None else ''}"

    hlinks = sheet.findall('.//main:hyperlinks/main:hyperlink', ns)
    assert len(hlinks) == 3, f"Expected 3 hyperlinks, got {len(hlinks)}"
    assert hlinks[0].attrib['ref'] == 'A2'
    assert hlinks[0].attrib['display'] == 'mmd.fate'
    assert hlinks[1].attrib['ref'] == 'A3'
    assert hlinks[1].attrib['display'] == 'gallery_mahshid'
    assert hlinks[2].attrib['ref'] == 'A4'
    assert hlinks[2].attrib['display'] == 'million_creator'

    rels = ET.fromstring(zf.read('xl/worksheets/_rels/sheet1.xml.rels'))
    rel_map = {rel.attrib['Id']: rel.attrib for rel in rels}
    r1 = hlinks[0].attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
    r2 = hlinks[1].attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
    r3 = hlinks[2].attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
    assert rel_map[r1]['Target'] == 'https://www.instagram.com/mmd.fate/'
    assert rel_map[r1]['TargetMode'] == 'External'
    assert rel_map[r2]['Target'] == 'https://www.instagram.com/gallery_mahshid/'
    assert rel_map[r2]['TargetMode'] == 'External'
    assert rel_map[r3]['Target'] == 'https://www.instagram.com/million_creator/'
    assert rel_map[r3]['TargetMode'] == 'External'

    # Verify workbook sheet title is Crow Scrapper
    wb = ET.fromstring(zf.read('xl/workbook.xml'))
    sheet_el = wb.find('.//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheet')
    assert sheet_el is not None and sheet_el.attrib.get('name') == 'Crow Scrapper', f"Expected sheet name 'Crow Scrapper', got {sheet_el.attrib if sheet_el is not None else None}"

print("   [OK] Python ZIP CRC32, XML schema, 10-column header styles, K/M AV VIEW strings, empty Price/REEL + ID/Phone cells, and external hyperlink verification passed!")
`;

  const out = execFileSync('python', ['-c', pyScript, tmpXlsx], { encoding: 'utf8' });
  console.log(out.trim());
  fs.unlinkSync(tmpXlsx);
}

testXlsxWithPython();
