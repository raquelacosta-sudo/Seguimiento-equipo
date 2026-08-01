"""Construye data/seguimiento.json para el dashboard 'Seguimiento equipo'.

Fuente primaria : Snowflake (exacto).
Fuente de respaldo: el Google Sheet 'Seguimiento equipo' con la capa de reparacion
                    de repair.py (el Sheet tiene locale es_ES y corrompe decimales).

Uso:
    python build_data.py             # intenta Snowflake, cae al Sheet si falla
    python build_data.py --sheet     # fuerza el Sheet
"""
import sys, os, json, argparse, datetime as dt
from collections import defaultdict

sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

LIDER_EMAIL = 'raquel.acosta@rappi.com'
LIDER_NOMBRE = 'Raquel Acosta'
SF_ACCOUNT = 'hg51401'
SF_WAREHOUSE = 'RP_PERSONALUSER_WH'
SF_DATABASE = 'RP_SILVER_DB_PROD'
MESES_HIST = 25

METRICS = ['ord', 'usr', 'gmv', 'ss', 'atc', 'vc', 'op', 'opc',
           'new', 'ret', 'rct', 'mkd', 'bka', 'rva', 'oa', 'ts']

BRAND_MAP = f"""
WITH brand_map AS (
  SELECT BRAND_ID, BRAND_OWNER_NAME AS kam,
    CASE WHEN UPPER(BRAND_NAME) LIKE '%TURBO%' OR UPPER(BRAND_NAME) LIKE '%TBO%'
         THEN 'turbo' ELSE 'regular' END AS canal,
    INITCAP(LOWER(TRIM(TRANSLATE(
      REGEXP_REPLACE(REGEXP_REPLACE(BRAND_NAME, '\\\\s*-?\\\\s*[Tt][Uu][Rr][Bb][Oo]\\\\s*$', ''),
        '\\\\s*-?\\\\s*[Tt][Bb][Oo]\\\\s*$', ''),
      'áéíóúÁÉÍÓÚüÜñÑ', 'aeiouAEIOUuUnN')))) AS marca
  FROM RP_GOLD_DB_PROD.RESTAURANTES_GLOBAL_MDA.A_SCORECARD_REST4
  WHERE COUNTRY = 'MX' AND BRAND_OWNER_LEADER = '{LIDER_EMAIL}'
  GROUP BY 1,2,3,4
)"""

Q_MENSUAL = BRAND_MAP + f"""
SELECT bm.kam, bm.marca, bm.canal, DATE_TRUNC('month', g.DAY)::DATE AS mes,
  SUM(g.TOTAL_ORDERS) AS ord, SUM(g.TOTAL_USERS) AS usr,
  ROUND(SUM(g.GMV_USD_),2) AS gmv,
  SUM(g.SS) AS ss, SUM(g.ATC) AS atc, SUM(g.VC) AS vc, SUM(g.OP) AS op, SUM(g.OPC) AS opc,
  SUM(g.MKD_ORDERS_NEW) AS new_o, SUM(g.MKD_ORDERS_RET) AS ret_o, SUM(g.MKD_ORDERS_RCT) AS rct_o,
  ROUND(SUM(g.MKD),2) AS mkd, ROUND(SUM(g.BOOKINS_WO_FAKE_ADS),2) AS bka,
  ROUND(SUM(g.REVENUE_WO_FAKE_ADS),2) AS rva, SUM(g.ORDERS_ADS_) AS oa,
  COUNT(DISTINCT g.STORE_ID) AS ts
FROM RP_SILVER_DB_PROD.RESTAURANTES_RADS.FOLLOW_UP_GROWTH_METRICS_DIMENSIONS g
JOIN brand_map bm ON bm.BRAND_ID = g.BRAND_ID
WHERE g.COUNTRY = 'MX'
  AND g.DAY >= DATEADD('month', -{MESES_HIST}, DATE_TRUNC('month', CURRENT_DATE))
GROUP BY 1,2,3,4 ORDER BY 1,2,3,4
"""

# Comparables del mes en curso: mismo rango de dias en el mes previo y el ano pasado.
Q_MTD = BRAND_MAP + """
, lim AS (
  SELECT MAX(DAY)::DATE AS max_day FROM RP_SILVER_DB_PROD.RESTAURANTES_RADS.FOLLOW_UP_GROWTH_METRICS_DIMENSIONS
  WHERE COUNTRY = 'MX'
)
SELECT bm.kam, bm.marca, bm.canal,
  CASE
    WHEN g.DAY BETWEEN DATE_TRUNC('month', l.max_day) AND l.max_day THEN 'mtd'
    WHEN g.DAY BETWEEN DATEADD('month',-1,DATE_TRUNC('month',l.max_day))
                   AND DATEADD('month',-1,l.max_day) THEN 'mtd_pm'
    WHEN g.DAY BETWEEN DATEADD('year',-1,DATE_TRUNC('month',l.max_day))
                   AND DATEADD('year',-1,l.max_day) THEN 'mtd_ly'
  END AS bucket,
  SUM(g.TOTAL_ORDERS) AS ord, ROUND(SUM(g.GMV_USD_),2) AS gmv,
  SUM(g.TOTAL_USERS) AS usr, SUM(g.SS) AS ss, SUM(g.OP) AS op,
  ROUND(SUM(g.MKD),2) AS mkd
FROM RP_SILVER_DB_PROD.RESTAURANTES_RADS.FOLLOW_UP_GROWTH_METRICS_DIMENSIONS g
JOIN brand_map bm ON bm.BRAND_ID = g.BRAND_ID
CROSS JOIN lim l
WHERE g.COUNTRY = 'MX'
  AND g.DAY >= DATEADD('year',-1,DATE_TRUNC('month', l.max_day))
GROUP BY 1,2,3,4 HAVING bucket IS NOT NULL ORDER BY 1,2,3
"""

Q_CATALOGO = f"""
SELECT
  INITCAP(LOWER(TRIM(TRANSLATE(
    REGEXP_REPLACE(REGEXP_REPLACE(BRAND_NAME, '\\\\s*-?\\\\s*[Tt][Uu][Rr][Bb][Oo]\\\\s*$', ''),
      '\\\\s*-?\\\\s*[Tt][Bb][Oo]\\\\s*$', ''),
    'áéíóúÁÉÍÓÚüÜñÑ', 'aeiouAEIOUuUnN')))) AS marca,
  ANY_VALUE(BRAND_CATEGORY) AS categoria,
  ANY_VALUE(BRAND_OWNER_NAME) AS kam,
  LISTAGG(DISTINCT STORE_CITY, '|') WITHIN GROUP (ORDER BY STORE_CITY) AS ciudades
FROM RP_GOLD_DB_PROD.RESTAURANTES_GLOBAL_MDA.A_SCORECARD_REST4
WHERE COUNTRY = 'MX' AND BRAND_OWNER_LEADER = '{LIDER_EMAIL}'
GROUP BY 1 ORDER BY 1
"""

Q_MAXDAY = """
SELECT MAX(DAY)::DATE AS max_day
FROM RP_SILVER_DB_PROD.RESTAURANTES_RADS.FOLLOW_UP_GROWTH_METRICS_DIMENSIONS
WHERE COUNTRY = 'MX'
"""


# ---------------------------------------------------------------- Snowflake
def from_snowflake():
    import snowflake.connector
    conn = snowflake.connector.connect(
        user=os.environ.get('SF_USER') or LIDER_EMAIL,
        account=SF_ACCOUNT, warehouse=SF_WAREHOUSE, database=SF_DATABASE,
        authenticator='externalbrowser', client_store_temporary_credential=True)
    cur = conn.cursor()
    cur.execute(f'USE WAREHOUSE {SF_WAREHOUSE}')

    def run(sql):
        cur.execute(sql)
        cols = [c[0].lower() for c in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]

    print('  [1/4] max_day...')
    max_day = run(Q_MAXDAY)[0]['max_day']
    print('        data hasta', max_day)
    print('  [2/4] serie mensual...')
    mens = run(Q_MENSUAL)
    print(f'        {len(mens):,} filas')
    print('  [3/4] comparables MTD...')
    mtd = run(Q_MTD)
    print(f'        {len(mtd):,} filas')
    print('  [4/4] catalogo...')
    cat = run(Q_CATALOGO)
    print(f'        {len(cat):,} marcas')
    cur.close(); conn.close()

    series = []
    for r in mens:
        series.append({
            'kam': r['kam'], 'marca': r['marca'], 'canal': r['canal'],
            'mes': r['mes'],
            'ord': r['ord'], 'usr': r['usr'], 'gmv': r['gmv'], 'ss': r['ss'],
            'atc': r['atc'], 'vc': r['vc'], 'op': r['op'], 'opc': r['opc'],
            'new': r['new_o'], 'ret': r['ret_o'], 'rct': r['rct_o'],
            'mkd': r['mkd'], 'bka': r['bka'], 'rva': r['rva'], 'oa': r['oa'],
            'ts': r['ts']})
    catalogo = {c['marca']: {'categoria': c['categoria'] or '',
                             'kam': c['kam'] or '',
                             'ciudades': [x for x in (c['ciudades'] or '').split('|') if x]}
                for c in cat}
    return series, catalogo, mtd, max_day, 'snowflake'


# -------------------------------------------------------------------- Sheet
def from_sheet():
    from repair import parse_rows, repair
    import fetch_raw
    path = os.path.join(HERE, 'raw', 'sheet.json')
    if not os.path.exists(path):
        fetch_raw.main()
    raw = json.load(open(path, encoding='utf-8'))
    t = raw['tabs']['PERIODOS']
    rows = parse_rows(t['header'], t['rows'])
    rows, stats, log = repair(rows)
    print(f'  reparadas {len(log)} celdas (locale {raw["locale"]})')

    series = []
    for r in rows:
        series.append({'kam': r['KAM'], 'marca': r['MARCA'], 'canal': r['CANAL'],
                       'mes': r['MES'],
                       'ord': r['ORD'], 'usr': r['USR'], 'gmv': r['GMV'],
                       'ss': r['SS'], 'atc': r['ATC'], 'vc': r['VC'],
                       'op': r['OP'], 'opc': r['OPC'], 'new': r['NEW_O'],
                       'ret': r['RET_O'], 'rct': r['RCT_O'], 'mkd': r['MKD'],
                       'bka': r['BKA'], 'rva': r['RVA'], 'oa': r['OA'],
                       'ts': r['TS']})
    ch = raw['tabs']['CATEGORIAS']['header']
    ci = {c: i for i, c in enumerate(ch)}
    catalogo = {}
    for r in raw['tabs']['CATEGORIAS']['rows']:
        catalogo[str(r[ci['MARCA']]).strip()] = {
            'categoria': str(r[ci['CATEGORIA']]).strip(),
            'kam': str(r[ci['KAM']]).strip(),
            'ciudades': [c.strip() for c in str(r[ci['CIUDADES']]).split(',') if c.strip()]}
    max_day = max(r['mes'] for r in series)
    return series, catalogo, [], max_day, 'sheet'


# ------------------------------------------------------------------ ensamble
def ensamblar(series, catalogo, mtd, max_day, fuente):
    meses = sorted({r['mes'] for r in series})
    midx = {m: i for i, m in enumerate(meses)}
    n = len(meses)

    grupos = {}
    for r in series:
        k = (r['kam'], r['marca'], r['canal'])
        g = grupos.setdefault(k, {m: [None] * n for m in METRICS})
        i = midx[r['mes']]
        for m in METRICS:
            v = r.get(m)
            g[m][i] = None if v is None else round(float(v), 2)

    mtd_by = defaultdict(dict)
    for r in mtd:
        k = (r['kam'], r['marca'], r['canal'])
        mtd_by[k][r['bucket']] = {
            'ord': float(r['ord'] or 0), 'gmv': round(float(r['gmv'] or 0), 2),
            'usr': float(r['usr'] or 0), 'ss': float(r['ss'] or 0),
            'op': float(r['op'] or 0), 'mkd': round(float(r['mkd'] or 0), 2)}

    brands = []
    for (kam, marca, canal), g in sorted(grupos.items()):
        c = catalogo.get(marca, {})
        brands.append({'kam': kam, 'marca': marca, 'canal': canal,
                       'categoria': c.get('categoria') or 'Sin categoria',
                       'ciudades': c.get('ciudades', []),
                       'mtd': mtd_by.get((kam, marca, canal), {}),
                       **g})

    mes_actual = max_day.replace(day=1)
    ultimo_cerrado = meses[-1]
    parcial = meses[-1] == mes_actual
    if parcial and len(meses) > 1:
        ultimo_cerrado = meses[-2]

    import calendar
    dias_mes = calendar.monthrange(max_day.year, max_day.month)[1]

    ciudades = sorted({c for b in brands for c in b['ciudades']})
    cats = sorted({b['categoria'] for b in brands})
    kams = sorted({b['kam'] for b in brands})

    qa = {
        'marcas': len({b['marca'] for b in brands}),
        'series': len(brands),
        'sin_categoria': sorted({b['marca'] for b in brands
                                 if b['categoria'] == 'Sin categoria'}),
        'gmv_negativo': [{'marca': b['marca'], 'canal': b['canal'],
                          'mes': meses[i].isoformat(), 'gmv': v}
                         for b in brands for i, v in enumerate(b['gmv'])
                         if v is not None and v < 0],
    }

    return {
        'meta': {
            'generated_at': dt.datetime.now().isoformat(timespec='seconds'),
            'fuente': fuente,
            'data_hasta': max_day.isoformat(),
            'mes_parcial': parcial,
            'dias_transcurridos': max_day.day if parcial else dias_mes,
            'dias_del_mes': dias_mes,
            'ultimo_cerrado': ultimo_cerrado.isoformat(),
            'lider': LIDER_NOMBRE, 'lider_email': LIDER_EMAIL,
            'kams': kams, 'categorias': cats, 'ciudades': ciudades,
            'meses': [m.isoformat() for m in meses],
            'metricas': METRICS,
        },
        'brands': brands,
        'qa': qa,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sheet', action='store_true', help='forzar el Google Sheet')
    args = ap.parse_args()

    if args.sheet:
        print('Fuente: Google Sheet (forzada)')
        data = from_sheet()
    else:
        try:
            print('Fuente: Snowflake (se abrira el navegador para SSO la 1a vez)')
            data = from_snowflake()
        except Exception as e:
            print(f'  Snowflake fallo: {e}\n  -> usando el Google Sheet como respaldo')
            data = from_sheet()

    payload = ensamblar(*data)
    out_dir = os.path.join(HERE, 'data')
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, 'seguimiento.json')
    raw = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
    with open(path, 'w', encoding='utf-8') as f:
        f.write(raw)

    m = payload['meta']
    print(f"\nOK -> {path}  ({len(raw)/1048576:.2f} MB)")
    print(f"  fuente={m['fuente']}  data hasta {m['data_hasta']}")
    print(f"  meses={len(m['meses'])} ({m['meses'][0]} a {m['meses'][-1]})")
    print(f"  ultimo mes cerrado: {m['ultimo_cerrado']}  |  mes en curso parcial: {m['mes_parcial']}"
          f" ({m['dias_transcurridos']}/{m['dias_del_mes']} dias)")
    print(f"  KAMs={len(m['kams'])} marcas={payload['qa']['marcas']} series={payload['qa']['series']}")
    print(f"  ciudades={len(m['ciudades'])} categorias={len(m['categorias'])}")
    print(f"  QA: sin categoria={len(payload['qa']['sin_categoria'])} "
          f"GMV negativo={len(payload['qa']['gmv_negativo'])} celdas")


if __name__ == '__main__':
    main()
