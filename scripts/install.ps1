[CmdletBinding()]
param(
    [string]$SkillSource,
    [string]$SkillsRoot = (Join-Path $env:USERPROFILE '.agents\skills'),
    [string]$GlobalAgentsFile = (Join-Path $env:USERPROFILE '.codex\AGENTS.md')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Resolve this after binding because Windows PowerShell 5.1 can bind an empty $PSScriptRoot in defaults.
if ([string]::IsNullOrWhiteSpace($SkillSource)) {
    $scriptPath = $MyInvocation.MyCommand.Path
    if ([string]::IsNullOrWhiteSpace($scriptPath)) {
        throw 'Cannot determine the installer script path; provide -SkillSource explicitly'
    }

    $scriptsDirectory = Split-Path -Parent $scriptPath
    $SkillSource = Split-Path -Parent $scriptsDirectory
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$strictUtf8NoBom = New-Object System.Text.UTF8Encoding($false, $true)
$skillFile = Join-Path $SkillSource 'SKILL.md'
$metadataFile = Join-Path $SkillSource 'agents\openai.yaml'

function Assert-Utf8WithoutBom {
    param([string]$Path)

    $bytes = [IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        throw "Source file must use UTF-8 without BOM: $Path"
    }
    [void]$script:strictUtf8NoBom.GetString($bytes)
}

foreach ($sourceFile in @($skillFile, $metadataFile)) {
    if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
        throw "Missing source file: $sourceFile"
    }
    Assert-Utf8WithoutBom -Path $sourceFile
}

$startMarker = '<!-- chinese-code-comments:start -->'
$endMarker = '<!-- chinese-code-comments:end -->'
$current = if (Test-Path -LiteralPath $GlobalAgentsFile -PathType Leaf) {
    [IO.File]::ReadAllText($GlobalAgentsFile, $strictUtf8NoBom)
} else {
    ''
}

# Validate the managed block before creating any installation side effects.
$startCount = [regex]::Matches($current, [regex]::Escape($startMarker)).Count
$endCount = [regex]::Matches($current, [regex]::Escape($endMarker)).Count
if (($startCount -eq 0) -xor ($endCount -eq 0)) {
    throw 'Global AGENTS.md contains an incomplete chinese-code-comments block'
}
if ($startCount -gt 1 -or $endCount -gt 1) {
    throw 'Global AGENTS.md contains duplicate chinese-code-comments markers'
}

$startIndex = $current.IndexOf($startMarker, [StringComparison]::Ordinal)
$endIndex = $current.IndexOf($endMarker, [StringComparison]::Ordinal)
if ($startCount -eq 1 -and $endIndex -lt $startIndex) {
    throw 'Global AGENTS.md contains chinese-code-comments markers in the wrong order'
}

# Base64 preserves Chinese policy text in no-BOM Windows PowerShell 5.1 scripts.
$managedBlockBase64 = 'PCEtLSBjaGluZXNlLWNvZGUtY29tbWVudHM6c3RhcnQgLS0+CiMjIEdsb2JhbCBDb2RlIENvbW1lbnQgUG9saWN5CgotIOWIm+W7uuOAgeS/ruaUueOAgemHjeaehOOAgeS/ruWkjeaIluWuoeafpeS7o+eggeaXtu+8jOW/hemhu+WcqOWunueOsOi/h+eoi+S4reiusOW9leaciee7tOaKpOS7t+WAvOeahOWFs+mUruaEj+Wbvu+8jOW5tuWcqOe7k+adn+WJjeaYvuW8j+S9v+eUqCBgJGNoaW5lc2UtY29kZS1jb21tZW50c2Ag5a+55a6M5pW0IGRpZmYg5omn6KGM5a6h5p+l44CCCi0g5YWI6ZSB5a6a5qih5byP77yaYEdST1VQRURgIOeUqOS6jueUqOaIt+WPquivtOKAnOmAkOihjOKAneaIluKAnOmAkOihjOazqOmHiuKAneeahOivt+axgu+8m2BTVFJJQ1RgIOW9k+S4lOS7heW9k+eUqOaIt+aYjuehruimgeaxguKAnOavj+ihjOmDveimgeKAneKAnOS4gOihjOS4gOazqOKAneKAnOavj+adoeWPr+aJp+ihjOivreWPpeKAneaIluetieS7t+WFqOensOe6puadn+OAggotIOm7mOiupOazqOmHiuivreiogOS4uueugOS9k+S4reaWh++8m+eUqOaIt+aYjuehruaMh+WumuivreiogOaIlumhueebruWwsei/keinhOiMg+aXtuaMieWFtuimgeaxguOAggotIOm7mOiupOWPquazqOmHiuS4muWKoeaEj+WbvuOAgee6puadn+OAgei+ueeVjOOAgeW8guW4uOOAgeW5tuWPkeOAgei1hOa6kOeuoeeQhuOAgeWFvOWuueaAp+WSjOmdnuebtOinguWunueOsO+8m+eUqOaIt+WPr+aMh+WumuWFtuS7luWfuuWHhuaIlueykuW6puOAggotIOS/neeVmeWHhuehrueahOeOsOacieazqOmHiuWPiuWFtuivreiogO+8m+WPquacieazqOmHiuWboOS7o+eggeaUueWKqOWkseecn+OAgemUmeivr+aIluWGsueqgeaXtuaJjeabtOaWsOOAggotIOWNs+S9v+aXoOmcgOaWsOWinuazqOmHiu+8jOS5n+W/hemhu+WcqOacgOe7iOWbnuWkjeS4reaKpeWRiuW3suWujOaIkOazqOmHiuWuoeafpeOAggo8IS0tIGNoaW5lc2UtY29kZS1jb21tZW50czplbmQgLS0+'
$managedBlock = $utf8NoBom.GetString([Convert]::FromBase64String($managedBlockBase64)).Trim()
$managedBlock = [regex]::Replace($managedBlock, "`r?`n", "`r`n")

if ($startCount -eq 1) {
    $afterBlock = $endIndex + $endMarker.Length
    $next = $current.Substring(0, $startIndex) + $managedBlock + $current.Substring($afterBlock)
} else {
    $trimmedCurrent = $current.TrimEnd([char[]]@("`r", "`n"))
    $separator = if ([string]::IsNullOrWhiteSpace($trimmedCurrent)) { '' } else { "`r`n`r`n" }
    $next = $trimmedCurrent + $separator + $managedBlock + "`r`n"
}

$destination = Join-Path $SkillsRoot 'chinese-code-comments'
$destinationAgents = Join-Path $destination 'agents'
$agentsParent = Split-Path -Parent $GlobalAgentsFile
if (-not [string]::IsNullOrWhiteSpace($agentsParent)) {
    New-Item -ItemType Directory -Path $agentsParent -Force | Out-Null
}
New-Item -ItemType Directory -Path $destinationAgents -Force | Out-Null
Copy-Item -LiteralPath $skillFile -Destination (Join-Path $destination 'SKILL.md') -Force
Copy-Item -LiteralPath $metadataFile -Destination (Join-Path $destinationAgents 'openai.yaml') -Force
[IO.File]::WriteAllText($GlobalAgentsFile, $next, $utf8NoBom)

Write-Host "Installed skill: $destination"
Write-Host "Updated global instructions: $GlobalAgentsFile"
