"""Cambia el idioma del Sheet 'Seguimiento equipo' de es_ES a en_US.

Por que: con es_ES el separador decimal es la coma, y Google Sheets reinterpreta
los decimales que Aleph escribe en formato US ("14343.68") tomando el punto como
separador de miles -> 1434368, cien veces mas grande. Con en_US entran bien.

El cambio aplica a lo que se escriba de aqui en adelante: los valores ya
corrompidos se arreglan solos en el siguiente refresco de Aleph.

Uso:  python fix_locale.py            # cambia a en_US
      python fix_locale.py --revertir # regresa a es_ES
"""
import sys, argparse
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
import gspread

sys.stdout.reconfigure(encoding='utf-8')

TOKEN = r'C:\Users\raquel.acosta\Claude\token.json'
SCOPES = ['https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/drive.readonly']
SHEET_ID = '1fJV6tR2yTgmDRDU7GBTHzKEmtZzuvGK_vgPYxEZtTr0'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--revertir', action='store_true')
    destino = 'es_ES' if ap.parse_args().revertir else 'en_US'

    creds = Credentials.from_authorized_user_file(TOKEN, SCOPES)
    if not creds.valid:
        creds.refresh(Request())
        open(TOKEN, 'w').write(creds.to_json())
    sh = gspread.authorize(creds).open_by_key(SHEET_ID)

    antes = sh.fetch_sheet_metadata({'fields': 'properties'})['properties']
    print(f"Sheet: {antes.get('title')}")
    print(f"  locale actual: {antes.get('locale')}   zona: {antes.get('timeZone')}")
    if antes.get('locale') == destino:
        print(f'  ya esta en {destino}, no hay nada que hacer.')
        return

    sh.batch_update({'requests': [{
        'updateSpreadsheetProperties': {
            'properties': {'locale': destino},
            'fields': 'locale',
        }}]})

    despues = sh.fetch_sheet_metadata({'fields': 'properties'})['properties']
    print(f"  locale nuevo:  {despues.get('locale')}")
    print('\nListo. En el siguiente refresco de Aleph los decimales entraran como numeros.')
    print('Para deshacer:  python fix_locale.py --revertir')


if __name__ == '__main__':
    main()
