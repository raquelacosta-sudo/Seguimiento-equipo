# Seguimiento Equipo · Restaurantes Rappi MX

Dashboard de seguimiento de la cartera de Raquel Acosta.
**En vivo:** https://raquelacosta-sudo.github.io/Seguimiento-equipo/

Sirve para las juntas de seguimiento con el equipo: ver tendencias, detectar qué cuentas
crecen y cuáles caen, entender por qué, y dejar por escrito los compromisos.

---

## Cómo actualizarlo

```powershell
.\refresh.ps1
```

Eso hace tres cosas: baja datos frescos de Snowflake, corre los controles de calidad y,
si todo pasa, publica en GitHub Pages. Si algún control falla **no publica**.

- `.\refresh.ps1 -NoPush` — solo regenera los datos, sin publicar.
- La primera vez del día Snowflake abre el navegador para el login SSO. Después queda en caché.

---

## De dónde salen los números

**Fuente primaria: Snowflake.**
`RP_SILVER_DB_PROD.RESTAURANTES_RADS.FOLLOW_UP_GROWTH_METRICS_DIMENSIONS`,
cruzada contra `RP_GOLD_DB_PROD.RESTAURANTES_GLOBAL_MDA.A_SCORECARD_REST4`
para quedarse con las marcas donde `BRAND_OWNER_LEADER = raquel.acosta@rappi.com`.

Grano: **marca × canal (regular/turbo) × mes**, 25 meses hacia atrás.
Además se traen los *comparables del mes en curso*: la misma ventana de días del mes
anterior y del año pasado, para que un mes incompleto nunca se lea como caída.

**Fuente de respaldo: el Google Sheet «Seguimiento equipo».**
Si Snowflake no responde, `build_data.py` cae automáticamente al Sheet.

### Ojo con el Google Sheet

El Sheet tiene el idioma configurado en **español de España (`es_ES`)**, donde el separador
decimal es la coma. Aleph escribe los decimales en formato de Estados Unidos (`14343.68`) y
Google Sheets reinterpreta una parte de esas celdas tomando el punto como separador de
miles: `14343.68` se vuelve `1434368`, cien veces más grande.

Medido el 31-jul-2026: **718 celdas** de GMV, markdown, bookings y revenue de ads estaban
infladas. El GMV mensual de la cartera salía hasta **+190% por encima del real** y el ticket
promedio saltaba entre \$19 y \$68 de un mes a otro.

`repair.py` corrige esas celdas cuando se usa el Sheet: para cada celda sospechosa prueba
dividirla entre 1, 10 y 100, y se queda con el valor más cercano a la mediana histórica de
esa marca. Validado contra Snowflake: queda dentro del **1%**.

**La solución de fondo es cambiar el idioma del Sheet** a *Estados Unidos*
(Archivo → Configuración → Configuración regional). A partir del siguiente refresco de
Aleph los decimales entran bien y no hace falta corregir nada.

---

## Archivos

| Archivo | Qué hace |
|---|---|
| `seguimiento-equipo.html` | La página. Es la URL que ya conoce el equipo. |
| `app.js` · `app.css` | Lógica y estilos del tablero. |
| `data/seguimiento.json` | El snapshot de datos que lee la página. |
| `build_data.py` | Snowflake (o el Sheet) → `data/seguimiento.json`. |
| `qa_check.py` | Controles de calidad. Bloquea la publicación si algo falla. |
| `validate.py` | Contrasta el snapshot contra Snowflake, mes a mes y por KAM. |
| `repair.py` | Corrección de decimales para el camino del Sheet. |
| `fetch_raw.py` | Baja las pestañas del Sheet preservando el tipo de cada celda. |
| `qa_report.py` | Diagnóstico detallado del Sheet (útil solo si se usa el respaldo). |
| `refresh.ps1` | Todo lo anterior, en orden, más el publicado. |

---

## Controles de calidad

Corren en cada actualización y se ven también en la pestaña **Datos y QA** del dashboard:

- llave única por marca × canal × KAM, y todas las series con los mismos meses;
- ventana histórica completa y sin meses faltantes;
- los datos llegan hasta hace pocos días;
- GMV positivo y ticket promedio en rango creíble;
- **ticket promedio estable mes a mes** — este es el que detecta los decimales corrompidos:
  con el Sheet sin corregir daba 30.8% de variación, con datos buenos da 5.8%;
- embudo consistente (carrito ≤ visitas);
- todas las marcas con categoría;
- el último mes cerrado no se desploma contra los tres previos.

---

## Cómo leerlo en una junta

1. **Resumen** — cómo cerró el último mes y cómo va el que está corriendo.
   Las alertas de arriba ya dicen qué mirar.
2. **Equipo** — quién está aportando y quién restando. La columna que importa es **Δ abs**
   (dólares), no el porcentaje: una cuenta chica con +300% no mueve la aguja.
3. **Cuentas** — el detalle cuenta por cuenta, con su clasificación automática.
   Empieza por «Mayores caídas en dólares».
4. **Marca** — para entrar a una cuenta concreta. El diagnóstico de arriba separa si la
   caída viene de tráfico, de conversión, de ticket o de tiendas.
5. **Compromisos** — se escribe ahí mismo y se guarda solo en la nube.

### Convenciones

- El **mes en curso** nunca entra en las comparaciones mensuales. Se compara aparte contra
  la misma ventana de días del mes anterior y del año pasado.
- Una **cuenta** es una marca en un canal. Las marcas que operan regular y turbo cuentan dos veces.
- **Estados:** Crece ≥ +10% · Estable entre −5% y +10% · Desacelera −5% a −15% ·
  Cae bajo −15% · Caída sostenida si además el trimestre va a la baja ·
  Dejó de facturar si el mes cerró en cero.

---

## Compromisos

Se guardan en Firebase Realtime Database (`dashboard-comercial-semanal`), en dos espacios:

- `compromisos_v2` — por KAM. Es el mismo de siempre; **no se perdió nada** de lo ya escrito.
- `compromisos_marca_v1` — por cuenta. Nuevo, para las que hoy necesitan plan.

Se guardan solos mientras escribes. Si Firebase no responde, quedan en el navegador y el
recuadro lo avisa.
