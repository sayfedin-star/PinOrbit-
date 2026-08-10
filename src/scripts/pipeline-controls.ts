const pipelineConnectionEl = document.querySelector('[data-connection-id]');
const pipeConnId = pipelineConnectionEl?.getAttribute('data-connection-id');

function showInlineError(target: HTMLElement, message: string) {
  let errEl = target.querySelector('.inline-error');
  if (!errEl) {
    errEl = document.createElement('div');
    errEl.className = 'inline-error mt-4 rounded-md bg-red-500/10 p-3 text-sm text-red-500 border border-red-500/20';
    target.appendChild(errEl);
  }
  errEl.textContent = message;
  setTimeout(() => errEl?.remove(), 6000);
}

function showToast(message: string, isSuccess = true) {
  let toast = document.getElementById('pipeline-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'pipeline-toast';
    toast.className = 'fixed bottom-5 right-5 z-50 rounded-xl px-4 py-3 text-xs font-semibold shadow-lg transition-all transform';
    document.body.appendChild(toast);
  }
  toast.className = isSuccess
    ? 'fixed bottom-5 right-5 z-50 rounded-xl bg-emerald-600 text-white px-4 py-3 text-xs font-semibold shadow-lg border border-emerald-500/30'
    : 'fixed bottom-5 right-5 z-50 rounded-xl bg-red-600 text-white px-4 py-3 text-xs font-semibold shadow-lg border border-red-500/30';
  toast.textContent = message;
  toast.style.display = 'block';
  setTimeout(() => {
    if (toast) toast.style.display = 'none';
  }, 4000);
}

if (pipeConnId) {
  // Fetch settings for Tab 2
  async function loadPipelineSettings() {
    try {
      const res = await fetch(`/api/analytics/connections/${pipeConnId}/settings`);
      const contentType = res.headers.get('content-type');
      if (!res.ok) {
        let msg = 'Failed to load';
        try {
          if (contentType?.includes('application/json')) {
            const err = await res.json();
            msg = err.error || msg;
          } else {
            msg = await res.text();
          }
        } catch {}
        throw new Error(`HTTP ${res.status}: ${msg}`);
      }
      const { data } = await res.json();
      
      const lastSyncEl = document.getElementById('connection-last-sync');
      if (lastSyncEl) {
        lastSyncEl.textContent = data.last_analytics_sync_at 
          ? new Date(data.last_analytics_sync_at).toLocaleString() 
          : '—';
      }

      const pA = document.querySelector('[data-pipeline="analytics"]');
      if (pA) {
        (pA.querySelector('[data-field="webhook_url"]') as HTMLInputElement).value = data.analytics_webhook_url || '';
        (pA.querySelector('[data-field="sync_time"]') as HTMLInputElement).value = data.analytics_sync_time || '';
        (pA.querySelector('[data-field="start_offset"]') as HTMLInputElement).value = data.analytics_start_offset_days ?? 7;
        (pA.querySelector('[data-field="end_offset"]') as HTMLInputElement).value = data.analytics_end_offset_days ?? 1;
        const chipA = pA.querySelector('[data-chip]');
        if (chipA) chipA.textContent = data.analytics_schedule_status || 'pending';
        
        const badgeA = pA.querySelector('[data-token-badge]');
        if (badgeA) {
          const fingerprintA = data.analytics_token_fingerprint || data.analytics_fastcron_token_fingerprint;
          badgeA.textContent = (data.has_analytics_fastcron_token && fingerprintA)
            ? `Custom: ${fingerprintA}` 
            : 'Workspace Default';
        }

        const errMsgA = pA.querySelector('[data-err-msg]') as HTMLElement;
        if (errMsgA) {
          if (data.analytics_schedule_status === 'error' && data.last_error_a) {
            errMsgA.textContent = data.last_error_a;
            errMsgA.title = data.last_error_a;
            errMsgA.classList.remove('hidden');
          } else {
            errMsgA.classList.add('hidden');
          }
        }
      }
      
      const pB = document.querySelector('[data-pipeline="top_pins"]');
      if (pB) {
        (pB.querySelector('[data-field="webhook_url"]') as HTMLInputElement).value = data.top_pins_webhook_url || '';
        (pB.querySelector('[data-field="sync_time"]') as HTMLInputElement).value = data.top_pins_sync_time || '';
        (pB.querySelector('[data-field="start_offset"]') as HTMLInputElement).value = data.top_pins_start_offset_days ?? 7;
        (pB.querySelector('[data-field="end_offset"]') as HTMLInputElement).value = data.top_pins_end_offset_days ?? 2;
        (pB.querySelector('[data-field="num_of_pins"]') as HTMLInputElement).value = data.top_pins_num_of_pins ?? 50;
        const chipB = pB.querySelector('[data-chip]');
        if (chipB) chipB.textContent = data.top_pins_schedule_status || 'pending';

        const badgeB = pB.querySelector('[data-token-badge]');
        if (badgeB) {
          const fingerprintB = data.top_pins_token_fingerprint || data.top_pins_fastcron_token_fingerprint;
          badgeB.textContent = (data.has_top_pins_fastcron_token && fingerprintB)
            ? `Custom: ${fingerprintB}` 
            : 'Workspace Default';
        }

        const errMsgB = pB.querySelector('[data-err-msg]') as HTMLElement;
        if (errMsgB) {
          if (data.top_pins_schedule_status === 'error' && data.last_error_b) {
            errMsgB.textContent = data.last_error_b;
            errMsgB.title = data.last_error_b;
            errMsgB.classList.remove('hidden');
          } else {
            errMsgB.classList.add('hidden');
          }
        }
        
        // Sort modes
        const modes = data.top_pins_sort_modes || [];
        pB.querySelectorAll('[data-mode]').forEach(b => {
          const m = b.getAttribute('data-mode')!;
          if (modes.includes(m)) {
            b.setAttribute('aria-pressed', 'true');
            b.className = 'rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary';
          } else {
            b.setAttribute('aria-pressed', 'false');
            b.className = 'rounded-lg border border-border bg-card px-2.5 py-1 text-[10px] font-bold text-muted-foreground hover:bg-muted';
          }
        });
      }
      
      const fc = document.getElementById('fastcron-options-card');
      if (fc) {
        const notifyEl = fc.querySelector('[data-field="fastcron_notify"]') as HTMLInputElement;
        if (notifyEl) notifyEl.checked = data.fastcron_notify ?? true;
        const timeoutEl = fc.querySelector('[data-field="fastcron_timeout"]') as HTMLInputElement;
        if (timeoutEl) timeoutEl.value = String(data.fastcron_timeout ?? 30);
        const instancesEl = fc.querySelector('[data-field="fastcron_instances"]') as HTMLInputElement;
        if (instancesEl) instancesEl.value = String(data.fastcron_instances ?? 1);
      }
      
      // Update health banner
      const healthChip = document.getElementById('health-status-chip');
      const totalRunsEl = document.getElementById('health-total-runs');
      const consecFailEl = document.getElementById('health-consecutive-failures');
      const lastSuccessEl = document.getElementById('health-last-success');

      if (data.health) {
        if (totalRunsEl) totalRunsEl.textContent = String(data.health.total_runs ?? 0);
        if (consecFailEl) consecFailEl.textContent = String(data.health.consecutive_failures ?? 0);
        if (lastSuccessEl) {
          lastSuccessEl.textContent = data.health.last_success_at
            ? new Date(data.health.last_success_at).toLocaleString()
            : '—';
        }
        if (healthChip) {
          const fails = data.health.consecutive_failures ?? 0;
          const isRevoked = data.health.revoked || fails >= 3;
          if (isRevoked) {
            healthChip.textContent = 'Revoked';
            healthChip.className = 'rounded-full px-3 py-1 text-xs font-bold bg-red-500/10 text-red-500 shadow-sm border border-red-500/20';
          } else if (fails === 2) {
            healthChip.textContent = 'Critical';
            healthChip.className = 'rounded-full px-3 py-1 text-xs font-bold bg-rose-500/10 text-rose-500 shadow-sm border border-rose-500/20';
          } else if (fails === 1) {
            healthChip.textContent = 'Warning';
            healthChip.className = 'rounded-full px-3 py-1 text-xs font-bold bg-amber-500/10 text-amber-500 shadow-sm border border-amber-500/20';
          } else {
            healthChip.textContent = 'Healthy';
            healthChip.className = 'rounded-full px-3 py-1 text-xs font-bold bg-emerald-500/10 text-emerald-500 shadow-sm border border-emerald-500/20';
          }
        }
      }
      
    } catch (e: any) {
      console.error('Failed to load settings', e);
      const container = document.getElementById('pipeline-settings-container') || document.getElementById('panel-pipe');
      if (container) showInlineError(container, e.message);
      
      const lastSyncEl = document.getElementById('connection-last-sync');
      if (lastSyncEl) lastSyncEl.textContent = '—';
      const healthChip = document.getElementById('health-status-chip');
      if (healthChip) {
        healthChip.textContent = '—';
        healthChip.className = 'rounded-full px-3 py-1 text-xs font-bold bg-muted text-muted-foreground shadow-sm';
      }
      const totalRunsEl = document.getElementById('health-total-runs');
      if (totalRunsEl) totalRunsEl.textContent = '—';
      const consecFailEl = document.getElementById('health-consecutive-failures');
      if (consecFailEl) consecFailEl.textContent = '—';
      const lastSuccessEl = document.getElementById('health-last-success');
      if (lastSuccessEl) lastSuccessEl.textContent = '—';
    }
  }

  // Bind save buttons
  document.querySelectorAll('button[data-action="save"]').forEach(btn => {
    btn.removeAttribute('disabled');
    btn.addEventListener('click', async (e) => {
      const target = (e.target as HTMLElement).closest('article');
      if (!target) return;
      const isTopPins = target.getAttribute('data-pipeline') === 'top_pins';
      
      const clampInt = (raw: any, fallback: number, min: number, max: number) => {
        const n = parseInt(raw, 10);
        if (isNaN(n)) return fallback;
        if (n < min) return min;
        if (n > max) return max;
        return n;
      };

      const payload: any = {};
      
      if (isTopPins) {
        payload.top_pins_webhook_url = (target.querySelector('[data-field="webhook_url"]') as HTMLInputElement).value;
        payload.top_pins_sync_time = (target.querySelector('[data-field="sync_time"]') as HTMLInputElement).value;
        payload.top_pins_start_offset_days = clampInt((target.querySelector('[data-field="start_offset"]') as HTMLInputElement).value, 7, 1, 90);
        payload.top_pins_end_offset_days = clampInt((target.querySelector('[data-field="end_offset"]') as HTMLInputElement).value, 2, 0, 60);
        payload.top_pins_num_of_pins = clampInt((target.querySelector('[data-field="num_of_pins"]') as HTMLInputElement).value, 50, 1, 50);
        
        const modes: string[] = [];
        target.querySelectorAll('[data-mode][aria-pressed="true"]').forEach(b => modes.push(b.getAttribute('data-mode')!));
        payload.top_pins_sort_modes = modes;

        const tokenVal = (target.querySelector('[data-field="fastcron_token"]') as HTMLInputElement)?.value;
        if (tokenVal !== undefined && tokenVal.trim().length > 0) {
          payload.top_pins_fastcron_token = tokenVal.trim();
        }
      } else {
        payload.analytics_webhook_url = (target.querySelector('[data-field="webhook_url"]') as HTMLInputElement).value;
        payload.analytics_sync_time = (target.querySelector('[data-field="sync_time"]') as HTMLInputElement).value;
        payload.analytics_start_offset_days = clampInt((target.querySelector('[data-field="start_offset"]') as HTMLInputElement).value, 7, 1, 90);
        payload.analytics_end_offset_days = clampInt((target.querySelector('[data-field="end_offset"]') as HTMLInputElement).value, 1, 0, 60);

        const tokenVal = (target.querySelector('[data-field="fastcron_token"]') as HTMLInputElement)?.value;
        if (tokenVal !== undefined && tokenVal.trim().length > 0) {
          payload.analytics_fastcron_token = tokenVal.trim();
        }
      }
      
      // Add fastcron settings globally
      const fc = document.getElementById('fastcron-options-card');
      if (fc) {
        payload.fastcron_notify = (fc.querySelector('[data-field="fastcron_notify"]') as HTMLInputElement).checked;
        payload.fastcron_timeout = clampInt((fc.querySelector('[data-field="fastcron_timeout"]') as HTMLInputElement).value, 30, 5, 60);
        payload.fastcron_instances = clampInt((fc.querySelector('[data-field="fastcron_instances"]') as HTMLInputElement).value, 1, 0, 5);
      }
      
      try {
        btn.textContent = 'Saving...';
        btn.setAttribute('disabled', 'true');
        const targetErr = target.querySelector('.inline-error');
        if (targetErr) targetErr.remove();

        const res = await fetch(`/api/analytics/connections/${pipeConnId}/settings`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          btn.textContent = 'Saved!';
          showToast('Settings saved successfully');
          setTimeout(() => {
            btn.textContent = 'Save Settings';
            btn.removeAttribute('disabled');
          }, 2000);
          loadPipelineSettings();
        } else {
          const contentType = res.headers.get('content-type');
          let msg = 'Failed to save';
          if (contentType?.includes('application/json')) {
            const err = await res.json();
            msg = err.error || msg;
          } else {
            msg = await res.text();
          }
          showInlineError(target, `HTTP ${res.status}: ${msg}`);
          btn.textContent = 'Save Settings';
          btn.removeAttribute('disabled');
        }
      } catch (err: any) {
        showInlineError(target, err.message || 'Network error');
        btn.textContent = 'Save Settings';
        btn.removeAttribute('disabled');
      }
    });
  });

  // Bind Sort Mode toggles
  document.querySelectorAll('#sort-modes-container button[data-mode]').forEach(b => {
    b.addEventListener('click', () => {
      const isPressed = b.getAttribute('aria-pressed') === 'true';
      if (isPressed) {
        b.setAttribute('aria-pressed', 'false');
        b.className = 'rounded-lg border border-border bg-card px-2.5 py-1 text-[10px] font-bold text-muted-foreground hover:bg-muted';
      } else {
        b.setAttribute('aria-pressed', 'true');
        b.className = 'rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary';
      }
    });
  });

  // Action Buttons: Test Ping, Run Now, Sync Schedule, View Logs
  document.querySelectorAll('button[data-action="ping"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const target = (e.target as HTMLElement).closest('article');
      if (!target) return;
      const channel = target.getAttribute('data-pipeline') || 'analytics';
      const origText = btn.textContent;
      btn.setAttribute('disabled', 'true');
      btn.textContent = 'Pinging...';
      const targetErr = target.querySelector('.inline-error');
      if (targetErr) targetErr.remove();

      try {
        const res = await fetch('/api/analytics/trigger-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connection_id: pipeConnId, channel, mode: 'ping' }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
          showToast(`Ping Success: ${data.message || 'Make.com webhook reached'}`);
        } else {
          const msg = data.error || data.message || `HTTP ${res.status}: Ping failed`;
          showInlineError(target, msg);
        }
      } catch (err: any) {
        showInlineError(target, err.message || 'Network error on ping');
      } finally {
        btn.removeAttribute('disabled');
        btn.textContent = origText;
      }
    });
  });

  document.querySelectorAll('button[data-action="run"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const target = (e.target as HTMLElement).closest('article');
      if (!target) return;
      const channel = target.getAttribute('data-pipeline') || 'analytics';
      const origText = btn.textContent;
      btn.setAttribute('disabled', 'true');
      btn.textContent = 'Running...';
      const targetErr = target.querySelector('.inline-error');
      if (targetErr) targetErr.remove();

      const overrideFrom = (target.querySelector('[data-field="override_from"]') as HTMLInputElement)?.value;
      const overrideTo = (target.querySelector('[data-field="override_to"]') as HTMLInputElement)?.value;
      const body: any = { connection_id: pipeConnId, channel, mode: 'sync' };
      if (overrideFrom && overrideTo) {
        body.from_date = overrideFrom;
        body.to_date = overrideTo;
      }

      try {
        const res = await fetch('/api/analytics/trigger-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
          showToast(`Run Success: ${data.message || 'Sync triggered successfully'}`);
          loadPipelineSettings();
        } else {
          const msg = data.error || data.message || `HTTP ${res.status}: Run failed`;
          showInlineError(target, msg);
        }
      } catch (err: any) {
        showInlineError(target, err.message || 'Network error on run');
      } finally {
        btn.removeAttribute('disabled');
        btn.textContent = origText;
      }
    });
  });

  document.querySelectorAll('button[data-action="sync"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const target = (e.target as HTMLElement).closest('article');
      if (!target) return;
      const channel = target.getAttribute('data-pipeline') || 'analytics';
      const origText = btn.textContent;
      btn.setAttribute('disabled', 'true');
      btn.textContent = 'Syncing...';
      const targetErr = target.querySelector('.inline-error');
      if (targetErr) targetErr.remove();

      try {
        const res = await fetch('/api/analytics/schedule/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connection_id: pipeConnId, channel }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
          showToast(`Schedule Synced: FastCron Job #${data.fastcron_job_id || 'Active'}`);
          loadPipelineSettings();
        } else {
          const msg = data.error || data.message || `HTTP ${res.status}: Schedule sync failed`;
          showInlineError(target, msg);
        }
      } catch (err: any) {
        showInlineError(target, err.message || 'Network error on schedule sync');
      } finally {
        btn.removeAttribute('disabled');
        btn.textContent = origText;
      }
    });
  });

  document.querySelectorAll('button[data-action="logs"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const target = (e.target as HTMLElement).closest('article');
      if (!target) return;
      const channel = target.getAttribute('data-pipeline') || 'analytics';
      const origText = btn.textContent;
      btn.setAttribute('disabled', 'true');
      btn.textContent = 'Fetching logs...';
      const targetErr = target.querySelector('.inline-error');
      if (targetErr) targetErr.remove();

      try {
        const res = await fetch(`/api/analytics/cron/logs?connection_id=${pipeConnId}&channel=${channel}`);
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
          const count = Array.isArray(data.logs) ? data.logs.length : 0;
          showToast(`FastCron Logs: ${count} run(s) recorded`);
          if (count > 0) {
            console.table(data.logs);
          }
        } else {
          const msg = data.error || data.message || `HTTP ${res.status}: Fetch logs failed`;
          showInlineError(target, msg);
        }
      } catch (err: any) {
        showInlineError(target, err.message || 'Network error on fetch logs');
      } finally {
        btn.removeAttribute('disabled');
        btn.textContent = origText;
      }
    });
  });

  loadPipelineSettings();

  // Reload on tab activation
  document.querySelectorAll('[role="tab"]').forEach(t => {
    t.addEventListener('click', () => {
      loadPipelineSettings();
    });
  });
}
