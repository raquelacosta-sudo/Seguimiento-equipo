"""Publica los archivos del dashboard en GitHub via Git Data API.

Sube en un solo commit todo lo que git tenga versionado y que difiera de lo que
hay en el repo remoto. No necesita credenciales de git: usa el token de
.github_token (o la variable de entorno GITHUB_TOKEN).

Uso:  python publish.py ["mensaje del commit"]
"""
import sys, os, json, base64, subprocess, urllib.request, urllib.error

sys.stdout.reconfigure(encoding='utf-8')

HERE = os.path.dirname(os.path.abspath(__file__))
OWNER, REPO, BRANCH = 'raquelacosta-sudo', 'Seguimiento-equipo', 'main'
API = f'https://api.github.com/repos/{OWNER}/{REPO}'


def token():
    t = os.environ.get('GITHUB_TOKEN')
    if t:
        return t.strip()
    p = os.path.join(HERE, '.github_token')
    if os.path.exists(p):
        return open(p, encoding='utf-8').read().strip()
    sys.exit('No hay token. Pon uno en .github_token o en la variable GITHUB_TOKEN.')


TOKEN = token()


def api(path, body=None, method=None):
    req = urllib.request.Request(
        API + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method or ('POST' if body is not None else 'GET'),
        headers={'Authorization': f'token {TOKEN}',
                 'Accept': 'application/vnd.github+json',
                 'User-Agent': 'seguimiento-equipo',
                 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        sys.exit(f'GitHub respondio {e.code} en {path}: {e.read().decode()[:300]}')


def git(*args):
    return subprocess.run(['git', '-C', HERE, *args], capture_output=True,
                          text=True, encoding='utf-8').stdout


def main():
    msg = sys.argv[1] if len(sys.argv) > 1 else 'Actualizacion del dashboard'

    archivos = [f for f in git('ls-files').splitlines() if f.strip()]
    if not archivos:
        sys.exit('No hay archivos versionados. Corre git add primero.')

    print(f'Publicando en {OWNER}/{REPO} ({BRANCH})')
    ref = api(f'/git/ref/heads/{BRANCH}')
    padre = ref['object']['sha']
    base_tree = api(f'/git/commits/{padre}')['tree']['sha']
    print(f'  commit remoto actual: {padre[:8]}')

    # Compara contra el arbol remoto para subir solo lo que cambio.
    remoto = {n['path']: n['sha'] for n in
              api(f'/git/trees/{base_tree}?recursive=1')['tree'] if n['type'] == 'blob'}

    tree, subidos = [], 0
    for f in archivos:
        ruta = os.path.join(HERE, f.replace('/', os.sep))
        if not os.path.exists(ruta):
            continue
        datos = open(ruta, 'rb').read()
        local_sha = git('hash-object', f).strip()
        if remoto.get(f) == local_sha:
            continue
        blob = api('/git/blobs', {'content': base64.b64encode(datos).decode(),
                                  'encoding': 'base64'})
        tree.append({'path': f, 'mode': '100644', 'type': 'blob', 'sha': blob['sha']})
        subidos += 1
        print(f'  + {f}  ({len(datos)/1024:.0f} KB)')

    # Lo que existe en el repo remoto pero ya no esta versionado localmente se borra.
    for f in remoto:
        if f not in archivos:
            tree.append({'path': f, 'mode': '100644', 'type': 'blob', 'sha': None})
            print(f'  - {f}  (se elimina del repo)')

    if not tree:
        print('\nNo hay cambios que publicar: el repo ya esta al dia.')
        return

    nuevo_tree = api('/git/trees', {'base_tree': base_tree, 'tree': tree})
    commit = api('/git/commits', {'message': msg, 'tree': nuevo_tree['sha'],
                                  'parents': [padre]})
    api(f'/git/refs/heads/{BRANCH}', {'sha': commit['sha'], 'force': False}, method='PATCH')

    print(f'\nListo: {subidos} archivo(s) en el commit {commit["sha"][:8]}')
    print(f'  https://raquelacosta-sudo.github.io/{REPO}/')
    print('  GitHub Pages tarda ~1 minuto en reflejarlo.')


if __name__ == '__main__':
    main()
