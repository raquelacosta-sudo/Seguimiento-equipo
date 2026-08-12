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
param([switch]$NoPush, [switch]$Forzar)

$ErrorActionPreference = 'Stop'
$HERE = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $HERE

$PY = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $PY) { Write-Host "No encuentro python en el PATH." -ForegroundColor Red; exit 1 }

function Paso($n, $t) { Write-Host "`n[$n] $t" -ForegroundColor Cyan }

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "  SEGUIMIENTO EQUIPO - actualizacion" -ForegroundColor Cyan
Write-Host "  $(Get-Date -Format 'dddd dd/MM/yyyy HH:mm:ss')" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan

# Se genera a un archivo aparte y solo se reemplaza el bueno si pasa el QA.
# Asi una corrida fallida nunca destruye el ultimo snapshot valido.
$BUENO   = Join-Path $HERE "data\seguimiento.json"
$CANDIDATO = Join-Path $HERE "data\_candidato.json"

# Si ya esta al dia no se hace nada. Esto permite programar varios intentos en
# el dia (por si el primero cae fuera de la VPN) sin trabajo repetido.
if (-not $Forzar -and (Test-Path $BUENO)) {
  $actual = (Get-Content $BUENO -Raw | ConvertFrom-Json).meta.data_hasta
  $atraso = (New-TimeSpan -Start ([datetime]$actual) -End (Get-Date)).Days
  if ($atraso -le 2) {
    Write-Host "Ya esta al dia (datos hasta $actual). No hay nada que hacer." -ForegroundColor Green
    Write-Host "Para regenerar de todos modos:  .\refresh.ps1 -Forzar"
    exit 0
  }
}

# --- 1. datos -------------------------------------------------------
Paso 1 "Bajando datos de Snowflake..."
& $PY build_data.py --salida $CANDIDATO
if ($LASTEXITCODE -ne 0) {
  Write-Host "`nNo se pudieron bajar datos nuevos. El dashboard sigue con los anteriores." -ForegroundColor Red
  Remove-Item $CANDIDATO -ErrorAction SilentlyContinue
  exit 1
}

# --- 2. QA ----------------------------------------------------------
Paso 2 "Controles de calidad..."
& $PY qa_check.py $CANDIDATO
if ($LASTEXITCODE -ne 0) {
  Write-Host "`nLos controles de calidad NO pasaron. No se publica." -ForegroundColor Red
  Write-Host "El dashboard sigue mostrando los datos anteriores, que si eran validos." -ForegroundColor Yellow
  Remove-Item $CANDIDATO -ErrorAction SilentlyContinue
  exit 1
}
Move-Item $CANDIDATO $BUENO -Force

if ($NoPush) { Write-Host "`nListo (sin publicar, -NoPush)." -ForegroundColor Green; exit 0 }

# --- 3. publicar ----------------------------------------------------
Paso 3 "Publicando en GitHub Pages..."
$meta  = Get-Content "data\seguimiento.json" -Raw | ConvertFrom-Json
$hasta = $meta.meta.data_hasta
$msg   = "Datos al $hasta (fuente: $($meta.meta.fuente))"

# git escribe avisos por stderr; con ErrorActionPreference='Stop' eso aborta el
# script cuando corre como tarea programada. Aqui se toleran.
$previo = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
git add -A
if (git status --porcelain) {
  git -c user.name="Raquel Acosta" -c user.email="raquel.acosta@rappi.com" commit -q -m $msg
}
$ErrorActionPreference = $previo

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
