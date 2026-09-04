$ErrorActionPreference = 'Stop'
$BASE = 'http://127.0.0.1:8080'
$log = 'C:\Users\AtlasRex\AppData\Local\Temp\opencode\admin-smoke.log'
Start-Transcript -Path $log -Force | Out-Null

# login as admin
$login = Invoke-RestMethod -Method Post -Uri "$BASE/api/login" -ContentType 'application/json' -Body (@{ email = 'tariq@orisonigt.com'; pin = '1234' } | ConvertTo-Json)
$HDR = @{ Authorization = "Bearer $($login.token)" }
Write-Host "login ok, role=$($login.user.role)"

# 1. create a serialized product
$prod = Invoke-RestMethod -Method Post -Uri "$BASE/api/admin/products" -Headers $HDR -ContentType 'application/json' -Body (@{
  name = 'TestRouter 6E'; sku = 'NW-RT6E'; upc = '0012345699001'; category = 'Networking';
  retailPrice = 249; costPrice = 149; isSerialized = $true; onHand = 0
} | ConvertTo-Json)
Write-Host "created product id=$($prod.id)"

# 2. verify in catalog (note: /api/products returns a plain array)
$catalog = Invoke-RestMethod -Method Get -Uri "$BASE/api/products" -Headers $HDR
$found = $catalog | Where-Object { $_.id -eq $prod.id }
if ($found) { Write-Host "PASS catalog contains new product ($($found.name))" } else { Write-Host "FAIL product missing from catalog"; exit 1 }

# 3. add serials
$ser = Invoke-RestMethod -Method Post -Uri "$BASE/api/admin/serials" -Headers $HDR -ContentType 'application/json' -Body (@{
  productId = $prod.id; serialNumbers = @('RT6E0001', 'RT6E0002', 'RT6E0001')
} | ConvertTo-Json -Depth 4)
Write-Host "serials added=$($ser.added.Count) dupes=$($ser.duplicates.Count) -> $($ser.added -join ',') / $($ser.duplicates -join ',')"
if ($ser.added.Count -ne 2 -or $ser.duplicates.Count -ne 1) { Write-Host 'FAIL serial add semantics'; exit 1 }

# 4. adjust inventory on a non-serialized product
$acc = ($catalog | Where-Object { $_.isSerialized -eq $false } | Select-Object -First 1)
$inv = Invoke-RestMethod -Method Post -Uri "$BASE/api/admin/inventory" -Headers $HDR -ContentType 'application/json' -Body (@{
  productId = $acc.id; onHand = 37
} | ConvertTo-Json)
Write-Host "inventory adjusted ok=$($inv.ok) (product=$($acc.name))"

# 5. non-admin forbidden
$cashier = Invoke-RestMethod -Method Post -Uri "$BASE/api/login" -ContentType 'application/json' -Body (@{ email = 'amara@orisonigt.com'; pin = '5678' } | ConvertTo-Json)
try {
  Invoke-RestMethod -Method Post -Uri "$BASE/api/admin/products" -Headers @{ Authorization = "Bearer $($cashier.token)" } -ContentType 'application/json' -Body (@{ name = 'Nope' } | ConvertTo-Json) | Out-Null
  Write-Host 'FAIL cashier could create product (expected 403)'
} catch {
  if ($_.Exception.Response.StatusCode.value__ -eq 403) { Write-Host 'PASS cashier got 403 on admin route' }
  else { Write-Host "FAIL expected 403 got $($_.Exception.Response.StatusCode.value__)" }
}

# 6. non-serialized product refuses serials
try {
  Invoke-RestMethod -Method Post -Uri "$BASE/api/admin/serials" -Headers $HDR -ContentType 'application/json' -Body (@{
    productId = $acc.id; serialNumbers = @('X1')
  } | ConvertTo-Json) | Out-Null
  Write-Host 'FAIL serials accepted on non-serialized product'
} catch {
  Write-Host "PASS non-serialized product rejected serials ($($_.Exception.Response.StatusCode.value__))"
}

Stop-Transcript | Out-Null
Write-Host 'DONE'