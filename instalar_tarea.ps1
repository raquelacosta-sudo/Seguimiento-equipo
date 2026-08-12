# =====================================================================
#  Programa la actualizacion automatica del dashboard.
#  Por defecto: todos los lunes a las 7:30 am (antes de la junta).
#
#  Instalar:    powershell -ExecutionPolicy Bypass -File instalar_tarea.ps1
#  Otro dia:    ... -Dia Miercoles -Hora 08:00
#  Diario:      ... -Diario
#  Quitar:      ... -Quitar
# =====================================================================
param(
  [string]$Dia  = 'Monday',
  [string]$Hora = '07:30',
  [switch]$Diario,
  [switch]$Quitar
)

$ErrorActionPreference = 'Stop'
$HERE = Split-Path -Parent $MyInvocation.MyCommand.Path
$NOMBRE = 'Seguimiento Equipo - actualizar dashboard'

if ($Quitar) {
  Unregister-ScheduledTask -TaskName $NOMBRE -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Tarea eliminada." -ForegroundColor Yellow
  exit 0
}

# Con -File, todo lo que va despues del script se le pasa como argumento y la
# redireccion nunca ocurre (la bitacora quedaba vacia). Con -Command si se
# interpreta, asi que la salida completa acaba en refresh.log.
$cmd = "& '$HERE\refresh.ps1' *>&1 | Tee-Object -FilePath '$HERE\refresh.log' -Append; exit `$LASTEXITCODE"
$accion = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -Command `"$cmd`"" `
  -WorkingDirectory $HERE

# Tres intentos en el dia. Si el primero cae fuera de la VPN (Snowflake bloquea
# por IP), los siguientes lo recuperan; y si el primero funciono, los demas ven
# los datos al dia y salen sin hacer nada.
$horas = @($Hora, '11:00', '15:00')
$disparador = $horas | ForEach-Object {
  if ($Diario) { New-ScheduledTaskTrigger -Daily -At $_ }
  else { New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Dia -At $_ }
}

$ajustes = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
  -MultipleInstances IgnoreNew

Unregister-ScheduledTask -TaskName $NOMBRE -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $NOMBRE -Action $accion -Trigger $disparador `
  -Settings $ajustes -Description 'Baja datos de Snowflake, corre QA y publica el dashboard Seguimiento Equipo.' | Out-Null

$cuando = if ($Diario) { "todos los dias" } else { "los $Dia" }
Write-Host "Tarea programada: $cuando a las $($horas -join ', ')." -ForegroundColor Green
Write-Host "  (el 2o y 3er intento solo actuan si el 1o no pudo)" -ForegroundColor DarkGray
Write-Host "Bitacora: $HERE\refresh.log"
Write-Host "Para quitarla:  powershell -ExecutionPolicy Bypass -File instalar_tarea.ps1 -Quitar"
Write-Host ""
Write-Host "Nota: si la sesion de Snowflake caduco, la tarea abrira el navegador" -ForegroundColor Yellow
Write-Host "para el login SSO. Si la maquina esta apagada a esa hora, corre al encender." -ForegroundColor Yellow
