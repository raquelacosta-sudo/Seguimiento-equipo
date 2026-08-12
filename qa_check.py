"""Controles de calidad que corren antes de publicar.

Sale con codigo 1 si algo critico falla, para que refresh.ps1 no publique
un dashboard con datos malos. Los avisos no bloquean.
"""
import sys, os, json, datetime as dt

sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))

PATH = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'data', 'seguimiento.json')
if not os.path.exists(PATH):
    print(f'FALLA: no existe {PATH}'); sys.exit(1)

D = json.load(open(PATH, encoding='utf-8'))
meta, brands, M = D['meta'], D['brands'], D['meta']['meses']
METRICS = meta['metricas']

fallas, avisos = [], []


def check(nombre, ok, detalle='', critico=True):
    print(f"  [{'OK ' if ok else 'X  '}] {nombre}" + (f'  — {detalle}' if detalle else ''))
    if not ok:
        (fallas if critico else avisos).append(f'{nombre}: {detalle}')


def col(m, i):
    return sum((b[m][i] or 0) for b in brands)


print('CONTROLES DE CALIDAD · Seguimiento Equipo')
print('=' * 66)

# --- estructura ---
check('Hay marcas', len(brands) > 0, f'{len(brands)} series')
check('Llave unica marca x canal x KAM',
      len({(b['kam'], b['marca'], b['canal']) for b in brands}) == len(brands))
check('Todas las series cubren los mismos meses',
      all(len(b[m]) == len(M) for b in brands for m in METRICS))
check('Ventana historica completa', len(M) >= 24, f'{len(M)} meses')
check('Sin meses faltantes en la ventana',
      all((dt.date.fromisoformat(M[i + 1]).year * 12 + dt.date.fromisoformat(M[i + 1]).month)
          - (dt.date.fromisoformat(M[i]).year * 12 + dt.date.fromisoformat(M[i]).month) == 1
          for i in range(len(M) - 1)))

# --- frescura ---
hasta = dt.date.fromisoformat(meta['data_hasta'])
atraso = (dt.date.today() - hasta).days
check('Los datos llegan hasta hace pocos dias', atraso <= 5,
      f'ultimo dia con datos {hasta} ({atraso} dias de atraso)', critico=False)
check('La fuente es Snowflake', meta['fuente'] == 'snowflake',
      f'fuente = {meta["fuente"]}', critico=False)

# --- negocio ---
i = M.index(meta['ultimo_cerrado'])
gmv, ordn = col('gmv', i), col('ord', i)
aov = gmv / ordn if ordn else 0
check('GMV del ultimo mes cerrado > 0', gmv > 0, f'{gmv:,.0f} USD')
check('Ticket promedio en rango creible', 5 <= aov <= 60, f'{aov:.2f} USD')

aovs = [col('gmv', k) / col('ord', k) for k in range(len(M)) if col('ord', k)]
mu = sum(aovs) / len(aovs)
cv = (sum((x - mu) ** 2 for x in aovs) / len(aovs)) ** .5 / mu * 100
check('Ticket promedio estable mes a mes (sin saltos de escala)', cv < 15,
      f'coeficiente de variacion {cv:.1f}% (>15% delata decimales corrompidos)')

neg = [(b['marca'], M[k]) for b in brands for k in range(len(M))
       if b['gmv'][k] is not None and b['gmv'][k] < 0]
check('Sin GMV negativo', not neg, f'{len(neg)} celdas: {neg[:3]}', critico=False)

emb = sum(1 for b in brands for k in range(len(M)) if (b['atc'][k] or 0) > (b['ss'][k] or 0))
check('Embudo consistente (carrito <= visitas)', emb == 0, f'{emb} celdas')

sin_cat = {b['marca'] for b in brands if b['categoria'] == 'Sin categoria'}
check('Todas las marcas tienen categoria', not sin_cat,
      f'{len(sin_cat)} sin categoria', critico=False)

# --- continuidad: el mes cerrado no puede desplomarse sin aviso ---
if i >= 3:
    prom = sum(col('gmv', k) for k in range(i - 3, i)) / 3
    r = gmv / prom if prom else 0
    check('El ultimo mes cerrado es consistente con los 3 previos', 0.6 <= r <= 1.6,
          f'{r * 100:.0f}% del promedio previo', critico=False)

print('=' * 66)
if avisos:
    print(f'\n{len(avisos)} aviso(s):')
    for a in avisos:
        print('  -', a)
if fallas:
    print(f'\n{len(fallas)} FALLA(S) CRITICA(S) — no se debe publicar:')
    for f in fallas:
        print('  -', f)
    sys.exit(1)

print(f'\nTodo en orden. Datos hasta {meta["data_hasta"]}, '
      f'ultimo mes cerrado {meta["ultimo_cerrado"]}, {len(brands)} cuentas.')
sys.exit(0)
