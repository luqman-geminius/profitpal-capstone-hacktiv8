/**
 * ProfitPal – script.js
 * Pure Vanilla JS (ES6) · Zero external libraries
 * Data source: dataset_umkm_profitpal_100.csv
 */

/* ============================================================
   STATE
   ============================================================ */
let allRows       = [];   // Raw parsed CSV rows
let simRow        = null; // Optional simulated extra row
let activeFilters = {
  kategori: 'Semua',
  tipe:     'Semua',
  channel:  'Semua',
  status:   'Semua',
};
let loadedFileName = 'dataset_umkm_profitpal_100.csv';

/* ============================================================
   BOOTSTRAP – attempt fetch or show file prompt
   ============================================================ */
window.addEventListener('DOMContentLoaded', () => {
  // Wire file input
  document.getElementById('csvFileInput').addEventListener('change', handleFileUpload);

  // Wire filters
  document.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => handlePillFilter(btn));
  });
  document.getElementById('filterChannel').addEventListener('change', e => {
    activeFilters.channel = e.target.value;
    renderDashboard();
  });
  document.getElementById('resetFilterBtn').addEventListener('click', resetFilters);
  document.getElementById('toggleSimBtn').addEventListener('click', toggleSimPanel);

  // Boot audit table (search, sort, pagination, modal)
  initAuditTable();

  // Try fetch first; fallback to file prompt on failure
  fetch('dataset_umkm_profitpal_100.csv')
    .then(r => {
      if (!r.ok) throw new Error('fetch failed');
      return r.text();
    })
    .then(text => {
      allRows = parseCSV(text);
      renderDashboard();
    })
    .catch(() => {
      document.getElementById('filePrompt').classList.remove('hidden');
    });
});

/* ============================================================
   CSV PARSER
   ============================================================ */
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map((line, i) => {
    // Handle commas inside quoted fields (simple)
    const values = splitCSVLine(line);
    const row = {};
    headers.forEach((h, j) => { row[h] = (values[j] || '').trim(); });
    // Cast numeric fields
    row.harga_jual    = parseFloat(row.harga_jual)   || 0;
    row.hpp_per_unit  = parseFloat(row.hpp_per_unit) || 0;
    row.unit_terjual  = parseFloat(row.unit_terjual) || 0;
    row.biaya_iklan   = parseFloat(row.biaya_iklan)  || 0;
    row.unit_retur    = parseFloat(row.unit_retur)   || 0;
    row._simulated    = false;
    return row;
  }).filter(r => r.id_transaksi); // skip empty rows
}

function splitCSVLine(line) {
  const result = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuote = !inQuote; }
    else if (ch === ',' && !inQuote) { result.push(cur); cur = ''; }
    else { cur += ch; }
  }
  result.push(cur);
  return result;
}

/* ============================================================
   FILE UPLOAD HANDLER
   ============================================================ */
function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  loadedFileName = file.name;
  const reader = new FileReader();
  reader.onload = ev => {
    allRows = parseCSV(ev.target.result);
    simRow  = null;
    document.getElementById('simRemoveBtn').style.display = 'none';
    document.getElementById('filePrompt').classList.add('hidden');
    renderDashboard();
  };
  reader.readAsText(file);
}

/* ============================================================
   FILTER HELPERS
   ============================================================ */
function handlePillFilter(btn) {
  const filterKey = btn.dataset.filter;
  const value     = btn.dataset.value;
  activeFilters[filterKey] = value;

  // Update active styling for this group
  btn.closest('.filter-pills').querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  renderDashboard();
}

function resetFilters() {
  activeFilters = { kategori: 'Semua', tipe: 'Semua', channel: 'Semua', status: 'Semua' };
  document.querySelectorAll('[data-filter]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === 'Semua');
  });
  document.getElementById('filterChannel').value = 'Semua';
  renderDashboard();
}

/* ============================================================
   BUSINESS CALCULATIONS (per transaction row)
   ============================================================ */
function calcRow(r) {
  const grossRevenue  = r.harga_jual * r.unit_terjual;
  const totalHPP      = r.hpp_per_unit * r.unit_terjual;
  const returnLoss    = r.unit_retur * r.harga_jual;
  const trueNetProfit = grossRevenue - totalHPP - r.biaya_iklan - returnLoss;
  const netMargin     = grossRevenue > 0 ? (trueNetProfit / grossRevenue) * 100 : 0;
  const returnRate    = r.unit_terjual > 0 ? (r.unit_retur / r.unit_terjual) * 100 : 0;
  const adSpendRatio  = grossRevenue > 0 ? (r.biaya_iklan / grossRevenue) * 100 : 0;
  return { grossRevenue, totalHPP, returnLoss, trueNetProfit, netMargin, returnRate, adSpendRatio };
}

/* ============================================================
   SKU AGGREGATION
   ============================================================ */
function aggregateBySku(rows) {
  const map = {};
  rows.forEach(r => {
    const key = r.sku_id;
    if (!map[key]) {
      map[key] = {
        sku_id: r.sku_id,
        nama_produk: r.nama_produk,
        kategori: r.kategori,
        tipe_bisnis: r.tipe_bisnis,
        channel_penjualan: r.channel_penjualan,
        harga_jual: r.harga_jual,
        grossRevenue: 0, totalHPP: 0, returnLoss: 0,
        trueNetProfit: 0, biaya_iklan: 0,
        unit_terjual: 0, unit_retur: 0,
        txCount: 0,
        alasan_retur: {},
        _simulated: r._simulated || false,
      };
    }
    const c = calcRow(r);
    map[key].grossRevenue  += c.grossRevenue;
    map[key].totalHPP      += c.totalHPP;
    map[key].returnLoss    += c.returnLoss;
    map[key].trueNetProfit += c.trueNetProfit;
    map[key].biaya_iklan   += r.biaya_iklan;
    map[key].unit_terjual  += r.unit_terjual;
    map[key].unit_retur    += r.unit_retur;
    map[key].txCount++;
    if (r.alasan_retur_utama && r.alasan_retur_utama !== 'Tidak ada retur') {
      map[key].alasan_retur[r.alasan_retur_utama] = (map[key].alasan_retur[r.alasan_retur_utama] || 0) + 1;
    }
    if (r._simulated) map[key]._simulated = true;
  });

  return Object.values(map).map(s => {
    s.netMargin    = s.grossRevenue > 0 ? (s.trueNetProfit / s.grossRevenue) * 100 : 0;
    s.returnRate   = s.unit_terjual > 0 ? (s.unit_retur    / s.unit_terjual) * 100 : 0;
    s.adSpendRatio = s.grossRevenue > 0 ? (s.biaya_iklan   / s.grossRevenue) * 100 : 0;
    // Top alasan retur
    const entries = Object.entries(s.alasan_retur);
    s.topAlasan = entries.length > 0
      ? entries.sort((a, b) => b[1] - a[1])[0][0]
      : 'Tidak ada retur';
    // Classification
    if (s.netMargin >= 25 && s.returnRate < 8) {
      s.status = 'Star Profit';
    } else if (s.trueNetProfit <= 0 || s.netMargin < 10 || s.returnRate >= 15) {
      s.status = 'Profit Bleeder';
    } else {
      s.status = 'Watchlist';
    }
    return s;
  }).sort((a, b) => a.sku_id.localeCompare(b.sku_id));
}

/* ============================================================
   FILTERING
   ============================================================ */
function getFilteredRows() {
  let rows = [...allRows];
  if (simRow) rows.push(simRow);

  if (activeFilters.kategori !== 'Semua') {
    rows = rows.filter(r => r.kategori === activeFilters.kategori);
  }
  if (activeFilters.tipe !== 'Semua') {
    rows = rows.filter(r => r.tipe_bisnis === activeFilters.tipe);
  }
  if (activeFilters.channel !== 'Semua') {
    rows = rows.filter(r => r.channel_penjualan === activeFilters.channel);
  }
  return rows;
}

function getFilteredSkus(rows) {
  let skus = aggregateBySku(rows);
  if (activeFilters.status !== 'Semua') {
    skus = skus.filter(s => s.status === activeFilters.status);
  }
  return skus;
}

/* ============================================================
   MASTER RENDER
   ============================================================ */
function renderDashboard() {
  const rows = getFilteredRows();
  const skus = getFilteredSkus(rows);

  updateDatasetBadge(rows);
  renderHealthScore(skus);
  renderKPICards(skus);
  renderComparisonCards(skus);
  renderWaveChart(aggregateBySku(rows)); // Always all SKUs (pre-status filter) for chart
  renderRecommendations(aggregateBySku(rows)); // All SKUs for reco logic
  renderTable(rows, skus);
}

/* ============================================================
   DATASET BADGE
   ============================================================ */
function updateDatasetBadge(rows) {
  document.getElementById('datasetBadgeText').textContent =
    `${loadedFileName} · ${rows.length} baris`;
}

/* ============================================================
   3. HERO HEALTH SCORE
   ============================================================ */
function renderHealthScore(skus) {
  if (!skus.length) {
    document.getElementById('healthScore').textContent   = '--';
    document.getElementById('healthStatus').textContent  = 'Tidak ada data';
    document.getElementById('avgNetMargin').textContent  = '--%';
    document.getElementById('avgReturnRate').textContent = '--%';
    document.getElementById('totalTrx').textContent      = '0 baris';
    return;
  }

  const avgMargin     = skus.reduce((s, k) => s + k.netMargin,  0) / skus.length;
  const avgReturnRate = skus.reduce((s, k) => s + k.returnRate, 0) / skus.length;
  const starCount     = skus.filter(k => k.status === 'Star Profit').length;
  const bleedCount    = skus.filter(k => k.status === 'Profit Bleeder').length;
  const totalTrx      = allRows.length + (simRow ? 1 : 0);

  // Score formula: margin contributes 60%, return penalty 40%
  let score = Math.min(100, Math.max(0,
    (avgMargin * 2) - (avgReturnRate * 1.5) + (starCount * 4) - (bleedCount * 5) + 20
  ));
  score = Math.round(score);

  let statusLabel, archetypeTitle;
  if (score >= 75) {
    statusLabel     = '🚀 Cuan Sultan! Bisnis lo lagi on fire!';
    archetypeTitle  = '👑 Profit Dominator';
  } else if (score >= 55) {
    statusLabel     = '📈 Solid Growth – Terus gass!';
    archetypeTitle  = '💼 Smart Builder';
  } else if (score >= 35) {
    statusLabel     = '⚡ Watchlist Zone – Perlu optimasi!';
    archetypeTitle  = '🛠️ Active Optimizer';
  } else {
    statusLabel     = '🩸 Danger Zone – Segera benahi!';
    archetypeTitle  = '⚠️ Crisis Manager';
  }

  document.getElementById('healthScore').textContent        = score + '%';
  document.getElementById('healthStatus').textContent       = statusLabel;
  document.getElementById('summaryArchetype').textContent   = archetypeTitle;
  document.getElementById('avgNetMargin').textContent       = avgMargin.toFixed(1) + '%';
  document.getElementById('avgReturnRate').textContent      = avgReturnRate.toFixed(1) + '%';
  document.getElementById('totalTrx').textContent           = totalTrx + ' baris';

  // Dynamic bg color based on score
  const heroCard = document.getElementById('heroHealthCard');
  if (score >= 75) heroCard.style.background = '#4DA8F5';
  else if (score >= 55) heroCard.style.background = '#34C3A0';
  else if (score >= 35) heroCard.style.background = '#F59E0B';
  else heroCard.style.background = '#FF7EB3';
}

/* ============================================================
   4. KPI CARDS
   ============================================================ */
function renderKPICards(skus) {
  const totalGross   = skus.reduce((s, k) => s + k.grossRevenue,  0);
  const totalProfit  = skus.reduce((s, k) => s + k.trueNetProfit, 0);
  const totalAds     = skus.reduce((s, k) => s + k.biaya_iklan,   0);
  const totalReturn  = skus.reduce((s, k) => s + k.returnLoss,    0);

  document.getElementById('kpiGrossRevenue').textContent = formatRp(totalGross);
  document.getElementById('kpiNetProfit').textContent    = formatRp(totalProfit);
  document.getElementById('kpiAdSpend').textContent      = formatRp(totalAds);
  document.getElementById('kpiReturnLoss').textContent   = formatRp(totalReturn);

  // Color net profit KPI based on value
  const kpiNetEl = document.getElementById('kpiNetProfit');
  const kpiCard  = kpiNetEl.closest('.kpi-card');
  if (totalProfit < 0) {
    kpiCard.style.background = '#FEF2F2';
    kpiNetEl.style.color = '#DC2626';
  } else {
    kpiCard.style.background = '';
    kpiNetEl.style.color = '';
  }
}

/* ============================================================
   5. COMPARISON CARDS
   ============================================================ */
function renderComparisonCards(skus) {
  if (!skus.length) return;

  // Top profit: highest trueNetProfit
  const topSku = skus.slice().sort((a, b) => b.trueNetProfit - a.trueNetProfit)[0];
  // Highest bleed: lowest trueNetProfit or highest returnRate
  const bleedSku = skus.slice().sort((a, b) => {
    // Prioritize negative profit, then highest return rate
    if (a.trueNetProfit <= 0 && b.trueNetProfit > 0) return -1;
    if (b.trueNetProfit <= 0 && a.trueNetProfit > 0) return 1;
    return a.trueNetProfit - b.trueNetProfit;
  })[0];

  document.getElementById('topProfitSku').textContent    = topSku.sku_id;
  document.getElementById('topProfitName').textContent   = topSku.nama_produk;
  document.getElementById('topProfitValue').textContent  = formatRp(topSku.trueNetProfit);
  document.getElementById('topProfitMargin').textContent = topSku.netMargin.toFixed(1) + '%';
  document.getElementById('topProfitRR').textContent     = topSku.returnRate.toFixed(1) + '%';
  document.getElementById('topProfitReason').textContent = topSku.topAlasan;

  document.getElementById('bleedSku').textContent    = bleedSku.sku_id;
  document.getElementById('bleedName').textContent   = bleedSku.nama_produk;
  document.getElementById('bleedValue').textContent  = formatRp(bleedSku.trueNetProfit);
  document.getElementById('bleedMargin').textContent = bleedSku.netMargin.toFixed(1) + '%';
  document.getElementById('bleedRR').textContent     = bleedSku.returnRate.toFixed(1) + '%';
  document.getElementById('bleedReason').textContent = bleedSku.topAlasan;
}

/* ============================================================
   6. GROUPED BAR CHART (Pure CSS/SVG)
   ============================================================ */
/* ============================================================
   UPDATE WAVE CHART HEADER NUMBERS
   ============================================================ */
function updateWaveChartHeader(allSkusAll) {
  const totalProfit = allSkusAll.reduce((s, k) => s + k.trueNetProfit, 0);
  const totalGross  = allSkusAll.reduce((s, k) => s + k.grossRevenue,  0);
  const overallMargin = totalGross > 0 ? (totalProfit / totalGross) * 100 : 0;

  document.getElementById('waveHeroNum').textContent     = formatRpFull(totalProfit);
  document.getElementById('waveMarginBadge').textContent = `↑ ${overallMargin.toFixed(1)}% Margin`;
  document.getElementById('waveHeaderSub').innerHTML     =
    `Dibandingkan total Omzet Kotor <strong>${formatRpFull(totalGross)}</strong> setelah potongan iklan &amp; retur`;
}

function formatRpFull(val) {
  const abs  = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  return sign + 'Rp ' + Math.round(abs).toLocaleString('id-ID');
}

/* ============================================================
   6. MIRRORED SMOOTH WAVE SVG AREA CHART
   ============================================================ */
function renderWaveChart(skus) {
  // Update header with all-SKU totals
  updateWaveChartHeader(skus);

  const svg     = document.getElementById('waveChartSvg');
  const xAxis   = document.getElementById('waveXAxis');
  const tooltip = document.getElementById('waveTooltip');
  if (!svg) return;

  // Sort SKUs SKU-01 … SKU-12
  const sorted = skus.slice().sort((a, b) => a.sku_id.localeCompare(b.sku_id));

  // SVG logical dimensions (we use viewBox)
  const W = 800, H = 320;
  const PAD_L = 52, PAD_R = 16, PAD_TOP = 20, PAD_BOT = 20;
  const plotW = W - PAD_L - PAD_R;
  const midY  = H / 2; // Centre baseline

  // Upper hemisphere height (positive values go UP from midY)
  const upperH = midY - PAD_TOP;
  // Lower hemisphere height (cost waves go DOWN from midY)
  const lowerH = midY - PAD_BOT;

  // Max values for scaling
  const maxUpper = Math.max(...sorted.map(s => Math.max(s.grossRevenue, s.trueNetProfit > 0 ? s.trueNetProfit : 0)), 1);
  const maxLower = Math.max(...sorted.map(s => Math.max(s.biaya_iklan, s.returnLoss)), 1);

  const n    = sorted.length; // 12
  const step = plotW / (n - 1); // spacing between SKU columns

  // Convert index to X coordinate
  const ix = i => PAD_L + i * step;

  // Convert upper value to Y (up from midY)
  const uy = v => midY - (v / maxUpper) * upperH * 0.9;

  // Convert lower value to Y (down from midY)
  const ly = v => midY + (v / maxLower) * lowerH * 0.9;

  // ---- Build smooth cubic Bezier path from point array ----
  function smoothPath(pts) {
    if (pts.length < 2) return '';
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const cp1x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * 0.45;
      const cp1y = pts[i][1];
      const cp2x = pts[i + 1][0] - (pts[i + 1][0] - pts[i][0]) * 0.45;
      const cp2y = pts[i + 1][1];
      d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${pts[i + 1][0]} ${pts[i + 1][1]}`;
    }
    return d;
  }

  // ---- Build closed area path: smooth line + return along baseline ----
  function areaPath(pts, baseline) {
    if (!pts.length) return '';
    const line = smoothPath(pts);
    // close: go right-to-left along baseline
    const closeBack = pts.slice().reverse().map((p, j) => {
      const bx = p[0];
      return `L ${bx} ${baseline}`;
    }).join(' ');
    return `${line} L ${pts[pts.length - 1][0]} ${baseline} L ${pts[0][0]} ${baseline} Z`;
  }

  // Build point arrays
  const ptsGross   = sorted.map((s, i) => [ix(i), uy(s.grossRevenue)]);
  const ptsProfit  = sorted.map((s, i) => [ix(i), uy(Math.max(s.trueNetProfit, 0))]);
  const ptsAds     = sorted.map((s, i) => [ix(i), ly(s.biaya_iklan)]);
  const ptsReturn  = sorted.map((s, i) => [ix(i), ly(s.returnLoss)]);

  // Smooth strokes only (no area closure needed for stroke)
  const strokeGross  = smoothPath(ptsGross);
  const strokeProfit = smoothPath(ptsProfit);
  const strokeAds    = smoothPath(ptsAds);
  const strokeReturn = smoothPath(ptsReturn);

  // Area closure paths
  const areaGross  = areaPath(ptsGross,  midY);
  const areaProfit = areaPath(ptsProfit, midY);
  const areaAds    = areaPath(ptsAds,    midY);
  const areaReturn = areaPath(ptsReturn, midY);

  // ---- Y-axis ticks ----
  function yTick(val, y, color) {
    return `<line x1="${PAD_L - 6}" y1="${y}" x2="${PAD_L}" y2="${y}" stroke="${color}" stroke-width="1" opacity="0.5"/>
            <text x="${PAD_L - 8}" y="${y + 4}" text-anchor="end" font-size="9" font-family="Nunito,sans-serif" fill="#6B7280">${formatRpShort(val)}</text>`;
  }
  const tickVals   = [0.25, 0.5, 0.75, 1.0];
  const upperTicks = tickVals.map(t =>
    yTick(maxUpper * t, uy(maxUpper * t), '#6B7280')
  ).join('');
  const lowerTicks = tickVals.map(t =>
    yTick(maxLower * t, ly(maxLower * t), '#6B7280')
  ).join('');

  // ---- Mid-axis SKU milestone labels ----
  const milestoneSkus = ['SKU-01', 'SKU-03', 'SKU-05', 'SKU-07', 'SKU-09', 'SKU-12'];
  const milestoneLabels = sorted
    .filter(s => milestoneSkus.includes(s.sku_id))
    .map(s => {
      const i = sorted.indexOf(s);
      return `<text x="${ix(i)}" y="${midY - 5}" text-anchor="middle" font-size="9.5"
        font-family="Fredoka,Nunito,sans-serif" font-weight="600" fill="#9CA3AF">${s.sku_id}</text>`;
    }).join('');

  // ---- Gradient defs ----
  const defs = `
    <linearGradient id="gradGross" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%"   stop-color="#34D399" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#4DA8F5" stop-opacity="0.08"/>
    </linearGradient>
    <linearGradient id="gradProfit" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%"   stop-color="#5B3FE8" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#B6A6FF" stop-opacity="0.1"/>
    </linearGradient>
    <linearGradient id="gradAds" x1="0%" y1="100%" x2="0%" y2="0%">
      <stop offset="0%"   stop-color="#FF7EB3" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#FF8A65" stop-opacity="0.08"/>
    </linearGradient>
    <linearGradient id="gradReturn" x1="0%" y1="100%" x2="0%" y2="0%">
      <stop offset="0%"   stop-color="#FFD43B" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#FFD43B" stop-opacity="0.08"/>
    </linearGradient>
    <filter id="glowMint" x="-20%" y="-50%" width="140%" height="200%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="glowPurple" x="-20%" y="-50%" width="140%" height="200%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  `;

  // ---- Hit points for each SKU ----
  const hitPoints = sorted.map((s, i) => {
    const cx   = ix(i);
    const topY = Math.min(uy(s.grossRevenue), uy(Math.max(s.trueNetProfit, 0)));
    return `<circle class="wave-hit" cx="${cx}" cy="${midY}" r="20" fill="transparent"
      data-idx="${i}" style="cursor:pointer" role="button"
      tabindex="0" aria-label="${s.sku_id} ${s.nama_produk}"/>
    <circle class="wave-dot" cx="${cx}" cy="${midY}" r="4" fill="#fff"
      stroke="#5B3FE8" stroke-width="2" pointer-events="none"/>`;
  }).join('');

  // ---- Compose full SVG innerHTML ----
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = `
    <defs>${defs}</defs>

    <!-- Grid lines -->
    <line x1="${PAD_L}" y1="${PAD_TOP}" x2="${PAD_L}" y2="${H - PAD_BOT}"
      stroke="#E5E7EB" stroke-width="1"/>

    <!-- Upper hemisphere subtle grid -->
    ${tickVals.map(t => `<line x1="${PAD_L}" y1="${uy(maxUpper * t)}" x2="${W - PAD_R}" y2="${uy(maxUpper * t)}"
      stroke="#E5E7EB" stroke-width="0.8" stroke-dasharray="3 4"/>`).join('')}

    <!-- Lower hemisphere subtle grid -->
    ${tickVals.map(t => `<line x1="${PAD_L}" y1="${ly(maxLower * t)}" x2="${W - PAD_R}" y2="${ly(maxLower * t)}"
      stroke="#E5E7EB" stroke-width="0.8" stroke-dasharray="3 4"/>`).join('')}

    <!-- Y-axis ticks -->
    ${upperTicks}
    ${lowerTicks}

    <!-- === UPPER HEMISPHERE AREAS === -->
    <!-- Gross Revenue area (outer, behind) -->
    <path d="${areaGross}" fill="url(#gradGross)"/>
    <!-- Net Profit area (inner, in front) -->
    <path d="${areaProfit}" fill="url(#gradProfit)"/>

    <!-- === LOWER HEMISPHERE AREAS (inverted, downward) === -->
    <!-- Ad Spend area -->
    <path d="${areaAds}" fill="url(#gradAds)"/>
    <!-- Return Loss area -->
    <path d="${areaReturn}" fill="url(#gradReturn)"/>

    <!-- === STROKE LINES === -->
    <!-- Gross Revenue stroke (glow mint) -->
    <path d="${strokeGross}" fill="none" stroke="#34D399" stroke-width="2.5"
      stroke-linecap="round" stroke-linejoin="round" filter="url(#glowMint)"/>
    <!-- Net Profit stroke (glow purple) -->
    <path d="${strokeProfit}" fill="none" stroke="#5B3FE8" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" filter="url(#glowPurple)"/>
    <!-- Ad Spend stroke -->
    <path d="${strokeAds}" fill="none" stroke="#FF7EB3" stroke-width="1.8"
      stroke-linecap="round" stroke-linejoin="round"/>
    <!-- Return Loss stroke -->
    <path d="${strokeReturn}" fill="none" stroke="#FFD43B" stroke-width="1.8"
      stroke-linecap="round" stroke-linejoin="round"/>

    <!-- Center baseline axis -->
    <line x1="${PAD_L}" y1="${midY}" x2="${W - PAD_R}" y2="${midY}"
      stroke="#1E1B4B" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.3"/>

    <!-- SKU milestone labels on baseline -->
    ${milestoneLabels}

    <!-- UPPER label -->
    <text x="${PAD_L + 6}" y="${PAD_TOP + 14}" font-size="10"
      font-family="Fredoka,Nunito,sans-serif" font-weight="600" fill="#34D399" opacity="0.8">▲ Revenue &amp; Profit</text>

    <!-- LOWER label -->
    <text x="${PAD_L + 6}" y="${H - PAD_BOT - 6}" font-size="10"
      font-family="Fredoka,Nunito,sans-serif" font-weight="600" fill="#FF7EB3" opacity="0.8">▼ Iklan &amp; Retur</text>

    <!-- Interactive hit points -->
    ${hitPoints}
  `;

  // ---- X-Axis labels ----
  xAxis.innerHTML = '';
  sorted.forEach(s => {
    const lbl = document.createElement('span');
    lbl.className   = 'wave-xaxis-lbl';
    lbl.textContent = s.sku_id.replace('SKU-', 'S');
    lbl.title        = s.nama_produk;
    xAxis.appendChild(lbl);
  });

  // ---- Hover / click interactions ----
  const svgEl = document.getElementById('waveChartSvg');
  const wrap  = svgEl.parentElement;

  function showTooltip(evt, idx) {
    const s   = sorted[idx];
    const tt  = document.getElementById('waveTooltip');
    tt.innerHTML = `
      <div class="tt-sku">${s.sku_id} · ${s.nama_produk}</div>
      <div class="tt-row"><span class="tt-label">Omzet Kotor</span><span class="tt-val">${formatRp(s.grossRevenue)}</span></div>
      <div class="tt-row"><span class="tt-label">True Net Profit</span><span class="tt-val" style="color:${s.trueNetProfit >= 0 ? '#34D399' : '#EF4444'}">${formatRp(s.trueNetProfit)}</span></div>
      <div class="tt-row"><span class="tt-label">Biaya Iklan</span><span class="tt-val">${formatRp(s.biaya_iklan)}</span></div>
      <div class="tt-row"><span class="tt-label">Kerugian Retur</span><span class="tt-val" style="color:#FFD43B">${formatRp(s.returnLoss)}</span></div>
    `;
    tt.classList.remove('hidden');

    // Position: use the SVG's bounding rect to find the X of the hit point
    const svgRect  = svgEl.getBoundingClientRect();
    const svgScaleX = svgRect.width / W;
    const hitX     = ix(idx) * svgScaleX;
    const hitYMid  = (midY * svgRect.height / H);

    // Keep tooltip inside card
    const ttW  = 210;
    let leftPx = hitX;
    if (leftPx - ttW / 2 < 0)       leftPx = ttW / 2 + 4;
    if (leftPx + ttW / 2 > svgRect.width) leftPx = svgRect.width - ttW / 2 - 4;

    tt.style.left = leftPx + 'px';
    tt.style.top  = (hitYMid - tt.offsetHeight - 12) + 'px';
  }

  function hideTooltip() {
    document.getElementById('waveTooltip').classList.add('hidden');
  }

  // Attach events to hit circles after rendering
  svgEl.querySelectorAll('.wave-hit').forEach(el => {
    const idx = parseInt(el.getAttribute('data-idx'), 10);
    el.addEventListener('mouseenter', e => showTooltip(e, idx));
    el.addEventListener('mouseleave', hideTooltip);
    el.addEventListener('click',      e => showTooltip(e, idx));
    el.addEventListener('focus',      e => showTooltip(e, idx));
    el.addEventListener('blur',       hideTooltip);
  });
}

function formatRpShort(val) {
  if (val >= 1_000_000) return (val / 1_000_000).toFixed(0) + 'jt';
  if (val >= 1_000)     return (val / 1_000).toFixed(0) + 'rb';
  return val.toFixed(0);
}

/* ============================================================
   7. TACTICAL RECOMMENDATIONS
   ============================================================ */
function renderRecommendations(allSkus) {
  const grid = document.getElementById('recoGrid');
  grid.innerHTML = '';

  const recos = generateRecommendations(allSkus);
  const typeMap = {
    alert: 'reco-alert',
    warn:  'reco-warn',
    star:  'reco-star',
  };

  recos.forEach(r => {
    const card = document.createElement('article');
    card.className = `reco-card ${typeMap[r.type] || ''}`;
    card.innerHTML = `
      <div class="reco-icon">${r.icon}</div>
      <div class="reco-title">${r.title}</div>
      <div class="reco-body">${r.body}</div>
      <span class="reco-action">${r.action}</span>
    `;
    grid.appendChild(card);
  });
}

function generateRecommendations(skus) {
  const recos = [];

  // 1. Highest return rate SKU (>= 15%)
  const highReturn = skus.filter(s => s.returnRate >= 15)
    .sort((a, b) => b.returnRate - a.returnRate)[0];
  if (highReturn) {
    recos.push({
      type: 'alert',
      icon: '🩸',
      title: `Retur Parah: ${highReturn.sku_id}`,
      body: `<strong>${highReturn.nama_produk}</strong> memiliki return rate <strong>${highReturn.returnRate.toFixed(1)}%</strong> (≥15%). Alasan utama: "<em>${highReturn.topAlasan}</em>". Channel terdampak: ${highReturn.channel_penjualan}. Ini menyebabkan kerugian retur sebesar <strong>${formatRp(highReturn.returnLoss)}</strong>.`,
      action: '→ Perbaiki Packaging / Deskripsi Ukuran',
    });
  }

  // 2. High ad spend ratio (> 22%) with low margin (< 20%)
  const adHeavy = skus.filter(s => s.adSpendRatio > 22 && s.netMargin < 20)
    .sort((a, b) => b.adSpendRatio - a.adSpendRatio)[0];
  if (adHeavy) {
    recos.push({
      type: 'warn',
      icon: '📢',
      title: `Iklan Boros: ${adHeavy.sku_id}`,
      body: `<strong>${adHeavy.nama_produk}</strong> menghabiskan <strong>${adHeavy.adSpendRatio.toFixed(1)}%</strong> omzet untuk iklan namun margin cuma <strong>${adHeavy.netMargin.toFixed(1)}%</strong>. Biaya iklan: <strong>${formatRp(adHeavy.biaya_iklan)}</strong> di channel <strong>${adHeavy.channel_penjualan}</strong>. ROI iklan sangat rendah!`,
      action: '→ Optimalkan Target Iklan / Kurangi Budget',
    });
  }

  // 3. Top Star Profit SKU to scale
  const starSku = skus.filter(s => s.status === 'Star Profit')
    .sort((a, b) => b.trueNetProfit - a.trueNetProfit)[0];
  if (starSku) {
    recos.push({
      type: 'star',
      icon: '⭐',
      title: `Scale Up: ${starSku.sku_id}`,
      body: `<strong>${starSku.nama_produk}</strong> adalah <strong>Star Profit</strong> terbaikmu! Net margin <strong>${starSku.netMargin.toFixed(1)}%</strong>, return rate hanya <strong>${starSku.returnRate.toFixed(1)}%</strong>, dengan profit bersih <strong>${formatRp(starSku.trueNetProfit)}</strong>. Channel terkuat: <strong>${starSku.channel_penjualan}</strong>.`,
      action: '→ Tambah Budget & Replikasi ke Channel Lain',
    });
  }

  // Fallbacks if none found
  if (!highReturn && !adHeavy && skus.length) {
    const worstProfit = skus.slice().sort((a, b) => a.trueNetProfit - b.trueNetProfit)[0];
    recos.push({
      type: 'warn',
      icon: '📊',
      title: `Monitor: ${worstProfit.sku_id}`,
      body: `<strong>${worstProfit.nama_produk}</strong> memiliki profit terendah dalam filter saat ini: <strong>${formatRp(worstProfit.trueNetProfit)}</strong>. Net margin: <strong>${worstProfit.netMargin.toFixed(1)}%</strong>. Perlu review biaya dan harga jual.`,
      action: '→ Review Strategi Harga',
    });
  }

  if (!starSku && skus.length) {
    const bestMargin = skus.slice().sort((a, b) => b.netMargin - a.netMargin)[0];
    recos.push({
      type: 'star',
      icon: '📈',
      title: `Potensi Terbaik: ${bestMargin.sku_id}`,
      body: `<strong>${bestMargin.nama_produk}</strong> punya margin tertinggi dalam filter ini: <strong>${bestMargin.netMargin.toFixed(1)}%</strong>. Fokuskan upaya ke produk ini untuk memaksimalkan cuan.`,
      action: '→ Prioritaskan Stok & Promosi',
    });
  }

  return recos.slice(0, 3);
}

/* ============================================================
   8. AUDIT TABLE — Unified single-mode with search, sort, pagination, modal
   ============================================================ */

/* ---- Internal state ---- */
let atPage      = 1;
const AT_PAGE_SIZE = 5;
let atSearch    = '';
let atSortCol   = '';     // column key
let atSortDir   = 'asc';  // 'asc' | 'desc'

/* Boot: wire up search + sort headers */
function initAuditTable() {
  const searchEl = document.getElementById('auditSearch');
  if (searchEl) {
    searchEl.addEventListener('input', e => {
      atSearch = e.target.value.trim().toLowerCase();
      atPage   = 1;
      renderTable();
    });
  }
  document.querySelectorAll('.at-th-sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (atSortCol === col) {
        atSortDir = atSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        atSortCol = col;
        atSortDir = 'asc';
      }
      atPage = 1;
      renderTable();
    });
  });
  // Pagination buttons
  document.getElementById('atPrevBtn').addEventListener('click', () => { atPage--; renderTable(); });
  document.getElementById('atNextBtn').addEventListener('click', () => { atPage++; renderTable(); });
  // Modal close
  document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
  document.getElementById('trxModalBackdrop').addEventListener('click', e => {
    if (e.target === document.getElementById('trxModalBackdrop')) closeModal();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}

/* Called from renderDashboard; also called on search/sort/page changes */
function renderTable(rows, skus) {
  // If called from renderDashboard with args, store rows; otherwise re-use current
  if (rows !== undefined) {
    renderTable._rows = rows;
  }
  const baseRows = renderTable._rows || [];
  renderAuditTable(baseRows);
}
renderTable._rows = [];

/* ---- Main render ---- */
function renderAuditTable(baseRows) {
  // 1. Build enriched rows with computed fields
  const enriched = baseRows.map(r => {
    const c = calcRow(r);
    // Per-row SKU status: classify by this single row's metrics
    let status;
    if (c.netMargin >= 25 && c.returnRate < 8)                                     status = 'Star Profit';
    else if (c.trueNetProfit <= 0 || c.netMargin < 10 || c.returnRate >= 15)       status = 'Profit Bleeder';
    else                                                                            status = 'Watchlist';
    return { ...r, ...c, status };
  });

  // 2. Filter by search query
  const filtered = atSearch
    ? enriched.filter(r =>
        r.nama_produk.toLowerCase().includes(atSearch)     ||
        r.sku_id.toLowerCase().includes(atSearch)          ||
        r.id_transaksi.toLowerCase().includes(atSearch)    ||
        r.channel_penjualan.toLowerCase().includes(atSearch)
      )
    : enriched;

  // 3. Sort
  if (atSortCol) {
    filtered.sort((a, b) => {
      let va = a[atSortCol], vb = b[atSortCol];
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return atSortDir === 'asc' ? -1 :  1;
      if (va > vb) return atSortDir === 'asc' ?  1 : -1;
      return 0;
    });
  }

  // Update sort header indicators
  document.querySelectorAll('.at-th-sortable').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.col === atSortCol) {
      th.classList.add(atSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
    }
    th.setAttribute('aria-sort', th.dataset.col === atSortCol
      ? (atSortDir === 'asc' ? 'ascending' : 'descending') : 'none');
  });

  // 4. Pagination
  const total      = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / AT_PAGE_SIZE));
  if (atPage > totalPages) atPage = totalPages;
  const start  = (atPage - 1) * AT_PAGE_SIZE;
  const end    = Math.min(start + AT_PAGE_SIZE, total);
  const paged  = filtered.slice(start, end);

  // 5. Count badge
  document.getElementById('auditCountBadge').textContent = `${total} Transaksi`;

  // 6. Empty state
  const tbody  = document.getElementById('atBody');
  const emptyEl = document.getElementById('atEmpty');
  tbody.innerHTML = '';
  if (!paged.length) {
    emptyEl.classList.remove('hidden');
    // Pagination
    updatePagination(start, end, total, totalPages);
    return;
  }
  emptyEl.classList.add('hidden');

  // 7. Render rows
  paged.forEach(r => {
    const tr = document.createElement('tr');
    tr.className = 'at-tr' + (r._simulated ? ' at-sim' : '');

    // Col 1: Produk & Transaksi
    const simTag = r._simulated ? ' <span class="at-badge at-badge-sim">SIM</span>' : '';
    const col1 = `
      <td class="at-td">
        <div class="at-prod-name">${escHtml(r.nama_produk)}${simTag}</div>
        <div class="at-prod-meta">${escHtml(r.sku_id)} · ${escHtml(r.id_transaksi)}</div>
      </td>`;

    // Col 2: True Net Profit
    const profitClass = r.trueNetProfit >= 0 ? 'pos' : 'neg';
    const col2 = `
      <td class="at-td">
        <div class="at-profit-amt ${profitClass}">${formatRp(r.trueNetProfit)}</div>
        <div class="at-profit-omzet">Omzet: ${formatRp(r.grossRevenue)}</div>
      </td>`;

    // Col 3: Status & Channel
    const statusBadgeHtml = atStatusBadge(r.status);
    const channelBadgeHtml = atChannelBadge(r.channel_penjualan);
    const col3 = `
      <td class="at-td at-col-status">
        <div class="at-badges">${statusBadgeHtml}${channelBadgeHtml}</div>
      </td>`;

    // Col 4: Net Margin bar
    const marginPct    = r.netMargin;
    const barW         = Math.max(0, Math.min(100, marginPct)).toFixed(1);
    const fillClass    = marginPct >= 25 ? 'high' : marginPct >= 15 ? 'med' : marginPct >= 0 ? 'low' : 'neg';
    const absBarW      = Math.max(0, Math.min(100, Math.abs(marginPct))).toFixed(1);
    const col4 = `
      <td class="at-td at-col-margin">
        <div class="at-margin-wrap">
          <div class="at-margin-track">
            <div class="at-margin-fill ${fillClass}" style="width:${absBarW}%"></div>
          </div>
          <span class="at-margin-pct">${marginPct.toFixed(1)}%</span>
        </div>
      </td>`;

    // Col 5: Dot button — store row index in dataset
    const col5 = `
      <td class="at-td" style="text-align:center">
        <button class="at-dot-btn" data-trx="${escHtml(r.id_transaksi)}"
          aria-label="Detail ${escHtml(r.id_transaksi)}" title="Lihat detail">⋮</button>
      </td>`;

    tr.innerHTML = col1 + col2 + col3 + col4 + col5;
    tbody.appendChild(tr);
  });

  // Wire dot buttons
  tbody.querySelectorAll('.at-dot-btn').forEach(btn => {
    btn.addEventListener('click', () => openModal(btn.dataset.trx));
  });

  // 8. Pagination controls
  updatePagination(start, end, total, totalPages);
}

function updatePagination(start, end, total, totalPages) {
  document.getElementById('atPrevBtn').disabled = (atPage <= 1);
  document.getElementById('atNextBtn').disabled = (atPage >= totalPages);
  const dispStart = total === 0 ? 0 : start + 1;
  document.getElementById('auditPageInfo').textContent =
    `Menampilkan ${dispStart}–${end} dari ${total} transaksi (Halaman ${atPage} dari ${totalPages})`;
}

/* ---- Badge helpers ---- */
function atStatusBadge(status) {
  if (status === 'Star Profit')    return '<span class="at-badge at-badge-star">⭐ Star Profit</span>';
  if (status === 'Profit Bleeder') return '<span class="at-badge at-badge-bleed">🩸 Bleeder</span>';
  return '<span class="at-badge at-badge-watch">👀 Watchlist</span>';
}

function atChannelBadge(channel) {
  const map = {
    'Shopee':          'at-badge-channel-shopee',
    'TikTok Shop':     'at-badge-channel-tiktok',
    'Tokopedia':       'at-badge-channel-tokped',
    'Instagram Shop':  'at-badge-channel-ig',
  };
  const cls = map[channel] || 'at-badge-channel-default';
  return `<span class="at-badge ${cls}">${escHtml(channel)}</span>`;
}

function statusBadge(status) {
  /* legacy - kept for Simulasi panel preview compatibility */
  if (status === 'Star Profit')    return '<span class="badge badge-star">⭐ Star Profit</span>';
  if (status === 'Profit Bleeder') return '<span class="badge badge-bleed">🩸 Profit Bleeder</span>';
  return '<span class="badge badge-watch">👀 Watchlist</span>';
}

/* ---- Modal ---- */
function openModal(trxId) {
  // Find the raw row + compute metrics
  const allData = [...(renderTable._rows || [])];
  const r = allData.find(row => row.id_transaksi === trxId);
  if (!r) return;
  const c = calcRow(r);
  let status;
  if (c.netMargin >= 25 && c.returnRate < 8)                               status = 'Star Profit';
  else if (c.trueNetProfit <= 0 || c.netMargin < 10 || c.returnRate >= 15) status = 'Profit Bleeder';
  else                                                                      status = 'Watchlist';

  const profitColor = c.trueNetProfit >= 0 ? '#047857' : '#DC2626';
  const marginColor = c.netMargin >= 15 ? '#047857' : '#DC2626';

  document.getElementById('modalBody').innerHTML = `
    <!-- HEADER GROUP -->
    <h2 class="modal-prod-title" id="modalTitle">${escHtml(r.nama_produk)}</h2>
    <div class="modal-meta-row">
      ${atStatusBadge(status)}
      ${atChannelBadge(r.channel_penjualan)}
      <span class="at-badge at-badge-channel-default">${escHtml(r.kategori)}</span>
      <span class="at-badge at-badge-channel-default">${escHtml(r.tipe_bisnis)}</span>
    </div>
    <div class="modal-section">
      <div class="modal-section-label">Identitas Transaksi</div>
      <div class="modal-grid">
        <div class="modal-field">
          <span class="modal-field-label">ID Transaksi</span>
          <span class="modal-field-val">${escHtml(r.id_transaksi)}</span>
        </div>
        <div class="modal-field">
          <span class="modal-field-label">Tanggal</span>
          <span class="modal-field-val">${escHtml(r.tanggal)}</span>
        </div>
        <div class="modal-field">
          <span class="modal-field-label">SKU ID</span>
          <span class="modal-field-val">${escHtml(r.sku_id)}</span>
        </div>
        <div class="modal-field">
          <span class="modal-field-label">Channel Penjualan</span>
          <span class="modal-field-val">${escHtml(r.channel_penjualan)}</span>
        </div>
      </div>
    </div>

    <!-- RINCIAN PENJUALAN -->
    <div class="modal-section">
      <div class="modal-section-label">Rincian Penjualan &amp; Modal</div>
      <div class="modal-grid">
        <div class="modal-field">
          <span class="modal-field-label">Harga Jual / Unit</span>
          <span class="modal-field-val">${formatRpFull(r.harga_jual)}</span>
        </div>
        <div class="modal-field">
          <span class="modal-field-label">HPP / Unit</span>
          <span class="modal-field-val">${formatRpFull(r.hpp_per_unit)}</span>
        </div>
        <div class="modal-field">
          <span class="modal-field-label">Unit Terjual</span>
          <span class="modal-field-val">${r.unit_terjual} unit</span>
        </div>
        <div class="modal-field">
          <span class="modal-field-label">Gross Revenue</span>
          <span class="modal-field-val">${formatRpFull(c.grossRevenue)}</span>
        </div>
        <div class="modal-field">
          <span class="modal-field-label">Total HPP</span>
          <span class="modal-field-val">${formatRpFull(c.totalHPP)}</span>
        </div>
      </div>
    </div>

    <!-- BIAYA IKLAN & RETUR -->
    <div class="modal-section">
      <div class="modal-section-label">Audit Biaya Iklan &amp; Retur</div>
      <div class="modal-grid">
        <div class="modal-field">
          <span class="modal-field-label">Biaya Iklan</span>
          <span class="modal-field-val">${formatRpFull(r.biaya_iklan)}</span>
        </div>
        <div class="modal-field">
          <span class="modal-field-label">Rasio Iklan</span>
          <span class="modal-field-val">${c.adSpendRatio.toFixed(1)}%</span>
        </div>
        <div class="modal-field">
          <span class="modal-field-label">Unit Retur</span>
          <span class="modal-field-val">${r.unit_retur} unit</span>
        </div>
        <div class="modal-field">
          <span class="modal-field-label">Return Rate</span>
          <span class="modal-field-val ${c.returnRate >= 15 ? 'neg' : ''}">${c.returnRate.toFixed(1)}%</span>
        </div>
        <div class="modal-field">
          <span class="modal-field-label">Kerugian Retur</span>
          <span class="modal-field-val neg">${formatRpFull(c.returnLoss)}</span>
        </div>
        <div class="modal-field">
          <span class="modal-field-label">Alasan Retur Utama</span>
          <span class="modal-alasan-pill">💬 ${escHtml(r.alasan_retur_utama)}</span>
        </div>
      </div>
    </div>

    <!-- HASIL AKHIR -->
    <div class="modal-section">
      <div class="modal-section-label">Hasil Akhir</div>
      <div class="modal-profit-callout">
        <div>
          <div class="mpc-label">True Net Profit</div>
          <div class="mpc-val" style="color:${profitColor}">${formatRpFull(c.trueNetProfit)}</div>
        </div>
        <div>
          <div class="mpc-label">Net Margin</div>
          <div class="mpc-val" style="color:${marginColor}">${c.netMargin.toFixed(1)}%</div>
        </div>
      </div>
    </div>
  `;

  const backdrop = document.getElementById('trxModalBackdrop');
  backdrop.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  document.getElementById('modalCloseBtn').focus();
}

function closeModal() {
  document.getElementById('trxModalBackdrop').classList.add('hidden');
  document.body.style.overflow = '';
}

/* ---- HTML escape helper ---- */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ============================================================
   9. SIMULASI PANEL
   ============================================================ */
function toggleSimPanel() {
  const panel = document.getElementById('simulasiPanel');
  const isHidden = panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !isHidden);
  const btn = document.getElementById('toggleSimBtn');
  btn.textContent = isHidden ? '✕ Tutup Simulasi' : '+ Simulasi Produk';
  if (isHidden) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function handleSimSubmit(e) {
  e.preventDefault();
  const nama     = document.getElementById('simNama').value.trim();
  const kategori = document.getElementById('simKategori').value;
  const tipe     = document.getElementById('simTipe').value;
  const channel  = document.getElementById('simChannel').value;
  const harga    = parseFloat(document.getElementById('simHarga').value) || 0;
  const hpp      = parseFloat(document.getElementById('simHpp').value)   || 0;
  const unit     = parseFloat(document.getElementById('simUnit').value)  || 0;
  const iklan    = parseFloat(document.getElementById('simIklan').value) || 0;
  const retur    = parseFloat(document.getElementById('simRetur').value) || 0;
  const alasan   = document.getElementById('simAlasan').value.trim() || 'Tidak ada retur';

  if (!nama || harga <= 0 || unit <= 0) {
    alert('Mohon isi Nama Produk, Harga Jual (> 0), dan Unit Terjual (> 0) terlebih dahulu.');
    return;
  }

  simRow = {
    id_transaksi: 'SIM-001',
    tanggal: new Date().toISOString().split('T')[0],
    sku_id: 'SKU-SIM',
    nama_produk: nama,
    kategori,
    tipe_bisnis: tipe,
    channel_penjualan: channel,
    harga_jual: harga,
    hpp_per_unit: hpp,
    unit_terjual: unit,
    biaya_iklan: iklan,
    unit_retur: retur,
    alasan_retur_utama: alasan,
    _simulated: true,
  };

  // Show preview
  const c = calcRow(simRow);
  const preview = document.getElementById('simPreview');
  preview.classList.remove('hidden');
  preview.innerHTML = `
    <strong>🧪 Hasil Simulasi "${nama}"</strong><br>
    Gross Revenue: <strong>${formatRp(c.grossRevenue)}</strong> &nbsp;|&nbsp;
    Total HPP: <strong>${formatRp(c.totalHPP)}</strong> &nbsp;|&nbsp;
    Return Loss: <strong>${formatRp(c.returnLoss)}</strong><br>
    <strong>True Net Profit: ${formatRp(c.trueNetProfit)}</strong> &nbsp;|&nbsp;
    Net Margin: <strong>${c.netMargin.toFixed(1)}%</strong> &nbsp;|&nbsp;
    Return Rate: <strong>${c.returnRate.toFixed(1)}%</strong><br>
    Ad Spend Ratio: <strong>${c.adSpendRatio.toFixed(1)}%</strong>
  `;

  document.getElementById('simRemoveBtn').style.display = 'inline-flex';
  renderDashboard();
}

function removeSimRow() {
  simRow = null;
  document.getElementById('simRemoveBtn').style.display = 'none';
  document.getElementById('simPreview').classList.add('hidden');
  document.getElementById('simForm').reset();
  renderDashboard();
}

/* ============================================================
   FORMATTERS
   ============================================================ */
function formatRp(val) {
  const abs   = Math.abs(val);
  const sign  = val < 0 ? '-' : '';
  let formatted;
  if (abs >= 1_000_000_000) {
    formatted = (abs / 1_000_000_000).toFixed(1).replace('.', ',') + 'M';
    return sign + 'Rp ' + formatted;
  }
  if (abs >= 1_000_000) {
    formatted = (abs / 1_000_000).toFixed(1).replace('.', ',') + 'jt';
    return sign + 'Rp ' + formatted;
  }
  if (abs >= 1_000) {
    formatted = (abs / 1_000).toFixed(0) + 'rb';
    return sign + 'Rp ' + formatted;
  }
  return sign + 'Rp ' + abs.toLocaleString('id-ID');
}
