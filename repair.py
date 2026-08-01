"""Capa de reparacion + validacion de la data del Sheet 'Seguimiento equipo'.

PROBLEMA (raiz):
  El Sheet tiene locale es_ES (decimal = coma, miles = punto). Aleph escribe los
  decimales en formato US ("14343.68"). Google Sheets:
    - deja la mayoria como TEXTO  -> el valor es correcto, solo hay que parsearlo
    - a veces lo interpreta como numero tratando el "." como separador de miles
      -> "14343.68" se convierte en 1434368 (x100) y "23518.4" en 235184 (x10)

REPARACION:
  Solo se tocan celdas NUMERICAS de columnas decimales (GMV/MKD/BKA/RVA).
  Para cada una se prueban los candidatos {v, v/10, v/100} y se elige el que queda
  mas cerca (en escala log) de la referencia de esa marca+canal+columna, construida
  con los meses cuya celda vino como TEXTO (no corrompible). Si no hay referencia
  propia se usa la razon tipica contra GMV de la cartera.
  Las columnas enteras (ORD, USR, SS, ATC, VC, OP, OPC, NEW_O, RET_O, RCT_O, OA, TS)
  no son corrompibles: Snowflake las devuelve sin punto decimal.
"""
import datetime as dt
import math
from collections import defaultdict
from statistics import median

EPOCH = dt.date(1899, 12, 30)

COLS = ['KAM', 'MARCA', 'CANAL', 'MES', 'ORD', 'USR', 'GMV', 'SS', 'ATC', 'VC',
        'OP', 'OPC', 'NEW_O', 'RET_O', 'RCT_O', 'MKD', 'BKA', 'RVA', 'OA', 'TS']
DECIMAL_COLS = ['GMV', 'MKD', 'BKA', 'RVA']
INT_COLS = ['ORD', 'USR', 'SS', 'ATC', 'VC', 'OP', 'OPC', 'NEW_O', 'RET_O',
            'RCT_O', 'OA', 'TS']
# razon tipica contra GMV, usada solo como referencia de ultimo recurso
RATIO_BASE = {'MKD': 0.06, 'BKA': 0.02, 'RVA': 0.02}


def serial_to_date(v):
    try:
        return (EPOCH + dt.timedelta(days=int(float(v)))).replace(day=1)
    except (TypeError, ValueError):
        return None


def _clean_text(v):
    """Valor de una celda TEXTO: viene en formato US, es confiable."""
    try:
        return float(str(v).replace(',', ''))
    except ValueError:
        return None


def parse_rows(header, rows):
    """Devuelve filas dict con valor y procedencia ('text' | 'num' | None)."""
    idx = {c: i for i, c in enumerate(header)}
    out = []
    for r in rows:
        rec = {'KAM': str(r[idx['KAM']]).strip(),
               'MARCA': str(r[idx['MARCA']]).strip(),
               'CANAL': str(r[idx['CANAL']]).strip(),
               'MES': serial_to_date(r[idx['MES']])}
        if not rec['MARCA'] or rec['MES'] is None:
            continue
        for c in COLS[4:]:
            raw = r[idx[c]] if idx[c] < len(r) else ''
            if raw == '' or raw is None:
                rec[c] = None
                rec['_src_' + c] = None
            elif isinstance(raw, str):
                rec[c] = _clean_text(raw)
                rec['_src_' + c] = 'text'
            else:
                rec[c] = float(raw)
                rec['_src_' + c] = 'num'
        out.append(rec)
    return out


def repair(rows, log=None):
    """Corrige las celdas numericas de columnas decimales. Muta y devuelve rows."""
    log = log if log is not None else []
    stats = defaultdict(lambda: defaultdict(int))

    # referencia por marca+canal+columna con los valores que vinieron como texto
    ref = defaultdict(list)
    for r in rows:
        for c in DECIMAL_COLS:
            if r['_src_' + c] == 'text' and r[c] and abs(r[c]) > 0:
                ref[(r['MARCA'], r['CANAL'], c)].append(abs(r[c]))
    ref = {k: median(v) for k, v in ref.items() if v}

    for r in rows:
        gmv_ok = r['GMV'] if r['_src_GMV'] == 'text' else None
        for c in DECIMAL_COLS:
            if r['_src_' + c] != 'num':
                continue
            v = r[c]
            if v is None or v == 0:
                stats[c]['cero/na'] += 1
                continue
            target = ref.get((r['MARCA'], r['CANAL'], c))
            if target is None and c != 'GMV' and gmv_ok:
                target = abs(gmv_ok) * RATIO_BASE[c]
            if target is None or target <= 0:
                stats[c]['sin referencia'] += 1
                continue
            best, bestd = None, None
            for div in (1, 10, 100):
                cand = abs(v) / div
                if cand <= 0:
                    continue
                d = abs(math.log10(cand) - math.log10(target))
                if bestd is None or d < bestd:
                    best, bestd = div, d
            if best == 1:
                stats[c]['ok (entero real)'] += 1
                continue
            nuevo = v / best
            log.append({'marca': r['MARCA'], 'canal': r['CANAL'],
                        'mes': r['MES'].isoformat(), 'col': c,
                        'antes': v, 'despues': nuevo, 'div': best,
                        'referencia': target})
            r[c] = nuevo
            stats[c][f'corregido /{best}'] += 1

    # sanity: las columnas enteras no deberian traer texto
    for r in rows:
        for c in INT_COLS:
            if r['_src_' + c] == 'text':
                stats[c]['texto inesperado'] += 1
    return rows, stats, log


def flags(rows):
    """Marca filas con valores implausibles que NO se reparan (se reportan)."""
    out = []
    for r in rows:
        f = []
        if r['GMV'] is not None and r['GMV'] < 0:
            f.append('GMV negativo')
        if r['ORD'] and r['GMV'] is not None and r['ORD'] > 0:
            aov = r['GMV'] / r['ORD']
            if aov > 200:
                f.append(f'AOV {aov:.0f} > 200')
            elif 0 < aov < 1:
                f.append(f'AOV {aov:.2f} < 1')
        if r['MKD'] and r['GMV'] and r['GMV'] > 0 and r['MKD'] / r['GMV'] > 0.6:
            f.append('MKD > 60% GMV')
        if f:
            out.append((r, f))
    return out
