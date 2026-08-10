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

let allDailyData: any[] = [];
let allTopPins: any[] = [];

// State
const state = {
  s1Page: 1,
  s1Size: 25,
  s1Sort: 'metric_date',
  s1Desc: true,
  
  s2Page: 1,
  s2Size: 25,
  s2Mode: 'IMPRESSION',
  s2Sort: 'rank_position',
  s2Desc: false,
  s2Query: '',
  
  from: '',
  to: ''
};

// URL Sync
function syncStateToUrl() {
  const p = new URLSearchParams();
  if (state.s1Page > 1) p.set('s1_p', String(state.s1Page));
  if (state.s1Size !== 25) p.set('s1_s', String(state.s1Size));
  if (state.s1Sort !== 'metric_date') p.set('s1_sort', state.s1Sort);
  if (!state.s1Desc) p.set('s1_asc', '1');

  if (state.s2Page > 1) p.set('s2_p', String(state.s2Page));
  if (state.s2Size !== 25) p.set('s2_s', String(state.s2Size));
  if (state.s2Mode !== 'IMPRESSION') p.set('s2_mode', state.s2Mode);
  if (state.s2Sort !== 'rank_position') p.set('s2_sort', state.s2Sort);
  if (state.s2Desc) p.set('s2_desc', '1');
  if (state.s2Query) p.set('s2_q', state.s2Query);
  
  if (state.from) p.set('from', state.from);
  if (state.to) p.set('to', state.to);
  
  window.history.replaceState(null, '', '?' + p.toString() + window.location.hash);
}

function loadStateFromUrl() {
  const p = new URLSearchParams(window.location.search);
  state.s1Page = Number(p.get('s1_p')) || 1;
  state.s1Size = Number(p.get('s1_s')) || 25;
  state.s1Sort = p.get('s1_sort') || 'metric_date';
  state.s1Desc = p.get('s1_asc') !== '1';

  state.s2Page = Number(p.get('s2_p')) || 1;
  state.s2Size = Number(p.get('s2_s')) || 25;
  state.s2Mode = p.get('s2_mode') || 'IMPRESSION';
  state.s2Sort = p.get('s2_sort') || 'rank_position';
  state.s2Desc = p.get('s2_desc') === '1';
  state.s2Query = p.get('s2_q') || '';
  
  state.from = p.get('from') || '';
  state.to = p.get('to') || '';

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
}

function formatNum(n: number) { return new Intl.NumberFormat('en-US').format(n || 0); }

function renderS1() {
  const tbody = document.getElementById('daily-metrics-tbody')!;
  let data = [...allDailyData];
  
  if (state.from) data = data.filter(d => d.metric_date >= state.from);
  if (state.to) data = data.filter(d => d.metric_date <= state.to);
  
  data.sort((a, b) => {
    let valA = a[state.s1Sort];
    let valB = b[state.s1Sort];
    if (valA < valB) return state.s1Desc ? 1 : -1;
    if (valA > valB) return state.s1Desc ? -1 : 1;
    return 0;
  });
  
  document.querySelectorAll('[data-s1-sort]').forEach(th => {
    const s = th.getAttribute('data-s1-sort');
    th.querySelector('.sort-icon')!.textContent = s === state.s1Sort ? (state.s1Desc ? '↓' : '↑') : '';
  });

  const total = data.length;
  document.getElementById('s1-total')!.textContent = String(total);
  const maxPage = Math.ceil(total / state.s1Size) || 1;
  if (state.s1Page > maxPage) state.s1Page = maxPage;
  
  const start = (state.s1Page - 1) * state.s1Size;
  const pageData = data.slice(start, start + state.s1Size);
  
  document.getElementById('s1-range')!.textContent = total > 0 ? `${start + 1}-${Math.min(start + state.s1Size, total)}` : '0-0';
  
  if (pageData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="py-12 text-center text-muted-foreground">No data found</td></tr>`;
  } else {
    tbody.innerHTML = pageData.map(d => `
      <tr class="hover:bg-muted/10 transition-colors">
        <td class="py-2.5 px-4 font-mono font-medium">${d.metric_date}</td>
        <td class="py-2.5 px-4 text-right">${formatNum(d.impressions)}</td>
        <td class="py-2.5 px-4 text-right">${formatNum(d.engagements)}</td>
        <td class="py-2.5 px-4 text-right">${formatNum(d.outbound_clicks)}</td>
        <td class="py-2.5 px-4 text-right">${formatNum(d.pin_clicks)}</td>
        <td class="py-2.5 px-4 text-right">${formatNum(d.saves)}</td>
      </tr>
    `).join('');
  }
  
  // Tfoot
  const sums = data.reduce((acc, d) => {
    acc.imp += (d.impressions || 0);
    acc.eng += (d.engagements || 0);
    acc.out += (d.outbound_clicks || 0);
    acc.pin += (d.pin_clicks || 0);
    acc.sav += (d.saves || 0);
    return acc;
  }, {imp:0, eng:0, out:0, pin:0, sav:0});
  
  document.getElementById('daily-metrics-tfoot')!.innerHTML = `
    <tr>
      <td class="py-3 px-4">Totals (Filtered)</td>
      <td class="py-3 px-4 text-right">${formatNum(sums.imp)}</td>
      <td class="py-3 px-4 text-right">${formatNum(sums.eng)}</td>
      <td class="py-3 px-4 text-right">${formatNum(sums.out)}</td>
      <td class="py-3 px-4 text-right">${formatNum(sums.pin)}</td>
      <td class="py-3 px-4 text-right">${formatNum(sums.sav)}</td>
    </tr>
  `;
  
  // Paginator
  const btnDiv = document.getElementById('s1-page-buttons')!;
  btnDiv.innerHTML = `
    <button class="px-2 py-1 rounded bg-muted/40 hover:bg-muted disabled:opacity-50" ${state.s1Page === 1 ? 'disabled' : ''} onclick="goS1(${state.s1Page - 1})">Prev</button>
    <button class="px-2 py-1 rounded bg-muted/40 hover:bg-muted disabled:opacity-50" ${state.s1Page >= maxPage ? 'disabled' : ''} onclick="goS1(${state.s1Page + 1})">Next</button>
  `;
  
  syncStateToUrl();
}

function renderS2() {
  const tbody = document.getElementById('top-pins-tbody')!;
  let data = allTopPins.filter(p => p.sort_by === state.s2Mode);
  
  if (state.from) data = data.filter(d => d.window_end >= state.from);
  if (state.to) data = data.filter(d => d.window_start <= state.to); // Overlap logic
  
  // Latest Window filter
  const windowGroups = new Map();
  for (const d of data) {
    if (!windowGroups.has(d.pin_id) || windowGroups.get(d.pin_id).window_end < d.window_end) {
      windowGroups.set(d.pin_id, d);
    }
  }
  data = Array.from(windowGroups.values());
  
  if (state.s2Query) {
    const q = state.s2Query.toLowerCase();
    data = data.filter(d => 
      String(d.pin_id).toLowerCase().includes(q) || 
      (d.title && String(d.title).toLowerCase().includes(q))
    );
  }
  
  data.sort((a, b) => {
    let valA = a[state.s2Sort];
    let valB = b[state.s2Sort];
    if (valA < valB) return state.s2Desc ? 1 : -1;
    if (valA > valB) return state.s2Desc ? -1 : 1;
    return 0;
  });
  
  document.querySelectorAll('[data-s2-sort]').forEach(th => {
    const s = th.getAttribute('data-s2-sort');
    th.querySelector('.sort-icon')!.textContent = s === state.s2Sort ? (state.s2Desc ? '↓' : '↑') : '';
  });

  const total = data.length;
  document.getElementById('s2-total')!.textContent = String(total);
  const maxPage = Math.ceil(total / state.s2Size) || 1;
  if (state.s2Page > maxPage) state.s2Page = maxPage;
  
  const start = (state.s2Page - 1) * state.s2Size;
  const pageData = data.slice(start, start + state.s2Size);
  
  document.getElementById('s2-range')!.textContent = total > 0 ? `${start + 1}-${Math.min(start + state.s2Size, total)}` : '0-0';
  
  if (pageData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-12 text-center text-muted-foreground">No pins found</td></tr>`;
  } else {
    tbody.innerHTML = pageData.map(p => {
      const title = escapeHtml(p.title) || 'Untitled Pin';
      const destUrl = escapeHtml(p.destination_url);
      const img = escapeHtml(p.image_url) || FALLBACK_IMG;
      
      return `
      <tr class="hover:bg-muted/10 transition-colors">
        <td class="py-2.5 px-4 text-center font-bold text-muted-foreground">#${p.rank_position}</td>
        <td class="py-2.5 px-4">
          <div class="flex items-center gap-3">
            <div class="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-border/50 shadow-sm bg-muted">
              <img src="${img}" class="h-full w-full object-cover" loading="lazy" />
            </div>
            <div class="flex flex-col truncate min-w-0">
              <span class="font-semibold truncate text-foreground/90">${title}</span>
              ${destUrl ? `<a href="${destUrl}" target="_blank" class="text-[10px] text-blue-500 hover:underline truncate">Link</a>` : '<span class="text-[10px] text-muted-foreground">No Link</span>'}
            </div>
          </div>
        </td>
        <td class="py-2.5 px-4 text-right">${formatNum(p.impressions)}</td>
        <td class="py-2.5 px-4 text-right">${formatNum(p.engagement)}</td>
        <td class="py-2.5 px-4 text-right">${formatNum(p.outbound_clicks)}</td>
        <td class="py-2.5 px-4 text-right">${formatNum(p.pin_clicks)}</td>
        <td class="py-2.5 px-4 text-right">${formatNum(p.saves)}</td>
      </tr>
    `}).join('');
  }
  
  const btnDiv = document.getElementById('s2-page-buttons')!;
  btnDiv.innerHTML = `
    <button class="px-2 py-1 rounded bg-muted/40 hover:bg-muted disabled:opacity-50" ${state.s2Page === 1 ? 'disabled' : ''} onclick="goS2(${state.s2Page - 1})">Prev</button>
    <button class="px-2 py-1 rounded bg-muted/40 hover:bg-muted disabled:opacity-50" ${state.s2Page >= maxPage ? 'disabled' : ''} onclick="goS2(${state.s2Page + 1})">Next</button>
  `;
  
  syncStateToUrl();
}

(window as any).goS1 = (p: number) => { state.s1Page = p; renderS1(); };
(window as any).goS2 = (p: number) => { state.s2Page = p; renderS2(); };

// Listeners
document.getElementById('s1-ps')?.addEventListener('change', (e: any) => { state.s1Size = Number(e.target.value); state.s1Page = 1; renderS1(); });
document.getElementById('s2-ps')?.addEventListener('change', (e: any) => { state.s2Size = Number(e.target.value); state.s2Page = 1; renderS2(); });
document.getElementById('s2-q')?.addEventListener('input', (e: any) => { state.s2Query = e.target.value; state.s2Page = 1; renderS2(); });

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

document.querySelectorAll('[data-s2-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const s = th.getAttribute('data-s2-sort')!;
    if (state.s2Sort === s) {
      state.s2Desc = !state.s2Desc;
    } else {
      state.s2Sort = s;
      state.s2Desc = true;
    }
    renderS2();
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

async function fetchData() {
  try {
    const res = await fetch(`/api/internal/analytics/connect?connectionId=${connectionId}`);
    const { data } = await res.json();
    allDailyData = data.daily || [];
    allTopPins = data.top_pins || [];
    loadStateFromUrl();
    renderS1();
    renderS2();
  } catch (e) {
    document.getElementById('daily-metrics-tbody')!.innerHTML = `<tr><td colspan="6" class="text-center text-red-500 py-12">Error loading data</td></tr>`;
    document.getElementById('top-pins-tbody')!.innerHTML = `<tr><td colspan="7" class="text-center text-red-500 py-12">Error loading data</td></tr>`;
  }
}

fetchData();
