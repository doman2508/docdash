param(
  [Parameter(Mandatory = $true)]
  [string]$SourceXlsx,

  [Parameter(Mandatory = $true)]
  [string]$StoreJson
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Read-ZipText {
  param(
    [Parameter(Mandatory = $true)]
    [System.IO.Compression.ZipArchive]$Zip,

    [Parameter(Mandatory = $true)]
    [string]$EntryName
  )

  $entry = $Zip.Entries | Where-Object FullName -eq $EntryName
  if (-not $entry) {
    throw "Missing ZIP entry: $EntryName"
  }

  $reader = [System.IO.StreamReader]::new($entry.Open(), [System.Text.Encoding]::UTF8, $true)
  try {
    return $reader.ReadToEnd()
  } finally {
    $reader.Dispose()
  }
}

function Get-CellValue {
  param(
    [Parameter(Mandatory = $true)]
    $Cell,

    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [AllowEmptyString()]
    [string[]]$SharedStrings
  )

  $raw = [string]$Cell.v
  if ($Cell.t -eq "s") {
    return $SharedStrings[[int]$raw]
  }

  return $raw
}

function New-Slug {
  param([string]$Text)

  if ([string]::IsNullOrWhiteSpace($Text)) {
    return "empty"
  }

  $normalized = $Text.ToLowerInvariant()
  $normalized = $normalized -replace "[^a-z0-9]+", "-"
  $normalized = $normalized.Trim("-")
  if ([string]::IsNullOrWhiteSpace($normalized)) {
    return "value"
  }

  return $normalized
}

function Get-HeaderIndex {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Headers,

    [Parameter(Mandatory = $true)]
    [string[]]$Names,

    [int]$Fallback = -1
  )

  for ($i = 0; $i -lt $Headers.Count; $i++) {
    $header = ([string]$Headers[$i]).Trim().ToLowerInvariant()
    foreach ($name in $Names) {
      if ($header -eq $name.ToLowerInvariant()) {
        return $i
      }
    }
  }

  return $Fallback
}

function Get-ValueAt {
  param(
    [Parameter(Mandatory = $true)]
    [object[]]$Values,

    [int]$Index
  )

  if ($Index -lt 0 -or $Index -ge $Values.Count) {
    return ""
  }

  return [string]$Values[$Index]
}

$zip = [System.IO.Compression.ZipFile]::OpenRead($SourceXlsx)
try {
  $sharedXml = [xml](Read-ZipText -Zip $zip -EntryName "xl/sharedStrings.xml")
  $sheetXml = [xml](Read-ZipText -Zip $zip -EntryName "xl/worksheets/sheet1.xml")

  $sharedStrings = @()
  foreach ($si in $sharedXml.sst.si) {
    if ($si.PSObject.Properties.Name -contains "t") {
      $sharedStrings += [string]$si.t
    } elseif ($si.PSObject.Properties.Name -contains "r") {
      $sharedStrings += (($si.r | ForEach-Object { $_.t.'#text' }) -join "")
    } else {
      $sharedStrings += ""
    }
  }

  $headerValues = @()
  $headerRow = $sheetXml.worksheet.sheetData.row | Select-Object -First 1
  foreach ($cell in $headerRow.c) {
    $headerValues += (Get-CellValue -Cell $cell -SharedStrings $sharedStrings)
  }

  $dateIndex = Get-HeaderIndex -Headers $headerValues -Names @("Data") -Fallback 0
  $timeIndex = Get-HeaderIndex -Headers $headerValues -Names @("Godzina", "Czas") -Fallback -1
  $patientIndex = Get-HeaderIndex -Headers $headerValues -Names @("Pacjent") -Fallback $(if ($timeIndex -ge 0) { 2 } else { 1 })
  $serviceIndex = Get-HeaderIndex -Headers $headerValues -Names @("Usługi", "Uslugi", "Usługa", "Usluga") -Fallback $(if ($timeIndex -ge 0) { 3 } else { 2 })
  $amountIndex = Get-HeaderIndex -Headers $headerValues -Names @("Wartość", "Wartosc", "Kwota") -Fallback $(if ($timeIndex -ge 0) { 4 } else { 3 })
  $paymentIndex = Get-HeaderIndex -Headers $headerValues -Names @("Status płatności", "Status platnosci") -Fallback $(if ($timeIndex -ge 0) { 5 } else { 4 })
  $sourceIndex = Get-HeaderIndex -Headers $headerValues -Names @("Źródło", "Zrodlo") -Fallback $(if ($timeIndex -ge 0) { 6 } else { 5 })
  $statusIndex = Get-HeaderIndex -Headers $headerValues -Names @("Status") -Fallback $(if ($timeIndex -ge 0) { 7 } else { 6 })

  $rows = @()
  foreach ($row in $sheetXml.worksheet.sheetData.row) {
    if ([int]$row.r -le 1) {
      continue
    }

    $values = @()
    foreach ($cell in $row.c) {
      $values += (Get-CellValue -Cell $cell -SharedStrings $sharedStrings)
    }

    $dateLabel = Get-ValueAt -Values $values -Index $dateIndex
    $timeLabel = Get-ValueAt -Values $values -Index $timeIndex
    $patientName = Get-ValueAt -Values $values -Index $patientIndex
    $serviceName = Get-ValueAt -Values $values -Index $serviceIndex
    $rawAmount = Get-ValueAt -Values $values -Index $amountIndex
    $paymentStatus = Get-ValueAt -Values $values -Index $paymentIndex
    $source = Get-ValueAt -Values $values -Index $sourceIndex
    $bookingStatus = Get-ValueAt -Values $values -Index $statusIndex

    if ([string]::IsNullOrWhiteSpace($dateLabel) -or [string]::IsNullOrWhiteSpace($patientName)) {
      continue
    }

    $amount = 0
    $normalizedAmount = $rawAmount.Replace(" ", "").Replace(",", ".")
    [void][decimal]::TryParse($normalizedAmount, [System.Globalization.NumberStyles]::Any, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$amount)

    $legacyId = "zl-" + (New-Slug "$dateLabel-$patientName")
    $timeBasedId = $legacyId
    if (-not [string]::IsNullOrWhiteSpace($timeLabel)) {
      $timeBasedId = "zl-" + (New-Slug "$dateLabel-$timeLabel-$patientName")
    }

    $rows += [ordered]@{
      id = $timeBasedId
      legacyId = $legacyId
      time = [string]$timeLabel
      dateLabel = [string]$dateLabel
      patientName = [string]$patientName
      serviceName = [string]$serviceName
      amount = [decimal]$amount
      paymentStatus = [string]$paymentStatus
      source = [string]$source
      bookingStatus = [string]$bookingStatus
      importedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm")
    }
  }

  $store = Get-Content -Raw -Path $StoreJson | ConvertFrom-Json
  if (-not ($store.PSObject.Properties.Name -contains "imports")) {
    $store | Add-Member -NotePropertyName imports -NotePropertyValue @()
  }

  $batchId = "zl-apr-2026"
  $existingBatch = @($store.imports | Where-Object { $_.id -eq $batchId } | Select-Object -First 1)
  $existingRowsById = @{}

  if ($existingBatch) {
    foreach ($existingRow in $existingBatch.rows) {
      $existingRowsById[[string]$existingRow.id] = $existingRow
    }
  }

  $existingVisitIds = @{}
  if ($store.PSObject.Properties.Name -contains "visits") {
    foreach ($visit in $store.visits) {
      $existingVisitIds[[string]$visit.id] = $true
    }
  }

  foreach ($importRow in $rows) {
    $rowId = [string]$importRow["id"]
    $legacyId = [string]$importRow["legacyId"]
    $existingRow = $existingRowsById[$rowId]
    if (-not $existingRow -and $legacyId) {
      $existingRow = $existingRowsById[$legacyId]
      if ($existingRow) {
        $rowId = $legacyId
        $importRow["id"] = $legacyId
      }
    }
    $processed = $false
    $linkedVisitId = $null
    $processedAt = $null

    if ($existingRow) {
      if ($existingRow.PSObject.Properties.Name -contains "processed") {
        $processed = [bool]$existingRow.processed
      }

      if ($existingRow.PSObject.Properties.Name -contains "linkedVisitId") {
        $linkedVisitId = [string]$existingRow.linkedVisitId
      }

      if ($existingRow.PSObject.Properties.Name -contains "processedAt") {
        $processedAt = [string]$existingRow.processedAt
      }
    }

    if (-not $linkedVisitId) {
      $candidateVisitId = "workflow-" + $rowId
      if ($existingVisitIds.ContainsKey($candidateVisitId)) {
        $linkedVisitId = $candidateVisitId
        $processed = $true
      } elseif ($legacyId -and $existingVisitIds.ContainsKey("workflow-" + $legacyId)) {
        $linkedVisitId = "workflow-" + $legacyId
        $processed = $true
        $importRow["id"] = $legacyId
      }
    }

    if ($processed) {
      $importRow["processed"] = $true
    }

    if ($linkedVisitId) {
      $importRow["linkedVisitId"] = $linkedVisitId
    }

    if ($processedAt) {
      $importRow["processedAt"] = $processedAt
    }

    if ($linkedVisitId -and -not [string]::IsNullOrWhiteSpace([string]$importRow["time"])) {
      foreach ($visit in $store.visits) {
        if ([string]$visit.id -eq $linkedVisitId) {
          $visit.time = [string]$importRow["time"]

          if ($visit.PSObject.Properties.Name -contains "serviceName") {
            $visit.serviceName = [string]$importRow["serviceName"]
          } else {
            $visit | Add-Member -NotePropertyName serviceName -NotePropertyValue ([string]$importRow["serviceName"])
          }

          break
        }
      }
    }
  }

  $batch = [ordered]@{
    id = $batchId
    label = "ZnanyLekarz - kwiecien 2026"
    sourceFile = [System.IO.Path]::GetFileName($SourceXlsx)
    importedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm")
    rowCount = $rows.Count
    rows = $rows
  }

  $remaining = @($store.imports | Where-Object { $_.id -ne $batchId })
  $store.imports = @($batch) + $remaining
  $store.meta.lastUpdated = (Get-Date).ToString("yyyy-MM-dd HH:mm")

  $json = $store | ConvertTo-Json -Depth 100
  [System.IO.File]::WriteAllText($StoreJson, $json, [System.Text.UTF8Encoding]::new($false))

  Write-Output ("Imported rows: " + $rows.Count)
} finally {
  $zip.Dispose()
}
