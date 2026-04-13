param(
  [Parameter(Mandatory = $true)]
  [string]$StoreJson
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$store = Get-Content -Raw -Path $StoreJson | ConvertFrom-Json

foreach ($batch in @($store.imports)) {
  foreach ($row in @($batch.rows)) {
    if (-not ($row.PSObject.Properties.Name -contains "linkedVisitId")) {
      continue
    }

    $visit = $store.visits | Where-Object { $_.id -eq $row.linkedVisitId } | Select-Object -First 1
    if (-not $visit) {
      continue
    }

    $visit.patientName = $row.patientName
    $visit.dateLabel = $row.dateLabel
    $visit.time = if ($row.PSObject.Properties.Name -contains "time" -and $row.time) { $row.time } else { $visit.time }

    if ($row.PSObject.Properties.Name -contains "serviceName") {
      if ($visit.PSObject.Properties.Name -contains "serviceName") {
        $visit.serviceName = $row.serviceName
      } else {
        $visit | Add-Member -NotePropertyName serviceName -NotePropertyValue $row.serviceName
      }
    }
  }
}

$store.meta.lastUpdated = (Get-Date).ToString("yyyy-MM-dd HH:mm")
$json = $store | ConvertTo-Json -Depth 100
[System.IO.File]::WriteAllText($StoreJson, $json, [System.Text.UTF8Encoding]::new($false))

Write-Output "Linked visits repaired"
