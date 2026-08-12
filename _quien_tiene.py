import sys, snowflake.connector
sys.stdout.reconfigure(encoding='utf-8')

c = snowflake.connector.connect(user='raquel.acosta@rappi.com', account='hg51401',
                                authenticator='externalbrowser',
                                client_store_temporary_credential=True)
cur = c.cursor()
cur.execute('USE WAREHOUSE RP_PERSONALUSER_WH')

NORM = """INITCAP(LOWER(TRIM(TRANSLATE(
  REGEXP_REPLACE(REGEXP_REPLACE(BRAND_NAME, '\\\\s*-?\\\\s*[Tt][Uu][Rr][Bb][Oo]\\\\s*$', ''),
    '\\\\s*-?\\\\s*[Tt][Bb][Oo]\\\\s*$', ''),
  'áéíóúÁÉÍÓÚüÜñÑ', 'aeiouAEIOUuUnN'))))"""

SALIERON = ["Carl's Jr.", 'Green Grass', 'Bobo Burgers', 'Bisquets Obregon', 'Pollos Ray',
            'Bobo Cafe', 'Mora Mora', 'Taco Naco', 'Pizza Maestra', 'Alitas Maestras',
            'Los Chilakos', 'Daruma', 'Sushi Zen', 'Hamburguesas Al Carbon']
lista = ', '.join("'" + m.replace("'", "''") + "'" for m in SALIERON)

print('=== QUIEN TIENE HOY LAS MARCAS QUE SALIERON ===')
cur.execute(f"""
SELECT {NORM} AS marca, ANY_VALUE(BRAND_OWNER_LEADER) AS lider,
       ANY_VALUE(BRAND_OWNER_NAME) AS kam
FROM RP_GOLD_DB_PROD.RESTAURANTES_GLOBAL_MDA.A_SCORECARD_REST4
WHERE COUNTRY = 'MX' AND {NORM} IN ({lista})
GROUP BY 1 ORDER BY 1""")
for m, lider, kam in cur.fetchall():
    print(f'  {m[:32]:32s} lider={str(lider)[:34]:34s} kam={kam}')

print('\n=== CARTERA ACTUAL DE RAQUEL, POR KAM ===')
cur.execute(f"""
SELECT BRAND_OWNER_NAME AS kam, COUNT(DISTINCT {NORM}) AS marcas
FROM RP_GOLD_DB_PROD.RESTAURANTES_GLOBAL_MDA.A_SCORECARD_REST4
WHERE COUNTRY = 'MX' AND BRAND_OWNER_LEADER = 'raquel.acosta@rappi.com'
GROUP BY 1 ORDER BY 2 DESC""")
for kam, n in cur.fetchall():
    print(f'  {kam:24s} {n:3d}')

print('\n=== MARCAS QUE TENIA MARIA SANGABRIEL: quien las tiene ahora ===')
cur.execute(f"""
SELECT ANY_VALUE(BRAND_OWNER_LEADER) AS lider, ANY_VALUE(BRAND_OWNER_NAME) AS kam,
       COUNT(DISTINCT {NORM}) AS marcas
FROM RP_GOLD_DB_PROD.RESTAURANTES_GLOBAL_MDA.A_SCORECARD_REST4
WHERE COUNTRY = 'MX' AND {NORM} IN (
  'Chubbies Burger','Frutos Prohibidos','Fat Bastard.','Arrachera House',
  'Cocina Abierta','Miyagi Bowls','Chilaquiles El Chilin','Brass Monkey')
GROUP BY BRAND_OWNER_LEADER, BRAND_OWNER_NAME ORDER BY 3 DESC""")
for lider, kam, n in cur.fetchall():
    print(f'  lider={str(lider)[:36]:36s} kam={str(kam)[:22]:22s} {n} marcas')

c.close()
