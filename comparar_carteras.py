"""Compara la cartera del snapshot actual contra la de un snapshot anterior.

Sirve para explicar por que un mes ya cerrado cambia de valor entre una
actualizacion y otra: la cartera se define con BRAND_OWNER_LEADER de HOY y se
aplica a toda la historia, asi que si una marca cambia de duenno desaparece
tambien de los meses pasados.

Uso:  python comparar_carteras.py <commit_anterior>
      (por defecto compara contra el commit anterior de data/seguimiento.json)
"""
import sys, os, json, subprocess
from collections import defaultdict

sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
ACTUAL = os.path.join(HERE, 'data', 'seguimiento.json')


def git(*a):
    r = subprocess.run(['git', '-C', HERE, *a], capture_output=True)
    return r.stdout


def snapshot_anterior(commit=None):
    if not commit:
        log = git('log', '--format=%H', '-n', '6', '--', 'data/seguimiento.json')
        commits = log.decode().split()
        if len(commits) < 2:
            sys.exit('No hay un snapshot anterior en el historial de git.')
        commit = commits[1]
    raw = git('show', f'{commit}:data/seguimiento.json')
    if not raw:
        sys.exit(f'No pude leer data/seguimiento.json en {commit}')
    return commit, json.loads(raw.decode('utf-8'))


def resumen(D):
    idx = {m: i for i, m in enumerate(D['meta']['meses'])}
    marcas = {}
    for b in D['brands']:
        marcas.setdefault(b['marca'], {'kam': b['kam'], 'gmv': 0})
    return idx, marcas


def gmv_mes(D, mes):
    if mes not in D['meta']['meses']:
        return None, {}
    i = D['meta']['meses'].index(mes)
    tot, por_marca = 0, defaultdict(float)
    for b in D['brands']:
        v = b['gmv'][i] or 0
        tot += v
        por_marca[b['marca']] += v
    return tot, por_marca


commit = sys.argv[1] if len(sys.argv) > 1 else None
sha, ANT = snapshot_anterior(commit)
ACT = json.load(open(ACTUAL, encoding='utf-8'))

print('COMPARACION DE CARTERAS')
print('=' * 70)
print(f"anterior : {ANT['meta']['generated_at']}  (commit {sha[:8]})  "
      f"{len(ANT['brands'])} series")
print(f"actual   : {ACT['meta']['generated_at']}   {len(ACT['brands'])} series")

ma = {b['marca'] for b in ANT['brands']}
mn = {b['marca'] for b in ACT['brands']}
salieron, entraron = sorted(ma - mn), sorted(mn - ma)

print(f'\nmarcas antes: {len(ma)}   ahora: {len(mn)}   '
      f'salieron: {len(salieron)}   entraron: {len(entraron)}')

# mes cerrado comun para medir el efecto
mes = ACT['meta']['ultimo_cerrado']
ta, pa = gmv_mes(ANT, mes)
tn, pn = gmv_mes(ACT, mes)
if ta and tn:
    print(f'\nGMV de {mes} segun cada snapshot:')
    print(f'  antes : {ta:>14,.0f}')
    print(f'  ahora : {tn:>14,.0f}   ({(tn/ta-1)*100:+.1f}%)')
    perdido = sum(pa[m] for m in salieron)
    print(f'\n  de esa diferencia, {perdido:,.0f} USD son marcas que salieron de la cartera')
    print(f'  ({perdido/(ta-tn)*100:.0f}% del cambio)' if ta != tn else '')

if salieron:
    print(f'\nMARCAS QUE SALIERON ({len(salieron)}) — ordenadas por GMV de {mes}:')
    for m in sorted(salieron, key=lambda x: -pa.get(x, 0)):
        kam = next(b['kam'] for b in ANT['brands'] if b['marca'] == m)
        print(f'  {m[:34]:34s} {kam[:16]:16s} {pa.get(m, 0):>12,.0f}')
if entraron:
    print(f'\nMARCAS QUE ENTRARON ({len(entraron)}):')
    for m in sorted(entraron, key=lambda x: -pn.get(x, 0)):
        kam = next(b['kam'] for b in ACT['brands'] if b['marca'] == m)
        print(f'  {m[:34]:34s} {kam[:16]:16s} {pn.get(m, 0):>12,.0f}')

print('\nPor KAM:')
ka = defaultdict(int); kn = defaultdict(int)
for b in ANT['brands']:
    ka[b['kam']] += 1
for b in ACT['brands']:
    kn[b['kam']] += 1
for k in sorted(set(ka) | set(kn)):
    d = kn[k] - ka[k]
    print(f'  {k:22s} {ka[k]:3d} -> {kn[k]:3d}   {d:+d}')
