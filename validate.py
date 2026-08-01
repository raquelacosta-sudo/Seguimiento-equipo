"""Valida data/seguimiento.json contra Snowflake y contra reglas de negocio."""
import sys, os, json, datetime as dt
from collections import defaultdict

sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_data as B

D = json.load(open(os.path.join(HERE, 'data', 'seguimiento.json'), encoding='utf-8'))
meta, brands = D['meta'], D['brands']
meses = meta['meses']


def sec(t):
    print('\n' + '=' * 74 + f'\n{t}\n' + '=' * 74)


def tot(metric, i, filt=None):
    return sum((b[metric][i] or 0) for b in brands if filt is None or filt(b))


sec('A. RESUMEN DEL SNAPSHOT')
print(f"  fuente          {meta['fuente']}")
print(f"  generado        {meta['generated_at']}")
print(f"  data hasta      {meta['data_hasta']}  ({meta['dias_transcurridos']}/{meta['dias_del_mes']} dias del mes)")
print(f"  ultimo cerrado  {meta['ultimo_cerrado']}")
print(f"  meses           {len(meses)}  ({meses[0]} -> {meses[-1]})")
print(f"  KAMs            {len(meta['kams'])}: {', '.join(meta['kams'])}")
print(f"  series          {len(brands)}   marcas {len({b['marca'] for b in brands})}")
print(f"  categorias      {len(meta['categorias'])}   ciudades {len(meta['ciudades'])}")

sec('B. CONTRASTE CONTRA SNOWFLAKE (cartera por mes)')
import snowflake.connector
conn = snowflake.connector.connect(
    user=B.LIDER_EMAIL, account=B.SF_ACCOUNT, database=B.SF_DATABASE,
    authenticator='externalbrowser', client_store_temporary_credential=True)
cur = conn.cursor()
cur.execute(f'USE WAREHOUSE {B.SF_WAREHOUSE}')
cur.execute(B.BRAND_MAP + """
SELECT DATE_TRUNC('month', g.DAY)::DATE AS mes,
  SUM(g.TOTAL_ORDERS) AS ord, ROUND(SUM(g.GMV_USD_),2) AS gmv,
  SUM(g.TOTAL_USERS) AS usr, COUNT(DISTINCT g.STORE_ID) AS ts
FROM RP_SILVER_DB_PROD.RESTAURANTES_RADS.FOLLOW_UP_GROWTH_METRICS_DIMENSIONS g
JOIN brand_map bm ON bm.BRAND_ID = g.BRAND_ID
WHERE g.COUNTRY = 'MX'
  AND g.DAY >= DATEADD('month', -25, DATE_TRUNC('month', CURRENT_DATE))
GROUP BY 1 ORDER BY 1""")
sf = {r[0].isoformat(): {'ord': float(r[1]), 'gmv': float(r[2]), 'usr': float(r[3])}
      for r in cur.fetchall()}

print(f'{"mes":>10} {"GMV json":>13} {"GMV snowflake":>14} {"dif":>8}  {"ord json":>10} {"ord SF":>10} {"dif":>7}')
maxdif = 0
for i, m in enumerate(meses):
    gj, oj = tot('gmv', i), tot('ord', i)
    gs, os_ = sf[m]['gmv'], sf[m]['ord']
    d = (gj / gs - 1) * 100 if gs else 0
    do = (oj / os_ - 1) * 100 if os_ else 0
    maxdif = max(maxdif, abs(d), abs(do))
    print(f'{m[:7]:>10} {gj:>13,.0f} {gs:>14,.0f} {d:>7.2f}% {oj:>10,.0f} {os_:>10,.0f} {do:>6.2f}%')
print(f'\n  desviacion maxima: {maxdif:.3f}%  ->  {"OK" if maxdif < 0.01 else "REVISAR"}')

sec('C. CONTRASTE POR KAM (ultimo mes cerrado)')
i = meses.index(meta['ultimo_cerrado'])
cur.execute(B.BRAND_MAP + f"""
SELECT bm.kam, SUM(g.TOTAL_ORDERS) AS ord, ROUND(SUM(g.GMV_USD_),2) AS gmv
FROM RP_SILVER_DB_PROD.RESTAURANTES_RADS.FOLLOW_UP_GROWTH_METRICS_DIMENSIONS g
JOIN brand_map bm ON bm.BRAND_ID = g.BRAND_ID
WHERE g.COUNTRY = 'MX' AND DATE_TRUNC('month', g.DAY) = '{meta['ultimo_cerrado']}'
GROUP BY 1 ORDER BY 1""")
sfk = {r[0]: (float(r[1]), float(r[2])) for r in cur.fetchall()}
for k in sorted(sfk):
    gj = tot('gmv', i, lambda b: b['kam'] == k)
    print(f'  {k:22s} json {gj:>12,.0f}   SF {sfk[k][1]:>12,.0f}   dif {(gj/sfk[k][1]-1)*100:>6.3f}%')
cur.close(); conn.close()

sec('D. REGLAS DE NEGOCIO')
issues = defaultdict(list)
for b in brands:
    for i, m in enumerate(meses):
        g, o = b['gmv'][i], b['ord'][i]
        if g is not None and g < 0:
            issues['GMV negativo'].append((b['marca'], m, g))
        if o and g is not None and o > 0:
            aov = g / o
            if aov > 120 or (0 < aov < 3):
                issues['AOV fuera de rango (3-120 USD)'].append((b['marca'], m, round(aov, 1)))
        ss, atc, op, opc = b['ss'][i], b['atc'][i], b['op'][i], b['opc'][i]
        if None not in (ss, atc) and atc > ss:
            issues['ATC > SS'].append((b['marca'], m, f'{atc}>{ss}'))
        if None not in (op, atc) and op > atc:
            issues['OP > ATC'].append((b['marca'], m, f'{op}>{atc}'))
        if None not in (opc, op) and opc > op:
            issues['OPC > OP'].append((b['marca'], m, f'{opc}>{op}'))
        if b['mkd'][i] and g and g > 0 and b['mkd'][i] / g > 0.6:
            issues['MKD > 60% del GMV'].append((b['marca'], m, round(b['mkd'][i] / g, 2)))
if not issues:
    print('  sin incidencias')
for k, v in sorted(issues.items(), key=lambda x: -len(x[1])):
    print(f'  {k:34s} {len(v):5d} casos   ej: {v[:3]}')

sec('E. INTEGRIDAD ESTRUCTURAL')
print('  llaves duplicadas:',
      len(brands) - len({(b['kam'], b['marca'], b['canal']) for b in brands}))
mk = defaultdict(set)
for b in brands:
    mk[b['marca']].add(b['kam'])
multi = {m: sorted(k) for m, k in mk.items() if len(k) > 1}
print('  marcas en >1 KAM:', multi or 'ninguna')
print('  series con longitud != meses:',
      sum(1 for b in brands for m in meta['metricas'] if len(b[m]) != len(meses)))
sin_cat = [b['marca'] for b in brands if b['categoria'] == 'Sin categoria']
print(f'  series sin categoria: {len(sin_cat)} {sorted(set(sin_cat))[:8]}')
print(f'  series sin ciudad:    {sum(1 for b in brands if not b["ciudades"])}')
print(f'  series con MTD:       {sum(1 for b in brands if b["mtd"])} de {len(brands)}')

sec('F. MES EN CURSO — comparables MTD (cartera)')
agg = defaultdict(float)
for b in brands:
    for k, v in b['mtd'].items():
        agg[(k, 'gmv')] += v['gmv']; agg[(k, 'ord')] += v['ord']
if agg:
    print(f"  ventana: 1 al {meta['dias_transcurridos']} de cada mes")
    for k in ('mtd', 'mtd_pm', 'mtd_ly'):
        print(f"    {k:7s} GMV {agg[(k,'gmv')]:>12,.0f}   ord {agg[(k,'ord')]:>10,.0f}")
    if agg[('mtd_pm', 'gmv')]:
        print(f"  MoM comparable: {(agg[('mtd','gmv')]/agg[('mtd_pm','gmv')]-1)*100:+.1f}%")
    if agg[('mtd_ly', 'gmv')]:
        print(f"  YoY comparable: {(agg[('mtd','gmv')]/agg[('mtd_ly','gmv')]-1)*100:+.1f}%")

sec('G. SEÑALES DE NEGOCIO (ultimo mes cerrado vs anterior)')
j = i - 1
rank = []
for b in brands:
    a, p = b['gmv'][i] or 0, b['gmv'][j] or 0
    if p > 3000:
        rank.append(((a / p - 1) * 100, b['marca'], b['canal'], b['kam'], p, a))
rank.sort()
print(f"  {meses[j][:7]} -> {meses[i][:7]}   (marcas con GMV previo > $3K)")
print('  TOP 8 DECRECIMIENTO:')
for d, m, c, k, p, a in rank[:8]:
    print(f'    {m[:26]:26s} {c:7s} {k[:14]:14s} {p:>10,.0f} -> {a:>10,.0f}  {d:+7.1f}%')
print('  TOP 8 CRECIMIENTO:')
for d, m, c, k, p, a in rank[-8:][::-1]:
    print(f'    {m[:26]:26s} {c:7s} {k[:14]:14s} {p:>10,.0f} -> {a:>10,.0f}  {d:+7.1f}%')
