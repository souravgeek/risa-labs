#!/usr/bin/env python3
"""Import the ten CampusFest source tables. Uses only Python's standard library."""
import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
from zipfile import ZipFile

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
TABLES = {
    'Event': ('event', 'event_name'),
    'Targets': ('targets', 'effective_at'),
    'Brands': ('brands', 'brand_id'),
    'Sponsor contacts': ('sponsor_contacts', 'contact_id'),
    'Sponsor campaigns': ('sponsor_campaigns', 'sponsor_campaign_id'),
    'Sponsor interactions': ('sponsor_interactions', 'interaction_id'),
    'Brand qualification': ('brand_qualification_history', 'history_id'),
    'Partner opportunities': ('opportunities', 'opportunity_id'),
    'Opportunity history': ('opportunity_history', 'history_id'),
    'Sponsor activations': ('sponsor_activations', 'activation_id'),
}
IST = timezone(timedelta(hours=5, minutes=30))
EPOCH = datetime(1899, 12, 30, tzinfo=IST)

def cell_value(cell, strings):
    value = cell.find('m:v', NS)
    kind = cell.get('t')
    if kind == 'inlineStr':
        return ''.join(e.text or '' for e in cell.findall('.//m:t', NS))
    if value is None or value.text is None:
        return None
    if kind == 's':
        return strings[int(value.text)]
    if kind == 'b':
        return value.text == '1'
    if kind in ('str', 'd'):
        return value.text
    value = float(value.text)
    return int(value) if value.is_integer() else value

def normalize(field, value):
    date_only = field in ('history_start', 'history_end')
    if (date_only or field.endswith('_at')) and isinstance(value, (int, float)):
        stamp = EPOCH + timedelta(seconds=round(value * 86400))
        return stamp.date().isoformat() if date_only else stamp.isoformat(timespec='seconds')
    return value

def dedupe(rows, id_field):
    result = {}
    for row in rows:
        identity = row[id_field]
        if identity in result and result[identity] != row:
            raise ValueError(f'Conflicting records for {id_field}={identity}')
        result[identity] = row
    return [result[k] for k in sorted(result)]

def load(path):
    with ZipFile(path) as book:
        names = book.namelist()
        strings = [''.join(t.text or '' for t in el.findall('.//m:t', NS))
                   for el in ET.fromstring(book.read('xl/sharedStrings.xml'))] if 'xl/sharedStrings.xml' in names else []
        sheets = ET.fromstring(book.read('xl/workbook.xml')).findall('.//m:sheet', NS)
        rels = {el.get('Id'): el.get('Target') for el in ET.fromstring(book.read('xl/_rels/workbook.xml.rels'))}
        data, dropped = {}, {}
        for sheet in sheets:
            if sheet.get('name') not in TABLES:
                continue
            name, key = TABLES[sheet.get('name')]
            target = rels[sheet.get('{%s}id' % NS['r'])]
            target = target.lstrip('/') if target.startswith('/') else 'xl/' + target
            xml_rows = ET.fromstring(book.read(target)).findall('.//m:sheetData/m:row', NS)
            columns, rows = {}, []
            for xml_row in xml_rows:
                values = {re.sub(r'\d+', '', c.get('r')): cell_value(c, strings)
                          for c in xml_row.findall('m:c', NS)}
                if not columns:
                    columns = {k: v for k, v in values.items() if v}
                    continue
                record = {col: normalize(col, values[letter]) for letter, col in columns.items()
                          if values.get(letter) not in (None, '')}
                if record:
                    rows.append({**record, 'origin': 'dataset_2025', 'provenance': 'source'})
            data[name] = dedupe(rows, key)
            dropped[name] = len(rows) - len(data[name])
    missing = {t for t, _ in TABLES.values()} - data.keys()
    if missing:
        raise ValueError(f'Missing source sheets: {sorted(missing)}')
    return data, dropped

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('workbook', type=Path)
    parser.add_argument('--out', type=Path, default=Path(__file__).resolve().parents[1] / 'data/source.json')
    args = parser.parse_args()
    data, dropped = load(args.workbook)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    for name, rows in data.items():
        print(f'{name}: {len(rows)} rows; {dropped[name]} exact duplicates removed')
