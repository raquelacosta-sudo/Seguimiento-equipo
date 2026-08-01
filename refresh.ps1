# =====================================================================
#  Actualiza el dashboard "Seguimiento Equipo" y lo publica.
#    1. Baja datos frescos de Snowflake  -> data/seguimiento.json
#    2. Corre los controles de calidad
#    3. Sube los cambios a GitHub Pages
#
#  Uso:  clic derecho -> "Ejecutar con PowerShell"
#        o:  powershell -ExecutionPolicy Bypass -File refresh.ps1
#        parámetros:  -NoPush   (solo regenera, no publica)
# =====================================================================
param([switch]$NoPush)

$ErrorActionPreference = 'Stop'
$HERE = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $HERE

$PY = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $PY) { Write-Host "No encuentro python en el PATH." -ForegroundColor Red; exit 1 }

function Paso($n, $t) { Write-Host "`n[$n] $t" -ForegroundColor Cyan }

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "  SEGUIMIENTO EQUIPO - actualizacion" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan

# --- 1. datos -------------------------------------------------------
Paso 1 "Bajando datos de Snowflake..."
& $PY build_data.py
if ($LASTEXITCODE -ne 0) { Write-Host "Fallo la generacion de datos." -ForegroundColor Red; exit 1 }

# --- 2. QA ----------------------------------------------------------
Paso 2 "Controles de calidad..."
& $PY qa_check.py
if ($LASTEXITCODE -ne 0) {
  Write-Host "`nLos controles de calidad NO pasaron. No se publica." -ForegroundColor Red
  Write-Host "Revisa el detalle de arriba y vuelve a correr." -ForegroundColor Yellow
  exit 1
}

if ($NoPush) { Write-Host "`nListo (sin publicar, -NoPush)." -ForegroundColor Green; exit 0 }

# --- 3. publicar ----------------------------------------------------
Paso 3 "Publicando en GitHub Pages..."
$meta  = Get-Content "data\seguimiento.json" -Raw | ConvertFrom-Json
$hasta = $meta.meta.data_hasta
$msg   = "Datos al $hasta (fuente: $($meta.meta.fuente))"

git add -A
if (git status --porcelain) {
  git -c user.name="Raquel Acosta" -c user.email="raquel.acosta@rappi.com" commit -q -m $msg
}

# Se publica con el token de .github_token via la API de GitHub, para no
# depender de que git tenga credenciales guardadas.
& $PY publish.py $msg
if ($LASTEXITCODE -ne 0) {
  Write-Host "`nNo se pudo publicar. El commit local ya quedo hecho." -ForegroundColor Red
  Write-Host "Si el token expiro, genera uno nuevo y guardalo en .github_token" -ForegroundColor Yellow
  exit 1
}

Write-Host "`n=======================================================" -ForegroundColor Green
Write-Host "  LISTO - datos hasta $hasta" -ForegroundColor Green
Write-Host "  https://raquelacosta-sudo.github.io/Seguimiento-equipo/" -ForegroundColor Green
Write-Host "=======================================================" -ForegroundColor Green
