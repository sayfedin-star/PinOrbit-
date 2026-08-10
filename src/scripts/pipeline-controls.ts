const pipelineConnectionEl = document.querySelector('[data-connection-id]');
const pipeConnId = pipelineConnectionEl?.getAttribute('data-connection-id');

if (pipeConnId) {
  // Fetch settings for Tab 2
  async function loadPipelineSettings() {
    try {
      const res = await fetch(`/api/internal/analytics/connections/${pipeConnId}/settings`);
      const { data } = await res.json();
      
      const pA = document.querySelector('[data-pipeline="analytics"]');
      if (pA) {
        (pA.querySelector('[data-field="webhook_url"]') as HTMLInputElement).value = data.analytics_webhook_url || '';
        (pA.querySelector('[data-field="sync_time"]') as HTMLInputElement).value = data.analytics_sync_time || '';
        (pA.querySelector('[data-field="start_offset"]') as HTMLInputElement).value = data.analytics_start_offset_days ?? 7;
        (pA.querySelector('[data-field="end_offset"]') as HTMLInputElement).value = data.analytics_end_offset_days ?? 1;
        pA.querySelector('[data-chip]')!.textContent = data.analytics_schedule_status || 'pending';
      }
      
      const pB = document.querySelector('[data-pipeline="top_pins"]');
      if (pB) {
        (pB.querySelector('[data-field="webhook_url"]') as HTMLInputElement).value = data.top_pins_webhook_url || '';
        (pB.querySelector('[data-field="sync_time"]') as HTMLInputElement).value = data.top_pins_sync_time || '';
        (pB.querySelector('[data-field="start_offset"]') as HTMLInputElement).value = data.top_pins_start_offset_days ?? 7;
        (pB.querySelector('[data-field="end_offset"]') as HTMLInputElement).value = data.top_pins_end_offset_days ?? 2;
        (pB.querySelector('[data-field="num_of_pins"]') as HTMLInputElement).value = data.top_pins_num_of_pins ?? 50;
        pB.querySelector('[data-chip]')!.textContent = data.top_pins_schedule_status || 'pending';
        
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
      
      // Update health banner
      document.getElementById('health-total-runs')!.textContent = data.total_runs ?? '--';
      document.getElementById('health-consecutive-failures')!.textContent = data.consecutive_failures ?? '--';
      document.getElementById('health-last-success')!.textContent = data.last_success_at ? new Date(data.last_success_at).toLocaleString() : '--';
      document.getElementById('health-status-chip')!.textContent = data.revoked_at ? 'Revoked' : 'Active';
      
    } catch (e) {
      console.error('Failed to load settings', e);
    }
  }

  // Bind save buttons
  document.querySelectorAll('button[data-action="save"]').forEach(btn => {
    btn.removeAttribute('disabled');
    btn.addEventListener('click', async (e) => {
      const target = (e.target as HTMLElement).closest('article');
      if (!target) return;
      const isTopPins = target.getAttribute('data-pipeline') === 'top_pins';
      
      const payload: any = {};
      
      if (isTopPins) {
        payload.top_pins_webhook_url = (target.querySelector('[data-field="webhook_url"]') as HTMLInputElement).value;
        payload.top_pins_sync_time = (target.querySelector('[data-field="sync_time"]') as HTMLInputElement).value;
        payload.top_pins_start_offset_days = parseInt((target.querySelector('[data-field="start_offset"]') as HTMLInputElement).value);
        payload.top_pins_end_offset_days = parseInt((target.querySelector('[data-field="end_offset"]') as HTMLInputElement).value);
        payload.top_pins_num_of_pins = parseInt((target.querySelector('[data-field="num_of_pins"]') as HTMLInputElement).value);
        
        const modes: string[] = [];
        target.querySelectorAll('[data-mode][aria-pressed="true"]').forEach(b => modes.push(b.getAttribute('data-mode')!));
        payload.top_pins_sort_modes = modes;
      } else {
        payload.analytics_webhook_url = (target.querySelector('[data-field="webhook_url"]') as HTMLInputElement).value;
        payload.analytics_sync_time = (target.querySelector('[data-field="sync_time"]') as HTMLInputElement).value;
        payload.analytics_start_offset_days = parseInt((target.querySelector('[data-field="start_offset"]') as HTMLInputElement).value);
        payload.analytics_end_offset_days = parseInt((target.querySelector('[data-field="end_offset"]') as HTMLInputElement).value);
      }
      
      // Add fastcron settings globally
      const fc = document.getElementById('fastcron-options-card');
      if (fc) {
        payload.fastcron_notify = (fc.querySelector('[data-field="fastcron_notify"]') as HTMLInputElement).checked;
        payload.fastcron_timeout = parseInt((fc.querySelector('[data-field="fastcron_timeout"]') as HTMLInputElement).value);
        payload.fastcron_instances = parseInt((fc.querySelector('[data-field="fastcron_instances"]') as HTMLInputElement).value);
      }
      
      try {
        btn.textContent = 'Saving...';
        const res = await fetch(`/api/internal/analytics/connections/${pipeConnId}/settings`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          btn.textContent = 'Saved!';
          setTimeout(() => btn.textContent = 'Save Settings', 2000);
          loadPipelineSettings();
        } else {
          const err = await res.json();
          alert('Failed to save: ' + err.error);
          btn.textContent = 'Save Settings';
        }
      } catch (err) {
        alert('Network error');
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
}
