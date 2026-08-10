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
  setTimeout(() => errEl?.remove(), 5000);
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
        } catch(e) {}
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
        pA.querySelector('[data-chip]')!.textContent = data.analytics_schedule_status || 'pending';
        
        const badgeA = pA.querySelector('[data-token-badge]');
        if (badgeA) {
          badgeA.textContent = data.analytics_fastcron_token_fingerprint 
            ? `Custom: ${data.analytics_fastcron_token_fingerprint}` 
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
        pB.querySelector('[data-chip]')!.textContent = data.top_pins_schedule_status || 'pending';

        const badgeB = pB.querySelector('[data-token-badge]');
        if (badgeB) {
          badgeB.textContent = data.top_pins_fastcron_token_fingerprint 
            ? `Custom: ${data.top_pins_fastcron_token_fingerprint}` 
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
        (fc.querySelector('[data-field="fastcron_notify"]') as HTMLInputElement).checked = data.fastcron_notify ?? true;
        (fc.querySelector('[data-field="fastcron_timeout"]') as HTMLInputElement).value = data.fastcron_timeout ?? 30;
        (fc.querySelector('[data-field="fastcron_instances"]') as HTMLInputElement).value = data.fastcron_instances ?? 1;
      }
      
      // Update health banner if health exists
      if (data.health) {
        document.getElementById('health-total-runs')!.textContent = data.health.total_runs ?? '--';
        document.getElementById('health-consecutive-failures')!.textContent = data.health.consecutive_failures ?? '--';
        document.getElementById('health-last-success')!.textContent = data.health.last_success_at ? new Date(data.health.last_success_at).toLocaleString() : '--';
        document.getElementById('health-status-chip')!.textContent = data.health.revoked ? 'Revoked' : 'Active';
      }
      
    } catch (e: any) {
      console.error('Failed to load settings', e);
      // Optional: show a banner at the top of the container
      const container = document.getElementById('pipeline-settings-container');
      if (container) showInlineError(container, e.message);
      
      const lastSyncEl = document.getElementById('connection-last-sync');
      if (lastSyncEl) lastSyncEl.textContent = '—';
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
        const targetErr = target.querySelector('.inline-error');
        if (targetErr) targetErr.remove();

        const res = await fetch(`/api/analytics/connections/${pipeConnId}/settings`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          btn.textContent = 'Saved!';
          setTimeout(() => btn.textContent = 'Save Settings', 2000);
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
        }
      } catch (err: any) {
        showInlineError(target, err.message || 'Network error');
        btn.textContent = 'Save Settings';
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

  loadPipelineSettings();

  // Reload on tab activation
  document.querySelectorAll('[role="tab"]').forEach(t => {
    t.addEventListener('click', () => {
      loadPipelineSettings();
    });
  });
}
