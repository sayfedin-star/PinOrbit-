const connectionEl = document.querySelector('[data-connection-id]');
const connectionId = connectionEl?.getAttribute('data-connection-id');
if (!connectionId) throw new Error('Missing connectionId');

const FALLBACK_IMG = '/placeholder-pin.jpg';

function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function formatNum(n: number) { return new Intl.NumberFormat('en-US').format(n || 0); }
function formatPct(n: number) { return new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }

const asText   = (v: any, d = '')  => (typeof v === 'string' ? v : v == null ? d : String(v));
const asStatus = (v: any)          => { const s = typeof v === 'string' && v ? v : 'READY'; return s.toUpperCase(); };
const asNumber = (v: any)          => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function getStatusBadge(status: any) {
  const s = asStatus(status);
  if (s === 'READY') return '<span class="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-500">READY</span>';
  return `<span class="rounded bg-yellow-500/10 px-1.5 py-0.5 text-[9px] font-bold text-yellow-600">${s}</span>`;
}

// State
const state = {
  s1Page: 1,
  s1Size: 25,
  s1Sort: 'metric_date',
  s1Desc: true,
  
  s2Page: 1,
  s2Size: 25,
  s2Mode: 'IMPRESSION',
  s2Query: '',
  
  from: '',
  to: '',
  tab: 'data'
};

// URL Sync
function syncStateToUrl() {
  const p = new URLSearchParams();
  if (state.s1Page > 1) p.set('s1_page', String(state.s1Page));
  if (state.s1Size !== 25) p.set('s1_ps', String(state.s1Size));
  if (state.s1Sort !== 'metric_date') p.set('s1_sort', state.s1Sort);
  if (!state.s1Desc) p.set('s1_dir', 'asc');

  if (state.s2Page > 1) p.set('s2_page', String(state.s2Page));
  if (state.s2Size !== 25) p.set('s2_ps', String(state.s2Size));
  if (state.s2Mode !== 'IMPRESSION') p.set('sort_by', state.s2Mode);
  if (state.s2Query) p.set('s2_q', state.s2Query);
  
  if (state.from) p.set('from', state.from);
  if (state.to) p.set('to', state.to);
  if (state.tab !== 'data') p.set('tab', state.tab);
  
  window.history.replaceState(null, '', '?' + p.toString() + window.location.hash);
}

function loadStateFromUrl() {
  const p = new URLSearchParams(window.location.search);
  state.s1Page = Number(p.get('s1_page')) || 1;
  state.s1Size = Number(p.get('s1_ps')) || 25;
  state.s1Sort = p.get('s1_sort') || 'metric_date';
  state.s1Desc = p.get('s1_dir') !== 'asc';

  state.s2Page = Number(p.get('s2_page')) || 1;
  state.s2Size = Number(p.get('s2_ps')) || 25;
  state.s2Mode = p.get('sort_by') || 'IMPRESSION';
  state.s2Query = p.get('s2_q') || '';
  
  state.from = p.get('from') || '';
  state.to = p.get('to') || '';
  state.tab = p.get('tab') || 'data';

  // Update UI inputs
  (document.getElementById('s1-ps') as HTMLSelectElement).value = String(state.s1Size);
  (document.getElementById('s2-ps') as HTMLSelectElement).value = String(state.s2Size);
  (document.getElementById('s2-q') as HTMLInputElement).value = state.s2Query;
  
  if (state.from) (document.getElementById('from-date-input') as HTMLInputElement).value = state.from;
  if (state.to) (document.getElementById('to-date-input') as HTMLInputElement).value = state.to;

  document.querySelectorAll('#top-pins-sort-tabs .mode-tab').forEach(b => {
    if (b.getAttribute('data-mode') === state.s2Mode) {
      b.className = 'mode-tab active rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-sm transition-all';
    } else {
      b.className = 'mode-tab rounded-lg px-3 py-1 text-xs font-semibold text-muted-foreground transition-all hover:text-foreground';
    }
  });

  // Activate tab
  if (state.tab === 'pipeline') {
    document.getElementById('tab-pipe')?.click();
  }
}

async function safeFetch(url: string) {
  const res = await fetch(url);
  const contentType = res.headers.get('content-type');
  if (!res.ok || !contentType?.includes('application/json')) {
    let message = 'Unknown error';
    try {
      if (contentType?.includes('application/json')) {
        const err = await res.json();
        message = err.error || message;
      } else {
        message = await res.text();
      }
    } catch (e) {}
    throw new Error(`HTTP ${res.status}: ${message}`);
  }
  return res.json();
}

async function renderS1() {
  const tbody = document.getElementById('daily-metrics-tbody')!;
  tbody.innerHTML = `<tr><td colspan="6" class="py-12 text-center text-muted-foreground">Loading daily metrics...</td></tr>`;
  syncStateToUrl();

  document.querySelectorAll('[data-s1-sort]').forEach(th => {
    const s = th.getAttribute('data-s1-sort');
    th.querySelector('.sort-icon')!.textContent = s === state.s1Sort ? (state.s1Desc ? '↓' : '↑') : '';
  });

  const url = new URL(`/api/analytics/connections/${connectionId}/daily`, window.location.origin);
  url.searchParams.set('page', String(state.s1Page));
  url.searchParams.set('page_size', String(state.s1Size));
  url.searchParams.set('sort', state.s1Sort);
  url.searchParams.set('dir', state.s1Desc ? 'desc' : 'asc');
  if (state.from) url.searchParams.set('from_date', state.from);
  if (state.to) url.searchParams.set('to_date', state.to);

  try {
    const { data } = await safeFetch(url.toString());
    const { rows, total, totals } = data;

    document.getElementById('s1-total')!.textContent = String(total);
    const maxPage = Math.ceil(total / state.s1Size) || 1;
    if (state.s1Page > maxPage && maxPage > 0) {
      state.s1Page = maxPage;
      return renderS1();
    }
    
    const start = (state.s1Page - 1) * state.s1Size;
    document.getElementById('s1-range')!.textContent = total > 0 ? `${start + 1}-${Math.min(start + state.s1Size, total)}` : '0-0';
    
    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="12" class="py-12 text-center text-muted-foreground">
        <p class="mb-2">No daily metrics found.</p>
        <button onclick="document.getElementById('tab-pipe')?.click()" class="text-primary hover:underline font-semibold">Go to Pipeline & Automation to Sync</button>
      </td></tr>`;
    } else {
      tbody.innerHTML = rows.map((d: any) => {
        try {
          return `
          <tr class="hover:bg-muted/10 transition-colors">
            <td class="py-2.5 px-4 font-mono font-medium">${escapeHtml(asText(d.metric_date))}</td>
            <td class="py-2.5 px-4 text-center">${getStatusBadge(d.data_status)}</td>
            <td class="py-2.5 px-4 text-right">${formatNum(asNumber(d.impressions))}</td>
            <td class="py-2.5 px-4 text-right">${formatNum(asNumber(d.engagements))}</td>
            <td class="py-2.5 px-4 text-right">${formatPct(asNumber(d.engagement_rate))}</td>
            <td class="py-2.5 px-4 text-right">${formatNum(asNumber(d.outbound_clicks))}</td>
            <td class="py-2.5 px-4 text-right">${formatPct(asNumber(d.outbound_click_rate))}</td>
            <td class="py-2.5 px-4 text-right">${formatNum(asNumber(d.pin_clicks))}</td>
            <td class="py-2.5 px-4 text-right">${formatPct(asNumber(d.pin_click_rate))}</td>
            <td class="py-2.5 px-4 text-right">${formatNum(asNumber(d.saves))}</td>
            <td class="py-2.5 px-4 text-right">${formatPct(asNumber(d.save_rate))}</td>
            <td class="py-2.5 px-4 text-center">
              <button class="text-red-500 hover:text-red-700 transition-colors" onclick="deleteDailyRecord('${escapeHtml(asText(d.metric_date))}')" title="Delete record">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
              </button>
            </td>
          </tr>`;
        } catch (err: any) {
          return `<tr><td colspan="12" class="py-2 px-4 bg-red-500/10 text-red-500 text-xs font-bold text-center">Row Error: ${escapeHtml(err.message)}</td></tr>`;
        }
      }).join('');
    }
    
    const pooledEr = totals.impressions ? totals.engagements / totals.impressions : 0;
    const pooledOcr = totals.impressions ? totals.outbound_clicks / totals.impressions : 0;
    const pooledPcr = totals.impressions ? totals.pin_clicks / totals.impressions : 0;
    const pooledSr = totals.impressions ? totals.saves / totals.impressions : 0;

    document.getElementById('daily-metrics-tfoot')!.innerHTML = `
      <tr>
        <td class="py-3 px-4">Totals (Filtered)</td>
        <td class="py-3 px-4 text-center">—</td>
        <td class="py-3 px-4 text-right">${formatNum(totals.impressions)}</td>
        <td class="py-3 px-4 text-right">${formatNum(totals.engagements)}</td>
        <td class="py-3 px-4 text-right">${formatPct(pooledEr)}</td>
        <td class="py-3 px-4 text-right">${formatNum(totals.outbound_clicks)}</td>
        <td class="py-3 px-4 text-right">${formatPct(pooledOcr)}</td>
        <td class="py-3 px-4 text-right">${formatNum(totals.pin_clicks)}</td>
        <td class="py-3 px-4 text-right">${formatPct(pooledPcr)}</td>
        <td class="py-3 px-4 text-right">${formatNum(totals.saves)}</td>
        <td class="py-3 px-4 text-right">${formatPct(pooledSr)}</td>
        <td class="py-3 px-4 text-center">—</td>
      </tr>
    `;
    
    const btnDiv = document.getElementById('s1-page-buttons')!;
    btnDiv.innerHTML = `
      <button class="px-2 py-1 rounded bg-muted/40 hover:bg-muted disabled:opacity-50" ${state.s1Page === 1 ? 'disabled' : ''} onclick="goS1(${state.s1Page - 1})">Prev</button>
      <button class="px-2 py-1 rounded bg-muted/40 hover:bg-muted disabled:opacity-50" ${state.s1Page >= maxPage ? 'disabled' : ''} onclick="goS1(${state.s1Page + 1})">Next</button>
    `;

  } catch (e: any) {
    tbody.innerHTML = `<tr><td colspan="6" class="py-12 text-center text-red-500">${escapeHtml(e.message)}</td></tr>`;
  }
}

async function renderS2() {
  const tbody = document.getElementById('top-pins-tbody')!;
  tbody.innerHTML = `<tr><td colspan="7" class="py-12 text-center text-muted-foreground">Loading top pins...</td></tr>`;
  syncStateToUrl();

  const url = new URL(`/api/analytics/connections/${connectionId}/top-pins`, window.location.origin);
  url.searchParams.set('sort_by', state.s2Mode);
  url.searchParams.set('page', String(state.s2Page));
  url.searchParams.set('page_size', String(state.s2Size));
  if (state.s2Query) url.searchParams.set('q', state.s2Query);
  if (state.from) url.searchParams.set('from_date', state.from);
  if (state.to) url.searchParams.set('to_date', state.to);

  try {
    const { data } = await safeFetch(url.toString());
    const { rows, total, window } = data;

    if (window) {
      document.getElementById('s2-window-badge')!.innerHTML = `
        <span class="rounded-full bg-muted/50 px-2 py-0.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
          Window: ${window.start.split('T')[0]} — ${window.end.split('T')[0]}
        </span>
      `;
    } else {
      document.getElementById('s2-window-badge')!.innerHTML = '';
    }

    document.getElementById('s2-total')!.textContent = String(total);
    const maxPage = Math.ceil(total / state.s2Size) || 1;
    if (state.s2Page > maxPage && maxPage > 0) {
      state.s2Page = maxPage;
      return renderS2();
    }
    
    const start = (state.s2Page - 1) * state.s2Size;
    document.getElementById('s2-range')!.textContent = total > 0 ? `${start + 1}-${Math.min(start + state.s2Size, total)}` : '0-0';
    
    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="py-12 text-center text-muted-foreground">
        <p class="mb-2">No top pins snapshots found.</p>
        <button onclick="document.getElementById('tab-pipe')?.click()" class="text-primary hover:underline font-semibold">Go to Pipeline & Automation to Sync</button>
      </td></tr>`;
    } else {
      tbody.innerHTML = rows.map((p: any) => {
        try {
          return `
          <tr class="hover:bg-muted/10 transition-colors">
            <td class="py-3 px-4 text-center font-bold text-muted-foreground">#${asNumber(p.rank_position)}</td>
            <td class="py-3 px-4">
              <div class="flex items-center gap-3">
                <div class="h-10 w-10 flex-shrink-0 overflow-hidden rounded-md border border-border bg-muted">
                  <img src="${escapeHtml(asText(p.image_url, FALLBACK_IMG))}" alt="Pin" class="h-full w-full object-cover" loading="lazy" />
                </div>
                <div class="min-w-0 max-w-[200px]">
                  <a href="https://pinterest.com/pin/${escapeHtml(asText(p.pin_id))}" target="_blank" rel="noopener noreferrer" class="block truncate font-semibold hover:text-primary transition-colors">
                    ${escapeHtml(asText(p.title)) || 'Untitled Pin / No Link'}
                  </a>
                  <div class="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                    <span class="truncate font-mono">${escapeHtml(asText(p.pin_id))}</span>
                    ${p.destination_url ? `<a href="${escapeHtml(asText(p.destination_url))}" target="_blank" rel="noopener noreferrer" class="hover:text-primary transition-colors">🔗 Link</a>` : ''}
                  </div>
                </div>
              </div>
            </td>
            <td class="py-3 px-4 text-center">${getStatusBadge(p.data_status)}</td>
            <td class="py-3 px-4 text-right font-medium">${formatNum(asNumber(p.impressions))}</td>
            <td class="py-3 px-4 text-right font-medium">${formatNum(asNumber(p.engagement))}</td>
            <td class="py-3 px-4 text-right font-medium">${formatPct(asNumber(p.engagement_rate))}</td>
            <td class="py-3 px-4 text-right font-medium">${formatNum(asNumber(p.outbound_clicks))}</td>
            <td class="py-3 px-4 text-right font-medium">${formatNum(asNumber(p.pin_clicks))}</td>
            <td class="py-3 px-4 text-right font-medium">${formatNum(asNumber(p.saves))}</td>
          </tr>`;
        } catch (err: any) {
          return `<tr><td colspan="9" class="py-2 px-4 bg-red-500/10 text-red-500 text-xs font-bold text-center">Row Error: ${escapeHtml(err.message)}</td></tr>`;
        }
      }).join('');
    }
    
    const btnDiv = document.getElementById('s2-page-buttons')!;
    btnDiv.innerHTML = `
      <button class="px-2 py-1 rounded bg-muted/40 hover:bg-muted disabled:opacity-50" ${state.s2Page === 1 ? 'disabled' : ''} onclick="goS2(${state.s2Page - 1})">Prev</button>
      <button class="px-2 py-1 rounded bg-muted/40 hover:bg-muted disabled:opacity-50" ${state.s2Page >= maxPage ? 'disabled' : ''} onclick="goS2(${state.s2Page + 1})">Next</button>
    `;

  } catch (e: any) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-12 text-center text-red-500">${escapeHtml(e.message)}</td></tr>`;
  }
}

(window as any).deleteDailyRecord = async (date: string) => {
  if (!confirm(`Are you sure you want to delete metrics for ${date}?`)) return;
  try {
    const res = await fetch(`/api/analytics/connections/${connectionId}/daily/${date}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to delete record');
    }
    renderS1();
  } catch (e: any) {
    alert(e.message);
  }
};

(window as any).goS1 = (p: number) => { state.s1Page = p; renderS1(); };
(window as any).goS2 = (p: number) => { state.s2Page = p; renderS2(); };

// Listeners
document.getElementById('s1-ps')?.addEventListener('change', (e: any) => { state.s1Size = Number(e.target.value); state.s1Page = 1; renderS1(); });
document.getElementById('s2-ps')?.addEventListener('change', (e: any) => { state.s2Size = Number(e.target.value); state.s2Page = 1; renderS2(); });

// Debounced search
let s2Timer: any;
document.getElementById('s2-q')?.addEventListener('input', (e: any) => { 
  clearTimeout(s2Timer);
  s2Timer = setTimeout(() => {
    state.s2Query = e.target.value; 
    state.s2Page = 1; 
    renderS2(); 
  }, 300);
});

document.querySelectorAll('[data-s1-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const s = th.getAttribute('data-s1-sort')!;
    if (state.s1Sort === s) {
      state.s1Desc = !state.s1Desc;
    } else {
      state.s1Sort = s;
      state.s1Desc = true;
    }
    renderS1();
  });
});

document.querySelectorAll('#top-pins-sort-tabs .mode-tab').forEach(b => {
  b.addEventListener('click', () => {
    state.s2Mode = b.getAttribute('data-mode')!;
    state.s2Page = 1;
    document.querySelectorAll('#top-pins-sort-tabs .mode-tab').forEach(x => {
      x.className = 'mode-tab rounded-lg px-3 py-1 text-xs font-semibold text-muted-foreground transition-all hover:text-foreground';
    });
    b.className = 'mode-tab active rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-sm transition-all';
    renderS2();
  });
});

document.getElementById('apply-range-btn')?.addEventListener('click', () => {
  state.from = (document.getElementById('from-date-input') as HTMLInputElement).value;
  state.to = (document.getElementById('to-date-input') as HTMLInputElement).value;
  document.querySelectorAll('.preset-btn').forEach(b => {
    b.className = 'preset-btn rounded-lg px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-all';
  });
  renderS1();
  renderS2();
});

document.querySelectorAll('.preset-btn').forEach(b => {
  b.addEventListener('click', () => {
    const days = Number(b.getAttribute('data-days'));
    const to = new Date();
    const from = new Date(to.getTime() - days * 86400000);
    state.to = to.toISOString().split('T')[0];
    state.from = from.toISOString().split('T')[0];
    
    (document.getElementById('from-date-input') as HTMLInputElement).value = state.from;
    (document.getElementById('to-date-input') as HTMLInputElement).value = state.to;
    
    document.querySelectorAll('.preset-btn').forEach(x => {
      x.className = 'preset-btn rounded-lg px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-all';
    });
    b.className = 'preset-btn active rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground shadow-sm transition-all';
    
    renderS1();
    renderS2();
  });
});

document.querySelectorAll('[role="tab"]').forEach(t => {
  t.addEventListener('click', () => {
    state.tab = t.getAttribute('data-tab') || 'data';
    syncStateToUrl();
  });
});

async function init() {
  loadStateFromUrl();
  renderS1();
  renderS2();
}

init();
