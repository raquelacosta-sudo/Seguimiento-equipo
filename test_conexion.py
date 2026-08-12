"""Prueba rapida de la conexion a Snowflake. Util cuando refresh.ps1 falla."""
import sys
sys.stdout.reconfigure(encoding='utf-8')
try:
    import snowflake.connector as sc
    c = sc.connect(user='raquel.acosta@rappi.com', account='hg51401',
                   authenticator='externalbrowser',
                   client_store_temporary_credential=True, login_timeout=60)
    cur = c.cursor()
    cur.execute('USE WAREHOUSE RP_PERSONALUSER_WH')
    u, w = cur.execute('SELECT CURRENT_USER(), CURRENT_WAREHOUSE()').fetchone()
    print(f'CONECTA OK  usuario={u}  warehouse={w}')
    c.close()
except Exception as e:
    msg = str(e)
    print('NO CONECTA:', msg[:260])
    if 'is not allowed to access' in msg:
        print('\n  -> Es la lista blanca de IPs de Snowflake: estas fuera de la red '
              'de Rappi. Conectate a la VPN y vuelve a intentar.')
    elif 'authenticator' in msg or '404' in msg:
        print('\n  -> Parece problema de identificador de cuenta o del login SSO.')
    sys.exit(1)
