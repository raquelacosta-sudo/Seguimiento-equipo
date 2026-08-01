"""Baja las pestanas del Sheet 'Seguimiento equipo' preservando el TIPO de cada celda.

El tipo importa: por el locale es_ES del Sheet, los decimales que Aleph escribe en
formato US ("14343.68") a veces quedan como TEXTO (correcto) y a veces Sheets los
interpreta como numero quitando el punto (14343.68 -> 1434368). Guardamos el tipo
crudo en JSON para poder distinguirlos y repararlos aguas abajo.
"""
import sys, os, json
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
import gspread

sys.stdout.reconfigure(encoding='utf-8')

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw')
TOKEN = os.environ.get('GSHEET_TOKEN', r'C:\Users\raquel.acosta\Claude\token.json')
SCOPES = ['https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/drive.readonly']
SHEET_ID = '1fJV6tR2yTgmDRDU7GBTHzKEmtZzuvGK_vgPYxEZtTr0'

TABS = {
    'PERIODOS':   ("'PERIODOS'!B13:U",   "'PERIODOS'!C7"),
    'MENSUAL':    ("'MENSUAL'!B13:U",    "'MENSUAL'!C7"),
    'CATEGORIAS': ("'CATEGORIAS '!B13:E", "'CATEGORIAS '!C7"),
}


def client():
    creds = Credentials.from_authorized_user_file(TOKEN, SCOPES)
    if not creds.valid:
        creds.refresh(Request())
        with open(TOKEN, 'w') as f:
            f.write(creds.to_json())
    return gspread.authorize(creds)


def main():
    os.makedirs(RAW, exist_ok=True)
    sh = client().open_by_key(SHEET_ID)
    meta = sh.fetch_sheet_metadata({'fields': 'properties'})
    out = {'locale': meta['properties'].get('locale'),
           'timeZone': meta['properties'].get('timeZone'),
           'tabs': {}}

    for name, (rng, upd) in TABS.items():
        res = sh.values_get(rng, params={'valueRenderOption': 'UNFORMATTED_VALUE'})
        rows = res.get('values', [])
        hdr, body = rows[0], [r for r in rows[1:] if r and str(r[0]).strip()]
        u = sh.values_get(upd, params={'valueRenderOption': 'FORMATTED_VALUE'})
        out['tabs'][name] = {
            'header': hdr,
            'lastUpdated': (u.get('values') or [['']])[0][0],
            'rows': [r + [''] * (len(hdr) - len(r)) for r in body],
        }
        print(f'{name}: {len(body)} filas | refresco {out["tabs"][name]["lastUpdated"]}')

    path = os.path.join(RAW, 'sheet.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False)
    print(f'\nlocale={out["locale"]}  ->  {path}')


if __name__ == '__main__':
    main()
