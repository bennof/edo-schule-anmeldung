<#
.SYNOPSIS
    Richtet das Anmeldesystem in einem Microsoft-365-Tenant ein (init),
    erneuert das Client-Secret des Servers (refresh) oder entfernt alles
    wieder (remove).

.DESCRIPTION
    init
      - Microsoft-365-Gruppe <Name> mit Teamwebsite; wer das Skript startet, wird Besitzer
      - Listen und Bibliotheken aus sharepoint-schema.json (nur anlegen, nie ändern oder löschen)
      - App-Registrierung "<Name> Sekretariat" (Anmeldung im Sekretariat und in der Desktop-App)
      - App-Registrierung "<Name> Server" mit Client-Secret; Zugriff nur auf die Listen dieser Site
      - Absenderpostfach; der Server darf nur aus diesem Postfach senden (Exchange)
      - <name>.env für den Server, <name>_config.json für das Sekretariat
      Ein zweiter Lauf mit demselben Namen verwendet Vorhandenes weiter.

    refresh
      - neues Client-Secret für "<Name> Server", neue <name>.env
      - Ablaufdatum in der Config-Liste und in <name>_config.json
      - alte Secrets werden erst nach Bestätigung gelöscht

    remove -File <name>_config.json
      - entfernt alles, was init angelegt hat: Exchange-Regeln, beide
        App-Registrierungen, Gruppe mit Site und allen Daten; das Postfach nur auf Nachfrage
      - Gruppe, Apps und Postfach landen im Papierkorb (30 Tage wiederherstellbar)
      - zur Bestätigung muss der Name eingetippt werden; lokale Dateien bleiben

    Anmeldung als Admin mit Gerätecode (auch per SSH). Secrets werden nie
    angezeigt, nur in die .env geschrieben.

.EXAMPLE
    ./setup-tenant.ps1 init
.EXAMPLE
    ./setup-tenant.ps1 refresh -Name "Anmeldung Gymnasium"
.EXAMPLE
    ./setup-tenant.ps1 remove -File ./anmeldung-gymnasium_config.json
#>
#Requires -Version 7.2
[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)]
    [ValidateSet('init', 'refresh', 'remove')]
    [string] $Mode,
    # Name der Site, der Gruppe und Präfix der App-Registrierungen
    [string] $Name,
    # Zielordner für <name>.env und <name>_config.json
    [string] $OutDir = (Get-Location).Path,
    # remove: die <name>_config.json des Systems
    [string] $File,
    [string] $TenantId
)

$ErrorActionPreference = 'Stop'

$GRAPH_APP_ID = '00000003-0000-0000-c000-000000000000'
# immer eingetragen: Desktop-App (Tauri) und Sekretariat lokal
$DEFAULT_REDIRECTS = @('http://localhost:8964', 'http://localhost:8944')
$SECRET_MONTHS = @(24, 12, 6, 3)
# Rechte des Servers je Liste: öffentliche Daten lesen, Eingaben der Familien schreiben
$DAEMON_ROLES = [ordered]@{
    Config       = 'read'
    Assets       = 'read'
    Forms        = 'read'
    Procedures   = 'read'
    Appointments = 'write'
    Applications = 'write'
    Uploads      = 'write'
}

# ---------------------------------------------------------------- helpers

function Write-Step([string] $Text) { Write-Host "`n== $Text" -ForegroundColor Cyan }
function Write-Done([string] $Text) { Write-Host "   $Text" }
function Write-Warn([string] $Text) { Write-Host "   ! $Text" -ForegroundColor Yellow }

function ConvertTo-Slug([string] $Text) {
    $t = $Text.ToLowerInvariant().Replace('ä', 'ae').Replace('ö', 'oe').Replace('ü', 'ue').Replace('ß', 'ss')
    $t = $t.Normalize([Text.NormalizationForm]::FormD) -replace '\p{Mn}', ''
    $t = ($t -replace '[^a-z0-9]+', '-').Trim('-')
    if ($t.Length -gt 40) { $t = $t.Substring(0, 40).Trim('-') }
    $t
}

function ConvertTo-Date($Value) {
    if ($Value -is [datetimeoffset]) { return $Value }
    if ($Value -is [datetime]) { return [datetimeoffset]$Value.ToUniversalTime() }
    [datetimeoffset]::Parse("$Value", [Globalization.CultureInfo]::InvariantCulture)
}

function Format-Day($Value) { (ConvertTo-Date $Value).UtcDateTime.ToString('yyyy-MM-dd') }

function Confirm-Yes([string] $Question) {
    (Read-Host "$Question (j/N)") -match '^(j|ja|y|yes)$'
}

function Initialize-Module([string] $Module) {
    if (-not (Get-Module -ListAvailable -Name $Module)) {
        Write-Done "Installiere PowerShell-Modul $Module (für diesen Benutzer) ..."
        Install-Module $Module -Scope CurrentUser -Force -AllowClobber
    }
    Import-Module $Module
}

function Invoke-Graph([string] $Method, [string] $Path, $Body) {
    $request = @{
        Method = $Method
        Uri    = if ($Path -like 'https://*') { $Path } else { "https://graph.microsoft.com/v1.0$Path" }
    }
    if ($null -ne $Body) {
        $request.Body = ConvertTo-Json $Body -Depth 20 -Compress
        $request.ContentType = 'application/json; charset=utf-8'
    }
    Invoke-MgGraphRequest @request
}

function Get-GraphAll([string] $Path) {
    $all = [Collections.Generic.List[object]]::new()
    $page = Invoke-Graph GET $Path
    while ($true) {
        foreach ($v in $page.value) { $all.Add($v) }
        if (-not $page['@odata.nextLink']) { break }
        $page = Invoke-Graph GET $page['@odata.nextLink']
    }
    $all.ToArray()
}

function Get-GraphOrNull([string] $Path) {
    try { Invoke-Graph GET $Path }
    catch { if ("$_" -match 'NotFound|404') { $null } else { throw } }
}

function Invoke-Retry([scriptblock] $Action, [string] $What, [int] $Tries = 24) {
    for ($i = 1; ; $i++) {
        try { return & $Action }
        catch {
            if ($i -ge $Tries) { throw }
            Write-Done "warte auf $What ..."
            Start-Sleep -Seconds 5
        }
    }
}

function Get-Filter([string] $Expression) { '$filter=' + [uri]::EscapeDataString($Expression) }

function Find-App([string] $DisplayName) {
    $apps = @(Get-GraphAll ("/applications?" + (Get-Filter "displayName eq '$($DisplayName.Replace("'", "''"))'") +
            '&$select=id,appId,displayName,spa,requiredResourceAccess,passwordCredentials'))
    if ($apps.Count -gt 1) { throw "Es gibt mehrere App-Registrierungen mit dem Namen '$DisplayName'." }
    $apps | Select-Object -First 1
}

function Find-Group([string] $Slug) {
    @(Get-GraphAll ("/groups?" + (Get-Filter "mailNickname eq '$Slug'") + '&$select=id,displayName,mail')) | Select-Object -First 1
}

function Get-ServicePrincipalFor([string] $AppId) {
    $sp = @(Get-GraphAll ("/servicePrincipals?" + (Get-Filter "appId eq '$AppId'") + '&$select=id,appId')) | Select-Object -First 1
    if ($sp) { return $sp }
    Invoke-Retry { Invoke-Graph POST '/servicePrincipals' @{ appId = $AppId } } 'die neue App-Registrierung'
}

function Get-GrantedAppIds($Permission) {
    @(
        @($Permission.grantedToIdentitiesV2 | ForEach-Object { $_.application.id })
        @($Permission.grantedToIdentities | ForEach-Object { $_.application.id })
        $Permission.grantedToV2.application.id
        $Permission.grantedTo.application.id
    ) | Where-Object { $_ }
}

function Get-ListIds([string] $SiteId) {
    $ids = @{}
    foreach ($l in Get-GraphAll "/sites/$SiteId/lists?`$select=id,displayName") { $ids[$l.displayName] = $l.id }
    $ids
}

function Get-ConfigItems([string] $SiteId, [string] $ListId) {
    $items = @{}
    foreach ($i in Get-GraphAll "/sites/$SiteId/lists/$ListId/items?`$expand=fields(`$select=Title,Value,IsPublic)&`$top=500") {
        $items[$i.fields.Title] = $i
    }
    $items
}

function Set-ConfigValue([string] $SiteId, [string] $ListId, [hashtable] $Items, [string] $Key, [string] $Value) {
    if ($Items.ContainsKey($Key)) {
        Invoke-Graph PATCH "/sites/$SiteId/lists/$ListId/items/$($Items[$Key].id)/fields" @{ Value = $Value } | Out-Null
    }
    else {
        $Items[$Key] = Invoke-Graph POST "/sites/$SiteId/lists/$ListId/items" @{ fields = @{ Title = $Key; Value = $Value; IsPublic = $false } }
    }
}

function New-DaemonSecret($App) {
    foreach ($months in $SECRET_MONTHS) {
        $body = @{
            passwordCredential = @{
                displayName = "Server $(Get-Date -Format yyyy-MM-dd)"
                endDateTime = (Get-Date).ToUniversalTime().AddMonths($months).ToString('o')
            }
        }
        try {
            $cred = Invoke-Graph POST "/applications/$($App.id)/addPassword" $body
            Write-Done "Client-Secret erzeugt, gültig $months Monate"
            return $cred
        }
        catch {
            if ($months -eq $SECRET_MONTHS[-1]) { throw }
            Write-Warn "$months Monate nicht erlaubt ($($_.Exception.Message.Split("`n")[0])), versuche kürzer"
        }
    }
}

function Write-ServerEnv([string] $Path, $Values, [string] $Expires) {
    $lines = @(
        "# $Name – Server (setup-tenant.ps1, $(Get-Date -Format yyyy-MM-dd))"
        "# Secret gültig bis $Expires; erneuern: ./setup-tenant.ps1 refresh -Name `"$Name`""
        foreach ($k in $Values.Keys) { "$k=$($Values[$k])" }
    )
    Set-Content -Path $Path -Value $lines -Encoding utf8NoBOM
    if ($IsLinux -or $IsMacOS) { chmod 600 $Path }
    Write-Done "geschrieben: $Path"
}

function Write-ClientConfig([string] $Path, $Config) {
    Set-Content -Path $Path -Value (ConvertTo-Json $Config -Depth 5) -Encoding utf8NoBOM
    Write-Done "geschrieben: $Path"
}

# The Exchange module must not share a session with the Graph module
# (conflicting MSAL assemblies), so its steps run as their own pwsh process.
function Invoke-ExchangeScript([string] $Script, $Parameters) {
    $path = Join-Path ([IO.Path]::GetTempPath()) "anmeldung-exchange-$PID.ps1"
    Set-Content -Path $path -Value $Script -Encoding utf8NoBOM
    $arguments = foreach ($k in $Parameters.Keys) { "-$k"; "$($Parameters[$k])" }
    try {
        & (Get-Process -Id $PID).Path -NoProfile -File $path @arguments
        if ($LASTEXITCODE) { throw 'Exchange-Schritt fehlgeschlagen (siehe oben).' }
    }
    finally { Remove-Item $path -ErrorAction SilentlyContinue }
}

$ExchangeSetup = @'
param($AppId, $ServicePrincipalId, $DisplayName, $Mailbox, $ScopeName, $AssignmentName)
$ErrorActionPreference = 'Stop'
function Test-Exists([scriptblock] $Query) { try { [bool](& $Query) } catch { $false } }
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Device -ShowBanner:$false
try {
    if (-not (Test-Exists { Get-EXORecipient -Identity $Mailbox })) {
        $alias = $Mailbox.Split('@')[0]
        New-Mailbox -Shared -Name $alias -Alias $alias -DisplayName $DisplayName -PrimarySmtpAddress $Mailbox | Out-Null
        Write-Host "   freigegebenes Postfach $Mailbox angelegt"
    }
    if (-not (Test-Exists { Get-ServicePrincipal -Identity $AppId })) {
        New-ServicePrincipal -AppId $AppId -ObjectId $ServicePrincipalId -DisplayName $DisplayName | Out-Null
    }
    $filter = "PrimarySmtpAddress -eq '$Mailbox'"
    if (Test-Exists { Get-ManagementScope -Identity $ScopeName }) {
        Set-ManagementScope -Identity $ScopeName -RecipientRestrictionFilter $filter
    }
    else {
        New-ManagementScope -Name $ScopeName -RecipientRestrictionFilter $filter | Out-Null
    }
    if (-not (Test-Exists { Get-ManagementRoleAssignment -Identity $AssignmentName })) {
        New-ManagementRoleAssignment -Name $AssignmentName -App $AppId -Role 'Application Mail.Send' -CustomResourceScope $ScopeName | Out-Null
    }
    $test = Test-ServicePrincipalAuthorization -Identity $AppId -Resource $Mailbox | Where-Object { $_.RoleName -eq 'Application Mail.Send' }
    if ($test.InScope) { Write-Host "   Server darf aus $Mailbox senden" }
    else { Write-Host '   ! Recht noch nicht wirksam (Exchange braucht bis zu 2 Stunden)' -ForegroundColor Yellow }
}
finally {
    Disconnect-ExchangeOnline -Confirm:$false | Out-Null
}
'@

$ExchangeRemove = @'
param($AppId, $Mailbox, $ScopeName, $AssignmentName, $RemoveMailbox)
$ErrorActionPreference = 'Stop'
function Test-Exists([scriptblock] $Query) { try { [bool](& $Query) } catch { $false } }
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Device -ShowBanner:$false
try {
    if (Test-Exists { Get-ManagementRoleAssignment -Identity $AssignmentName }) {
        Remove-ManagementRoleAssignment -Identity $AssignmentName -Confirm:$false
        Write-Host "   Rollenzuweisung $AssignmentName entfernt"
    }
    if (Test-Exists { Get-ManagementScope -Identity $ScopeName }) {
        Remove-ManagementScope -Identity $ScopeName -Confirm:$false
        Write-Host "   Bereich $ScopeName entfernt"
    }
    if ($AppId -ne 'none' -and (Test-Exists { Get-ServicePrincipal -Identity $AppId })) {
        Remove-ServicePrincipal -Identity $AppId -Confirm:$false
        Write-Host '   Server aus Exchange entfernt'
    }
    if ($RemoveMailbox -eq 'yes' -and (Test-Exists { Get-EXOMailbox -Identity $Mailbox })) {
        Remove-Mailbox -Identity $Mailbox -Confirm:$false
        Write-Host "   Postfach $Mailbox gelöscht (30 Tage wiederherstellbar)"
    }
}
finally {
    Disconnect-ExchangeOnline -Confirm:$false | Out-Null
}
'@

# ---------------------------------------------------------------- start

if ($Mode -eq 'remove') {
    if (-not $File) { $File = (Read-Host 'Pfad zur <name>_config.json').Trim() }
    $removeConfig = Get-Content $File -Raw | ConvertFrom-Json -AsHashtable
    if (-not $TenantId) { $TenantId = $removeConfig.tenantId }
}
else {
    if (-not $Name) { $Name = (Read-Host 'Name des Systems (wird Name der Site und der Gruppe)').Trim() }
    $Slug = ConvertTo-Slug $Name
    if ($Slug.Length -lt 3) { throw "Der Name '$Name' ist zu kurz oder enthält keine Buchstaben." }
    $SpaName = "$Name Sekretariat"
    $DaemonName = "$Name Server"
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    $EnvPath = Join-Path $OutDir "$Slug.env"
    $ConfigPath = Join-Path $OutDir "${Slug}_config.json"
}

Write-Step 'PowerShell-Module'
Initialize-Module Microsoft.Graph.Authentication
if ($Mode -ne 'refresh') {
    # only checked here; loaded in its own process
    if (-not (Get-Module -ListAvailable -Name ExchangeOnlineManagement)) {
        Write-Done 'Installiere PowerShell-Modul ExchangeOnlineManagement (für diesen Benutzer) ...'
        Install-Module ExchangeOnlineManagement -Scope CurrentUser -Force -AllowClobber
    }
}

Write-Step 'Anmeldung bei Microsoft Graph (Gerätecode)'
$scopes = if ($Mode -eq 'init') {
    'Application.ReadWrite.All', 'AppRoleAssignment.ReadWrite.All', 'DelegatedPermissionGrant.ReadWrite.All',
    'Group.ReadWrite.All', 'Sites.FullControl.All', 'User.Read'
}
elseif ($Mode -eq 'refresh') { 'Application.ReadWrite.All', 'Group.Read.All', 'Sites.ReadWrite.All', 'User.Read' }
else { 'Application.ReadWrite.All', 'Group.ReadWrite.All', 'Sites.Read.All', 'User.Read' }
$connect = @{ Scopes = $scopes; UseDeviceCode = $true; NoWelcome = $true; ContextScope = 'Process' }
if ($TenantId) { $connect.TenantId = $TenantId }
Connect-MgGraph @connect

$me = Invoke-Graph GET '/me?$select=id,userPrincipalName'
$org = (Invoke-Graph GET '/organization?$select=id,displayName,verifiedDomains').value[0]
$tenant = $org.id
$domain = ($org.verifiedDomains | Where-Object { $_.isDefault } | Select-Object -First 1).name
Write-Done "angemeldet als $($me.userPrincipalName), Tenant $($org.displayName) ($tenant)"

# ---------------------------------------------------------------- remove

if ($Mode -eq 'remove') {
    if ($tenant -ne $removeConfig.tenantId) { throw "Angemeldet im Tenant $tenant, die Datei gehört zu $($removeConfig.tenantId)." }
    $spa = Get-GraphOrNull "/applications(appId='$($removeConfig.clientId)')?`$select=id,appId,displayName"
    if (-not $spa) { throw "App-Registrierung $($removeConfig.clientId) nicht gefunden (schon entfernt?)." }
    if ($spa.displayName -notlike '* Sekretariat') { throw "'$($spa.displayName)' wurde nicht von diesem Skript angelegt; nichts gelöscht." }
    $Name = $spa.displayName.Substring(0, $spa.displayName.Length - ' Sekretariat'.Length)
    $daemon = Find-App "$Name Server"
    $group = Find-Group (ConvertTo-Slug $Name)
    $site = $null
    $mailbox = $null
    if ($group) {
        $site = Get-GraphOrNull "/groups/$($group.id)/sites/root?`$select=id,webUrl"
        if (-not $site -or $site.id -ne $removeConfig.siteId) { throw "Die Site der Gruppe '$($group.displayName)' passt nicht zur Datei; nichts gelöscht." }
        try {
            $lists = Get-ListIds $site.id
            if ($lists.Config) { $mailbox = (Get-ConfigItems $site.id $lists.Config)['mailSender'].fields.Value }
        }
        catch { Write-Warn 'Config-Liste nicht lesbar (kein Zugriff auf die Site?)' }
    }
    if (-not $mailbox) { $mailbox = (Read-Host 'Absenderpostfach des Systems (leer = keins)').Trim() }

    Write-Host @"

Es wird entfernt:
  Exchange           Rollenzuweisung "$Name Mail.Send", Bereich "$Name Absender", Eintrag des Servers
  App-Registrierung  $(if ($daemon) { $daemon.displayName } else { "$Name Server (nicht gefunden)" })
  App-Registrierung  $($spa.displayName)
  Gruppe und Site    $(if ($group) { "$($group.displayName), $($site.webUrl), mit allen Listen, Anmeldungen und Uploads" } else { 'nicht gefunden' })
  Absenderpostfach   $(if ($mailbox) { "$mailbox (Nachfrage folgt)" } else { '-' })
Gruppe, Apps und Postfach sind 30 Tage im Papierkorb wiederherstellbar. Lokale Dateien bleiben.
"@
    if ((Read-Host "Zum Bestätigen den Namen eintippen ($Name)") -cne $Name) {
        Write-Done 'Abgebrochen, nichts gelöscht.'
        return
    }
    $removeMailbox = $mailbox -and (Confirm-Yes "Postfach $mailbox auch löschen? Nur wenn es sonst nicht genutzt wird")

    Write-Step 'Exchange (eigene Anmeldung mit Gerätecode)'
    Invoke-ExchangeScript $ExchangeRemove ([ordered]@{
            AppId          = if ($daemon) { $daemon.appId } else { 'none' }
            Mailbox        = if ($mailbox) { $mailbox } else { 'none' }
            ScopeName      = "$Name Absender"
            AssignmentName = "$Name Mail.Send"
            RemoveMailbox  = if ($removeMailbox) { 'yes' } else { 'no' }
        })

    Write-Step 'App-Registrierungen'
    foreach ($app in @($daemon, $spa) | Where-Object { $_ }) {
        Invoke-Graph DELETE "/applications/$($app.id)" | Out-Null
        Write-Done "$($app.displayName) gelöscht"
    }

    Write-Step 'Gruppe und Site'
    if ($group) {
        Invoke-Graph DELETE "/groups/$($group.id)" | Out-Null
        Write-Done "$($group.displayName) gelöscht, die Site wird mit entfernt"
    }

    Write-Step 'Fertig'
    Write-Done 'Wiederherstellen innerhalb von 30 Tagen: Entra Admin Center, Gruppen > Gelöschte Gruppen'
    Write-Done 'bzw. App-Registrierungen > Gelöschte Anwendungen; Postfach im Exchange Admin Center.'
    return
}

# ---------------------------------------------------------------- refresh

if ($Mode -eq 'refresh') {
    $daemon = Find-App $DaemonName
    if (-not $daemon) { throw "App-Registrierung '$DaemonName' nicht gefunden. Zuerst init ausführen." }
    $group = Find-Group $Slug
    if (-not $group) { throw "Gruppe '$Slug' nicht gefunden." }
    $site = Invoke-Graph GET "/groups/$($group.id)/sites/root?`$select=id,webUrl"
    $old = @($daemon.passwordCredentials | Where-Object { $_ })

    Write-Step "Neues Client-Secret für $DaemonName"
    $cred = New-DaemonSecret $daemon
    $expires = Format-Day $cred.endDateTime
    Write-ServerEnv $EnvPath ([ordered]@{
            TENANT_ID            = $tenant
            DAEMON_CLIENT_ID     = $daemon.appId
            DAEMON_CLIENT_SECRET = $cred.secretText
            SHAREPOINT_ID        = $site.id
        }) $expires
    $cred = $null

    Write-Step 'Ablaufdatum speichern'
    $lists = Get-ListIds $site.id
    $items = Get-ConfigItems $site.id $lists.Config
    Set-ConfigValue $site.id $lists.Config $items 'daemonSecretExpires' $expires
    Write-Done "Config-Liste: daemonSecretExpires = $expires"
    if (Test-Path $ConfigPath) {
        $config = Get-Content $ConfigPath -Raw | ConvertFrom-Json -AsHashtable
        $ordered = [ordered]@{}
        foreach ($k in $config.Keys) { $ordered[$k] = $config[$k] }
        $ordered.daemonSecretExpires = $expires
        Write-ClientConfig $ConfigPath $ordered
    }
    else { Write-Warn "$ConfigPath nicht gefunden, nur die Config-Liste wurde aktualisiert" }

    if ($old.Count) {
        Write-Step 'Alte Secrets'
        foreach ($o in $old) { Write-Done "$($o.displayName), gültig bis $(Format-Day $o.endDateTime)" }
        Write-Host '   Erst löschen, wenn der Server mit der neuen .env läuft, sonst fällt er aus.'
        if (Confirm-Yes '   Läuft der Server mit der neuen .env? Alte Secrets jetzt löschen?') {
            foreach ($o in $old) { Invoke-Graph POST "/applications/$($daemon.id)/removePassword" @{ keyId = $o.keyId } | Out-Null }
            Write-Done "$($old.Count) altes Secret gelöscht"
        }
        else { Write-Done 'Alte Secrets bleiben; später refresh erneut ausführen oder in Entra löschen.' }
    }
    Write-Step 'Fertig'
    Write-Done "Neue $EnvPath auf den Server kopieren und den Dienst neu starten."
    return
}

# ---------------------------------------------------------------- init

$schemaPath = Join-Path $PSScriptRoot 'sharepoint-schema.json'
$schema = Get-Content $schemaPath -Raw | ConvertFrom-Json -AsHashtable

$redirects = [Collections.Generic.List[string]]::new()
$DEFAULT_REDIRECTS | ForEach-Object { $redirects.Add($_) }
Write-Host "`nRedirect-URIs für die Anmeldung: $($DEFAULT_REDIRECTS -join ', ')"
while ($true) {
    $url = (Read-Host 'Weitere Adresse des Sekretariats (z. B. https://sekretariat.schule.de, leer = fertig)').Trim().TrimEnd('/')
    if (-not $url) { break }
    if ($url -notmatch '^(https://|http://localhost(:\d+)?$)') { Write-Warn 'Nur https:// oder http://localhost erlaubt'; continue }
    if (-not $redirects.Contains($url)) { $redirects.Add($url) }
}

$suggested = "noreply-$Slug@$domain"
$mailbox = (Read-Host "Absenderpostfach für Bestätigungsmails [$suggested]").Trim()
if (-not $mailbox) { $mailbox = $suggested }
if ($mailbox -eq "$Slug@$domain") { throw "$mailbox ist die Adresse der Gruppe; bitte ein eigenes Postfach angeben." }

Write-Host @"

Es wird eingerichtet:
  Gruppe und Site    $Name  (/sites/$Slug, Besitzer $($me.userPrincipalName))
  Listen             Schema-Version $($schema.schemaVersion)
  App-Registrierung  $SpaName  ($($redirects -join ', '))
  App-Registrierung  $DaemonName  (Zugriff nur auf die Listen dieser Site)
  Absenderpostfach   $mailbox
  Dateien            $EnvPath, $ConfigPath
"@
if (-not (Confirm-Yes 'Fortfahren?')) { return }

# -- 1. group and team site
Write-Step "Gruppe und Site $Name"
$group = Find-Group $Slug
if ($group) { Write-Done "Gruppe vorhanden: $($group.displayName)" }
else {
    $group = Invoke-Graph POST '/groups' @{
        displayName           = $Name
        description           = "Anmeldesystem: $Name"
        mailNickname          = $Slug
        mailEnabled           = $true
        securityEnabled       = $false
        groupTypes            = @('Unified')
        visibility            = 'Private'
        'owners@odata.bind'   = @("https://graph.microsoft.com/v1.0/users/$($me.id)")
    }
    Write-Done 'Gruppe angelegt'
}
$site = Invoke-Retry { Invoke-Graph GET "/groups/$($group.id)/sites/root?`$select=id,webUrl" } 'die Teamwebsite (kann einige Minuten dauern)' 72
Write-Done "Site: $($site.webUrl)"
$siteId = $site.id

# -- 2. lists and libraries
Write-Step "Listen (Schema-Version $($schema.schemaVersion))"
$lists = Get-ListIds $siteId
if ($lists.Config) {
    $stored = (Get-ConfigItems $siteId $lists.Config)['schemaVersion']
    if ($stored -and [int]$stored.fields.Value -gt [int]$schema.schemaVersion) {
        throw "Die Site hat Schema-Version $($stored.fields.Value), dieses Skript kennt nur $($schema.schemaVersion)."
    }
}
foreach ($spec in $schema.lists) {
    $listId = $lists[$spec.name]
    if (-not $listId) {
        $created = Invoke-Graph POST "/sites/$siteId/lists" @{ displayName = $spec.name; columns = @($spec.columns); list = @{ template = $spec.template } }
        $listId = $lists[$spec.name] = $created.id
        Write-Done "$($spec.name) angelegt"
    }
    else {
        $names = @(Get-GraphAll "/sites/$siteId/lists/$listId/columns?`$select=name" | ForEach-Object { $_.name })
        foreach ($col in $spec.columns) {
            if ($names -contains $col.name) { continue }
            Invoke-Graph POST "/sites/$siteId/lists/$listId/columns" $col | Out-Null
            Write-Done "$($spec.name).$($col.name) ergänzt"
        }
    }
    if ($spec.indexTitle) {
        $title = Get-GraphAll "/sites/$siteId/lists/$listId/columns?`$select=id,name,indexed" | Where-Object { $_.name -eq 'Title' } | Select-Object -First 1
        if ($title -and -not $title.indexed) { Invoke-Graph PATCH "/sites/$siteId/lists/$listId/columns/$($title.id)" @{ indexed = $true } | Out-Null }
    }
}
$configItems = Get-ConfigItems $siteId $lists.Config
foreach ($entry in $schema.config) {
    if ($configItems.ContainsKey($entry.Title)) { continue }
    $configItems[$entry.Title] = Invoke-Graph POST "/sites/$siteId/lists/$($lists.Config)/items" @{ fields = $entry }
}
Set-ConfigValue $siteId $lists.Config $configItems 'schemaVersion' "$($schema.schemaVersion)"
Set-ConfigValue $siteId $lists.Config $configItems 'mailSender' $mailbox
Write-Done 'Config-Liste: Grundeinstellungen, schemaVersion, mailSender'

$graphSp = Invoke-Graph GET "/servicePrincipals(appId='$GRAPH_APP_ID')?`$select=id,appRoles,oauth2PermissionScopes"
function Get-ScopeId([string] $Value) { ($graphSp.oauth2PermissionScopes | Where-Object { $_.value -eq $Value }).id }
function Get-RoleId([string] $Value) { ($graphSp.appRoles | Where-Object { $_.value -eq $Value }).id }

function Merge-GraphAccess($Existing, [hashtable[]] $Wanted) {
    $others = @($Existing | Where-Object { $_ -and $_.resourceAppId -ne $GRAPH_APP_ID })
    $access = @(($Existing | Where-Object { $_.resourceAppId -eq $GRAPH_APP_ID } | Select-Object -First 1).resourceAccess | Where-Object { $_ })
    foreach ($w in $Wanted) {
        if (-not ($access | Where-Object { $_.id -eq $w.id -and $_.type -eq $w.type })) { $access += $w }
    }
    @($others) + @(@{ resourceAppId = $GRAPH_APP_ID; resourceAccess = @($access) })
}

# -- 3. app registration for the secretariat (sign-in, delegated)
Write-Step "App-Registrierung $SpaName"
$spaAccess = @(
    @{ id = (Get-ScopeId 'Sites.Selected'); type = 'Scope' }
    @{ id = (Get-ScopeId 'User.Read'); type = 'Scope' }
)
$spa = Find-App $SpaName
if (-not $spa) {
    $spa = Invoke-Graph POST '/applications' @{
        displayName            = $SpaName
        signInAudience         = 'AzureADMyOrg'
        spa                    = @{ redirectUris = @($redirects) }
        requiredResourceAccess = @(@{ resourceAppId = $GRAPH_APP_ID; resourceAccess = $spaAccess })
    }
    Write-Done 'angelegt'
}
else {
    $uris = @(@($spa.spa.redirectUris) + @($redirects) | Where-Object { $_ } | Select-Object -Unique)
    Invoke-Graph PATCH "/applications/$($spa.id)" @{
        spa                    = @{ redirectUris = $uris }
        requiredResourceAccess = @(Merge-GraphAccess $spa.requiredResourceAccess $spaAccess)
    } | Out-Null
    Write-Done 'vorhanden, Redirect-URIs und Berechtigungen ergänzt'
}
$spaSp = Get-ServicePrincipalFor $spa.appId
$consentScope = 'Sites.Selected User.Read openid profile email offline_access'
$grant = @(Get-GraphAll ("/oauth2PermissionGrants?" + (Get-Filter "clientId eq '$($spaSp.id)' and resourceId eq '$($graphSp.id)'"))) |
    Where-Object { $_.consentType -eq 'AllPrincipals' } | Select-Object -First 1
if ($grant) {
    $merged = (@($grant.scope -split ' ') + @($consentScope -split ' ') | Where-Object { $_ } | Select-Object -Unique) -join ' '
    Invoke-Graph PATCH "/oauth2PermissionGrants/$($grant.id)" @{ scope = $merged } | Out-Null
}
else {
    Invoke-Graph POST '/oauth2PermissionGrants' @{ clientId = $spaSp.id; consentType = 'AllPrincipals'; resourceId = $graphSp.id; scope = $consentScope } | Out-Null
}
Write-Done "Admin-Zustimmung: $consentScope"
$sitePermission = @(Get-GraphAll "/sites/$siteId/permissions") | Where-Object { (Get-GrantedAppIds $_) -contains $spa.appId } | Select-Object -First 1
if (-not $sitePermission) {
    # Graph creates only read/write grants; fullcontrol is set afterwards
    $sitePermission = Invoke-Retry {
        Invoke-Graph POST "/sites/$siteId/permissions" @{ roles = @('write'); grantedToIdentities = @(@{ application = @{ id = $spa.appId; displayName = $SpaName } }) }
    } 'die App-Registrierung'
}
if (@($sitePermission.roles) -notcontains 'fullcontrol') {
    Invoke-Graph PATCH "/sites/$siteId/permissions/$($sitePermission.id)" @{ roles = @('fullcontrol') } | Out-Null
}
Write-Done 'Site-Freigabe: fullcontrol (Listen anlegen und ergänzen im Sekretariat)'

# -- 4. app registration for the server (daemon, application permission)
Write-Step "App-Registrierung $DaemonName"
$listsRole = Get-RoleId 'Lists.SelectedOperations.Selected'
$daemon = Find-App $DaemonName
if (-not $daemon) {
    $daemon = Invoke-Graph POST '/applications' @{
        displayName            = $DaemonName
        signInAudience         = 'AzureADMyOrg'
        requiredResourceAccess = @(@{ resourceAppId = $GRAPH_APP_ID; resourceAccess = @(@{ id = $listsRole; type = 'Role' }) })
    }
    Write-Done 'angelegt'
}
else { Write-Done 'vorhanden' }
$daemonSp = Get-ServicePrincipalFor $daemon.appId
$assigned = @(@(Get-GraphAll "/servicePrincipals/$($daemonSp.id)/appRoleAssignments") | Where-Object { $_.resourceId -eq $graphSp.id })
if (-not ($assigned | Where-Object { $_.appRoleId -eq $listsRole })) {
    Invoke-Retry {
        Invoke-Graph POST "/servicePrincipals/$($daemonSp.id)/appRoleAssignments" @{ principalId = $daemonSp.id; resourceId = $graphSp.id; appRoleId = $listsRole }
    } 'den Dienstprinzipal' | Out-Null
}
Write-Done 'Admin-Zustimmung: Lists.SelectedOperations.Selected'
foreach ($extra in @($assigned | Where-Object { $_.appRoleId -ne $listsRole })) {
    $roleName = ($graphSp.appRoles | Where-Object { $_.id -eq $extra.appRoleId }).value
    Write-Warn "hat zusätzlich die Graph-Berechtigung $roleName; nicht nötig, bitte in Entra entfernen"
}

foreach ($listName in $DAEMON_ROLES.Keys) {
    $listId = $lists[$listName]
    $role = $DAEMON_ROLES[$listName]
    $existing = @(@(Get-GraphAll "/sites/$siteId/lists/$listId/permissions") | Where-Object { (Get-GrantedAppIds $_) -contains $daemon.appId })
    if ($existing | Where-Object { @($_.roles).Count -eq 1 -and @($_.roles)[0] -eq $role }) { continue }
    foreach ($p in $existing) { Invoke-Graph DELETE "/sites/$siteId/lists/$listId/permissions/$($p.id)" | Out-Null }
    Invoke-Graph POST "/sites/$siteId/lists/$listId/permissions" @{ roles = @($role); grantedTo = @{ application = @{ id = $daemon.appId; displayName = $DaemonName } } } | Out-Null
}
Write-Done "Listenrechte: $(($DAEMON_ROLES.Keys | ForEach-Object { "$_ $($DAEMON_ROLES[$_])" }) -join ', ')"

# secret: keep the existing one if its .env is here, otherwise create one
$secret = $null
$valid = @($daemon.passwordCredentials | Where-Object { $_ -and (ConvertTo-Date $_.endDateTime) -gt [datetimeoffset]::UtcNow })
if ($valid.Count -and (Test-Path $EnvPath)) {
    $expires = ($valid | ForEach-Object { Format-Day $_.endDateTime } | Sort-Object -Descending | Select-Object -First 1)
    Write-Done "Secret vorhanden, $EnvPath bleibt unverändert (gültig bis $expires)"
}
else {
    $secret = New-DaemonSecret $daemon
    $expires = Format-Day $secret.endDateTime
    if ($valid.Count) { Write-Warn "$($valid.Count) älteres Secret bleibt gültig; löschen mit refresh" }
}
Set-ConfigValue $siteId $lists.Config $configItems 'daemonSecretExpires' $expires
Write-Done "Config-Liste: daemonSecretExpires = $expires"

# -- 5. mail: the server may send only from the sender mailbox
Write-Step "Mailversand aus $mailbox (Exchange, eigene Anmeldung mit Gerätecode)"
Invoke-ExchangeScript $ExchangeSetup ([ordered]@{
        AppId              = $daemon.appId
        ServicePrincipalId = $daemonSp.id
        DisplayName        = $DaemonName
        Mailbox            = $mailbox
        ScopeName          = "$Name Absender"
        AssignmentName     = "$Name Mail.Send"
    })

# -- 6. files
Write-Step 'Dateien'
if ($secret) {
    Write-ServerEnv $EnvPath ([ordered]@{
            TENANT_ID            = $tenant
            DAEMON_CLIENT_ID     = $daemon.appId
            DAEMON_CLIENT_SECRET = $secret.secretText
            SHAREPOINT_ID        = $siteId
        }) $expires
    $secret = $null
}
Write-ClientConfig $ConfigPath ([ordered]@{
        schemaVersion       = 1
        tenantId            = $tenant
        clientId            = $spa.appId
        siteId              = $siteId
        siteUrl             = $site.webUrl
        daemonSecretExpires = $expires
    })

Write-Step 'Fertig'
Write-Host @"
   1. $EnvPath auf den Server kopieren (enthält das Secret, nicht weitergeben).
   2. Sekretariat bzw. Desktop-App: Zahnrad, Tenant-ID und Client-ID eintragen, anmelden,
      dann unter Einstellungen $ConfigPath importieren.
   3. Personen aus dem Sekretariat zur Gruppe "$Name" hinzufügen.
   4. Im Sekretariat die Adresse der öffentlichen Anmeldeseite (publicUrl) eintragen.
   Secret gültig bis $expires; erneuern mit: ./setup-tenant.ps1 refresh -Name "$Name"
"@
