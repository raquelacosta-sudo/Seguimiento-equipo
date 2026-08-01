"""QA completo del Sheet 'Seguimiento equipo', antes y despues de reparar."""
import sys, os, json, datetime as dt
from collections import defaultdict, Counter

sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from repair import parse_rows, repair, flags, DECIMAL_COLS

raw = json.load(open(os.path.join(HERE, 'raw', 'sheet.json'), encoding='utf-8'))


def sec(t):
    print('\n' + '=' * 76 + f'\n{t}\n' + '=' * 76)


sec('0. FUENTE')
print('locale del Sheet:', raw['locale'], '(es_ES => decimal = coma)')
for t, v in raw['tabs'].items():
    print(f'  {t:11s} {len(v["rows"]):5d} filas | ultimo refresco: {v["lastUpdated"]}')

P = parse_rows(raw['tabs']['PERIODOS']['header'], raw['tabs']['PERIODOS']['rows'])
antes = {r['MES']: 0.0 for r in P}
for r in P:
    antes[r['MES']] += r['GMV'] or 0
ord_mes = defaultdict(float)
for r in P:
    ord_mes[r['MES']] += r['ORD'] or 0

sec('1. TIPO DE CELDA POR COLUMNA (origen de la corrupcion)')
for c in ['GMV', 'MKD', 'BKA', 'RVA', 'ORD', 'SS', 'RET_O', 'TS']:
    cnt = Counter(r['_src_' + c] for r in P)
    print(f'  {c:6s} texto={cnt["text"]:5d}  numero={cnt["num"]:5d}  vacio={cnt[None]:5d}')
print('\n  -> las columnas decimales (GMV/MKD/BKA/RVA) deberian ser 100% texto.')
print('     cada celda "numero" es un decimal que Sheets reinterpreto quitando el punto.')

P, stats, log = repair(P)

sec('2. REPARACION APLICADA')
tot = 0
for c in DECIMAL_COLS:
    print(f'  {c}:', dict(stats[c]))
    tot += sum(v for k, v in stats[c].items() if k.startswith('corregido'))
print(f'\n  TOTAL de celdas corregidas: {tot}')
print('\n  muestra de correcciones:')
for e in log[:12]:
    print(f"    {e['marca'][:26]:26s} {e['mes']} {e['col']:4s} "
          f"{e['antes']:>14,.0f} -> {e['despues']:>12,.2f}  (/{e['div']}, ref {e['referencia']:,.0f})")

sec('3. IMPACTO: GMV DE CARTERA ANTES vs DESPUES')
desp = defaultdict(float)
for r in P:
    desp[r['MES']] += r['GMV'] or 0
meses = sorted(desp)
print(f'{"mes":>10} {"GMV antes":>14} {"GMV corregido":>14} {"delta%":>8} '
      f'{"ordenes":>9} {"AOV antes":>10} {"AOV ok":>8}')
for m in meses:
    a, d, o = antes[m], desp[m], ord_mes[m]
    print(f'{m.strftime("%b-%y"):>10} {a:>14,.0f} {d:>14,.0f} '
          f'{(d/a-1)*100 if a else 0:>7.1f}% {o:>9,.0f} '
          f'{a/o if o else 0:>10.2f} {d/o if o else 0:>8.2f}')

sec('4. VALIDACION: estabilidad del AOV (mide si la reparacion funciono)')
aov_a = [antes[m] / ord_mes[m] for m in meses if ord_mes[m]]
aov_d = [desp[m] / ord_mes[m] for m in meses if ord_mes[m]]


def cv(xs):
    mu = sum(xs) / len(xs)
    return (sum((x - mu) ** 2 for x in xs) / len(xs)) ** .5 / mu


print(f'  AOV antes:     min {min(aov_a):.2f}  max {max(aov_a):.2f}  '
      f'coef.variacion {cv(aov_a)*100:.1f}%')
print(f'  AOV corregido: min {min(aov_d):.2f}  max {max(aov_d):.2f}  '
      f'coef.variacion {cv(aov_d)*100:.1f}%')

sec('5. MES EN CURSO (parcial) vs MESES CERRADOS')
hoy = dt.date.today()
mes_actual = hoy.replace(day=1)
print(f'  hoy: {hoy}   ultimo mes en la data: {meses[-1]}')
print(f'  el ultimo mes {"ES EL MES EN CURSO => PARCIAL" if meses[-1] == mes_actual else "esta cerrado"}')
if len(meses) >= 4:
    prom3 = sum(desp[m] for m in meses[-4:-1]) / 3
    print(f'  GMV {meses[-1].strftime("%b-%y")} = {desp[meses[-1]]:,.0f} vs promedio 3m previos '
          f'{prom3:,.0f} ({desp[meses[-1]]/prom3*100:.0f}% del promedio)')

sec('6. FILAS CON VALORES IMPLAUSIBLES (no se reparan, se reportan)')
fl = flags(P)
print(f'  filas marcadas: {len(fl)} de {len(P)}')
byf = Counter(f for _, fs in fl for f in
              [x.split(' ')[0] + ' ' + x.split(' ')[1] if ' ' in x else x for x in fs])
for k, v in byf.most_common():
    print(f'    {k:20s} {v}')
print('\n  peores 12 por GMV negativo:')
neg = sorted([r for r, f in fl if any('negativo' in x for x in f)],
             key=lambda r: r['GMV'])
for r in neg[:12]:
    print(f"    {r['MARCA'][:28]:28s} {r['CANAL']:7s} {r['MES']} "
          f"GMV={r['GMV']:>12,.0f} ord={r['ORD'] or 0:>7,.0f}")

sec('7. COBERTURA: KAMs y marcas')
kams = defaultdict(lambda: {'marcas': set(), 'gmv': 0.0})
ult_cerrado = meses[-2] if meses[-1] == mes_actual else meses[-1]
for r in P:
    kams[r['KAM']]['marcas'].add(r['MARCA'])
    if r['MES'] == ult_cerrado:
        kams[r['KAM']]['gmv'] += r['GMV'] or 0
print(f'  KAMs: {len(kams)}   (GMV de {ult_cerrado.strftime("%b-%y")}, ultimo mes cerrado)')
for k in sorted(kams, key=lambda x: -kams[x]['gmv']):
    print(f'    {k:22s} marcas={len(kams[k]["marcas"]):3d}  GMV={kams[k]["gmv"]:>12,.0f}')
print(f'\n  marcas distintas totales: {len({r["MARCA"] for r in P})}')

sec('8. CATEGORIAS: cobertura')
ch = raw['tabs']['CATEGORIAS']['header']
ci = {c: i for i, c in enumerate(ch)}
cat = {}
for r in raw['tabs']['CATEGORIAS']['rows']:
    cat[str(r[ci['MARCA']]).strip()] = {
        'categoria': str(r[ci['CATEGORIA']]).strip(),
        'kam': str(r[ci['KAM']]).strip(),
        'ciudades': [c.strip() for c in str(r[ci['CIUDADES']]).split(',') if c.strip()]}
marcas = {r['MARCA'] for r in P}
sin = sorted(marcas - set(cat))
print(f'  marcas con data: {len(marcas)}   con categoria: {len(marcas & set(cat))}   '
      f'SIN categoria: {len(sin)}')
print('  ejemplos sin categoria:', sin[:12])
print(f'  ciudades distintas: {len({c for v in cat.values() for c in v["ciudades"]})}')

sec('9. INTEGRIDAD DE LLAVE Y SERIES')
dup = Counter((r['KAM'], r['MARCA'], r['CANAL'], r['MES']) for r in P)
print('  llaves duplicadas:', sum(1 for v in dup.values() if v > 1))
mk = defaultdict(set)
for r in P:
    mk[r['MARCA']].add(r['KAM'])
print('  marcas en >1 KAM:', {m: sorted(k) for m, k in mk.items() if len(k) > 1} or 'ninguna')
huecos = 0
serie = defaultdict(set)
for r in P:
    serie[(r['MARCA'], r['CANAL'])].add(r['MES'])
for k, ms in serie.items():
    ms = sorted(ms)
    cur, n = ms[0], 0
    while cur <= ms[-1]:
        if cur not in ms:
            n += 1
        cur = (cur.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    huecos += n
print(f'  huecos de meses dentro de series activas: {huecos}')

sec('10. PERIODOS vs MENSUAL')
M = parse_rows(raw['tabs']['MENSUAL']['header'], raw['tabs']['MENSUAL']['rows'])
M, _, _ = repair(M)
kp = {(r['MARCA'], r['CANAL'], r['MES']) for r in P}
km = {(r['MARCA'], r['CANAL'], r['MES']) for r in M}
print(f'  PERIODOS {len(P)} filas | MENSUAL {len(M)} filas')
print(f'  solo en PERIODOS: {len(kp-km)}   solo en MENSUAL: {len(km-kp)}')
print('  -> ambas pestanas corren la MISMA query mensual; MENSUAL filtra ademas')
print('     por BRAND_OWNER_LEADER en la tabla de hechos, lo que recorta historia')
print('     de marcas que cambiaron de duenno. Se usa PERIODOS.')
