const intelConnectionEl = document.querySelector('[data-connection-id]');
const intelConnId = intelConnectionEl?.getAttribute('data-connection-id');

if (intelConnId) {
  let activeSort = 'IMPRESSION';
  let activeDays = 30;
  let searchQuery = '';
  let searchTimeout: any = null;
  let hasLoadedIntel = false;

  const tbody = document.getElementById('intel-leaderboard-tbody');
  const drawer = document.getElementById('intel-timeline-drawer');
  const drawerBackdrop = document.getElementById('intel-drawer-backdrop');
  const drawerCloseBtn = document.getElementById('intel-drawer-close');

  function formatNumber(num: number): string {
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
    if (num >= 1_000) return (num / 1_000).toFixed(1) + 'k';
    return Number(num || 0).toLocaleString();
  }

  function renderTrendBadge(trend: string): string {
    if (trend.startsWith('▲')) {
      return `<span class="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">${trend}</span>`;
    }
    if (trend.startsWith('▼')) {
      return `<span class="inline-flex items-center gap-0.5 rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-bold text-rose-600 dark:text-rose-400 border border-rose-500/20">${trend}</span>`;
    }
    if (trend === 'NEW') {
      return `<span class="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary border border-primary/20">NEW</span>`;
    }
    return `<span class="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">▬</span>`;
  }

  async function loadPinLeaderboard() {
    if (!tbody) return;

    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="py-12 text-center text-muted-foreground">
          <div class="inline-flex items-center gap-2 text-xs font-semibold">
            <svg class="animate-spin h-4 w-4 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
            </svg>
            <span>Loading ${activeSort.toLowerCase()} leaderboard...</span>
          </div>
        </td>
      </tr>
    `;

    try {
      let url = `/api/analytics/connections/${intelConnId}/pin-leaderboard?sort_by=${activeSort}&days=${activeDays}&limit=50`;
      if (searchQuery) {
        url += `&q=${encodeURIComponent(searchQuery)}`;
      }

      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Failed to load leaderboard`);
      }

      const json = await res.json();
      const items = json.data || [];

      if (items.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="8" class="py-12 text-center text-muted-foreground">
              <div class="flex flex-col items-center justify-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-muted-foreground/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/></svg>
                <p class="text-xs font-medium">No pins found for ${activeSort} in the last ${activeDays} days.</p>
                <p class="text-[11px] text-muted-foreground/70">Try changing sort mode or expanding date range.</p>
              </div>
            </td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = items.map((item: any, idx: number) => {
        const titleText = item.title || `Pin #${item.pin_id}`;
        const pinIdShort = String(item.pin_id);
        const pLink = item.destination_url || `https://www.pinterest.com/pin/${item.pin_id}/`;
        
        return `
          <tr class="hover:bg-muted/30 transition-colors cursor-pointer group" data-pin-id="${item.pin_id}" data-pin-json='${encodeURIComponent(JSON.stringify(item))}'>
            <td class="py-3 px-4 text-center font-bold text-muted-foreground w-12">
              <span class="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs ${idx < 3 ? 'bg-primary/10 text-primary font-black' : 'text-muted-foreground'}">
                ${idx + 1}
              </span>
            </td>
            <td class="py-3 px-4 min-w-[260px]">
              <div class="flex items-center gap-3">
                ${item.image_url 
                  ? `<img src="${item.image_url}" alt="" class="w-9 h-9 rounded-lg object-cover border border-border bg-muted shrink-0" loading="lazy" />` 
                  : `<div class="w-9 h-9 rounded-lg bg-muted border border-border flex items-center justify-center text-muted-foreground text-xs shrink-0 font-bold">📌</div>`
                }
                <div class="min-w-0 flex-1">
                  <div class="font-semibold text-foreground truncate text-xs group-hover:text-primary transition-colors" title="${titleText}">
                    ${titleText}
                  </div>
                  <div class="flex items-center gap-2 mt-0.5">
                    <span class="font-mono text-[10px] text-muted-foreground/80">ID: ${pinIdShort}</span>
                    <a href="${pLink}" target="_blank" rel="noopener noreferrer" class="text-[10px] text-primary/80 hover:text-primary hover:underline flex items-center gap-0.5" onclick="event.stopPropagation()">
                      <span>Link</span>
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    </a>
                  </div>
                </div>
              </div>
            </td>
            <td class="py-3 px-4 text-center font-semibold text-foreground">
              <span class="rounded-md bg-muted px-2 py-0.5 text-xs">${item.appearances}</span>
            </td>
            <td class="py-3 px-4 text-center font-bold text-foreground">
              #${item.best_rank}
            </td>
            <td class="py-3 px-4 text-right font-semibold text-foreground">
              ${formatNumber(item.total_impressions)}
            </td>
            <td class="py-3 px-4 text-right font-semibold text-foreground">
              ${formatNumber(item.total_saves)}
            </td>
            <td class="py-3 px-4 text-right font-mono text-[11px] text-muted-foreground">
              ${item.last_seen || '—'}
            </td>
            <td class="py-3 px-4 text-center">
              ${renderTrendBadge(item.trend)}
            </td>
          </tr>
        `;
      }).join('');

      // Bind row clicks to open timeline drawer
      tbody.querySelectorAll('tr[data-pin-json]').forEach(row => {
        row.addEventListener('click', () => {
          const raw = row.getAttribute('data-pin-json');
          if (raw) {
            try {
              const item = JSON.parse(decodeURIComponent(raw));
              openTimelineDrawer(item);
            } catch (e) {
              console.error('Failed to parse pin item', e);
            }
          }
        });
      });

    } catch (err: any) {
      console.error('[PinIntelligence] Failed to load leaderboard:', err);
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="py-12 text-center text-rose-500 font-semibold text-xs">
            ${err.message || 'Error loading pin leaderboard.'}
          </td>
        </tr>
      `;
    }
  }

  // Draw Timeline Sparkline SVG
  function generateSparklineSvg(dataPoints: number[], width = 400, height = 80): string {
    if (!dataPoints || dataPoints.length === 0) return '';
    if (dataPoints.length === 1) {
      return `<svg viewBox="0 0 ${width} ${height}" class="w-full h-full"><line x1="0" y1="${height/2}" x2="${width}" y2="${height/2}" stroke="#6366f1" stroke-width="2" stroke-dasharray="4" /></svg>`;
    }

    const min = Math.min(...dataPoints);
    const max = Math.max(...dataPoints);
    const range = max - min || 1;
    const padding = 10;
    const effectiveHeight = height - padding * 2;

    const points = dataPoints.map((val, idx) => {
      const x = (idx / (dataPoints.length - 1)) * (width - 20) + 10;
      const y = height - padding - ((val - min) / range) * effectiveHeight;
      return { x, y, val };
    });

    const polylinePoints = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const polygonPoints = `10,${height} ${polylinePoints} ${width - 10},${height}`;

    const circles = points.map(p => `
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" class="fill-primary stroke-background" stroke-width="2">
        <title>${p.val.toLocaleString()}</title>
      </circle>
    `).join('');

    return `
      <svg viewBox="0 0 ${width} ${height}" class="w-full h-20 overflow-visible" preserveAspectRatio="none">
        <defs>
          <linearGradient id="sparkline-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--color-primary, #6366f1)" stop-opacity="0.35" />
            <stop offset="100%" stop-color="var(--color-primary, #6366f1)" stop-opacity="0.0" />
          </linearGradient>
        </defs>
        <polygon points="${polygonPoints}" fill="url(#sparkline-gradient)" />
        <polyline points="${polylinePoints}" fill="none" stroke="currentColor" class="text-primary" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
        ${circles}
      </svg>
    `;
  }

  async function openTimelineDrawer(item: any) {
    if (!drawer) return;

    // Populate drawer header
    const titleEl = document.getElementById('drawer-pin-title');
    const idEl = document.getElementById('drawer-pin-id');
    const imgEl = document.getElementById('drawer-pin-image') as HTMLImageElement;
    const linkEl = document.getElementById('drawer-pin-link') as HTMLAnchorElement;
    const bestRankEl = document.getElementById('drawer-best-rank');
    const totalImprEl = document.getElementById('drawer-total-impr');
    const totalSavesEl = document.getElementById('drawer-total-saves');
    const appearancesEl = document.getElementById('drawer-appearances');
    const sparklineEl = document.getElementById('drawer-sparkline-container');
    const historyTbody = document.getElementById('drawer-history-tbody');

    if (titleEl) titleEl.textContent = item.title || `Pin #${item.pin_id}`;
    if (idEl) idEl.textContent = item.pin_id;
    if (bestRankEl) bestRankEl.textContent = `#${item.best_rank}`;
    if (totalImprEl) totalImprEl.textContent = Number(item.total_impressions || 0).toLocaleString();
    if (totalSavesEl) totalSavesEl.textContent = Number(item.total_saves || 0).toLocaleString();
    if (appearancesEl) appearancesEl.textContent = String(item.appearances || 0);

    const pLink = item.destination_url || `https://www.pinterest.com/pin/${item.pin_id}/`;
    if (linkEl) linkEl.href = pLink;

    if (imgEl) {
      if (item.image_url) {
        imgEl.src = item.image_url;
        imgEl.classList.remove('hidden');
      } else {
        imgEl.classList.add('hidden');
      }
    }

    if (sparklineEl) {
      sparklineEl.innerHTML = '<div class="py-6 text-center text-xs text-muted-foreground animate-pulse">Loading trend curve...</div>';
    }

    if (historyTbody) {
      historyTbody.innerHTML = '<tr><td colspan="5" class="py-6 text-center text-xs text-muted-foreground">Loading timeline history...</td></tr>';
    }

    // Open drawer
    drawer.classList.remove('translate-x-full');
    drawer.classList.add('translate-x-0');
    if (drawerBackdrop) {
      drawerBackdrop.classList.remove('opacity-0', 'pointer-events-none');
      drawerBackdrop.classList.add('opacity-100', 'pointer-events-auto');
    }

    try {
      const res = await fetch(`/api/analytics/connections/${intelConnId}/pin-trends?pin_id=${item.pin_id}&sort_by=${activeSort}&days=90`);
      if (!res.ok) throw new Error('Failed to fetch pin trends');
      const json = await res.json();
      const points = json.data || [];

      if (points.length === 0) {
        if (sparklineEl) sparklineEl.innerHTML = '<p class="py-4 text-center text-xs text-muted-foreground">No historical data points available.</p>';
        if (historyTbody) historyTbody.innerHTML = '<tr><td colspan="5" class="py-4 text-center text-xs text-muted-foreground">No history records found.</td></tr>';
        return;
      }

      // Render sparkline
      const metricValues = points.map((p: any) => {
        if (activeSort === 'OUTBOUND_CLICK') return p.outbound_clicks;
        if (activeSort === 'SAVE') return p.saves;
        if (activeSort === 'ENGAGEMENT') return p.engagements;
        if (activeSort === 'PIN_CLICK') return p.pin_clicks;
        return p.impressions;
      });

      if (sparklineEl) {
        sparklineEl.innerHTML = generateSparklineSvg(metricValues);
      }

      // Render history table (descending by date)
      const sortedHistory = [...points].reverse();
      if (historyTbody) {
        historyTbody.innerHTML = sortedHistory.map((p: any) => {
          const ratePercent = (p.engagement_rate * 100).toFixed(2);
          return `
            <tr class="hover:bg-muted/20 border-b border-border/50 text-xs">
              <td class="py-2.5 px-3 font-mono text-muted-foreground">${p.window_end}</td>
              <td class="py-2.5 px-3 font-bold text-center">#${p.rank_position}</td>
              <td class="py-2.5 px-3 text-right font-semibold">${Number(p.impressions).toLocaleString()}</td>
              <td class="py-2.5 px-3 text-right">
                <span class="font-semibold">${Number(p.engagements).toLocaleString()}</span>
                <span class="text-[10px] text-muted-foreground block font-mono">(${ratePercent}%)</span>
              </td>
              <td class="py-2.5 px-3 text-right font-semibold">${Number(p.saves).toLocaleString()}</td>
            </tr>
          `;
        }).join('');
      }

    } catch (e: any) {
      if (sparklineEl) sparklineEl.innerHTML = '<p class="py-4 text-center text-xs text-rose-500">Failed to render sparkline</p>';
      if (historyTbody) historyTbody.innerHTML = `<tr><td colspan="5" class="py-4 text-center text-xs text-rose-500">${e.message}</td></tr>`;
    }
  }

  function closeTimelineDrawer() {
    if (!drawer) return;
    drawer.classList.remove('translate-x-0');
    drawer.classList.add('translate-x-full');
    if (drawerBackdrop) {
      drawerBackdrop.classList.remove('opacity-100', 'pointer-events-auto');
      drawerBackdrop.classList.add('opacity-0', 'pointer-events-none');
    }
  }

  // Bind close buttons
  drawerCloseBtn?.addEventListener('click', closeTimelineDrawer);
  drawerBackdrop?.addEventListener('click', closeTimelineDrawer);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeTimelineDrawer();
  });

  // Bind Sort Mode tabs
  document.querySelectorAll('#intel-sort-tabs button[data-intel-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#intel-sort-tabs button[data-intel-sort]').forEach(b => {
        b.className = 'mode-tab rounded-lg px-3 py-1 text-xs font-semibold text-muted-foreground transition-all hover:text-foreground';
      });
      btn.className = 'mode-tab active rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-sm transition-all';
      activeSort = btn.getAttribute('data-intel-sort') || 'IMPRESSION';
      loadPinLeaderboard();
    });
  });

  // Bind Range presets
  document.querySelectorAll('#intel-range-presets button[data-intel-days]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#intel-range-presets button[data-intel-days]').forEach(b => {
        b.className = 'preset-btn rounded-lg px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-all';
      });
      btn.className = 'preset-btn active rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground shadow-sm transition-all';
      activeDays = parseInt(btn.getAttribute('data-intel-days') || '30', 10);
      loadPinLeaderboard();
    });
  });

  // Bind Search box
  const searchInput = document.getElementById('intel-search') as HTMLInputElement;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        searchQuery = searchInput.value.trim();
        loadPinLeaderboard();
      }, 300);
    });
  }

  // Load when intelligence tab is opened
  document.querySelectorAll('[role="tab"]').forEach(tab => {
    tab.addEventListener('click', () => {
      if (tab.getAttribute('data-tab') === 'intelligence' && !hasLoadedIntel) {
        hasLoadedIntel = true;
        loadPinLeaderboard();
      }
    });
  });

  if (window.location.hash === '#intelligence' || window.location.hash === '#intel') {
    hasLoadedIntel = true;
    loadPinLeaderboard();
  }
}
