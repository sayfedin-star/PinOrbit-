import { describe, it, expect } from 'vitest';
import { escapeHtml, formatDate, formatTime, maskWebhookUrl, renderStatusBadge } from '../ui-helpers';

describe('ui-helpers test suite', () => {
  describe('escapeHtml', () => {
    it('escapes HTML special characters and script tags', () => {
      const input = '<script>alert("XSS & attack");</script>';
      const expected = '&lt;script&gt;alert(&quot;XSS &amp; attack&quot;);&lt;/script&gt;';
      expect(escapeHtml(input)).toBe(expected);
    });

    it('escapes single quotes', () => {
      expect(escapeHtml("'hello'")).toBe('&#039;hello&#039;');
    });

    it('handles empty strings and nullish inputs', () => {
      expect(escapeHtml('')).toBe('');
      expect(escapeHtml(null as any)).toBe('');
      expect(escapeHtml(undefined as any)).toBe('');
    });
  });

  describe('formatDate & formatTime', () => {
    it('formats valid ISO date strings', () => {
      const iso = '2026-08-05T12:00:00Z';
      expect(formatDate(iso)).not.toBe('-');
      expect(formatTime(iso)).not.toBe('-');
    });

    it('handles null, undefined, and empty string gracefully', () => {
      expect(formatDate(null)).toBe('-');
      expect(formatDate(undefined)).toBe('-');
      expect(formatDate('')).toBe('-');

      expect(formatTime(null)).toBe('-');
      expect(formatTime(undefined)).toBe('-');
      expect(formatTime('')).toBe('-');
    });

    it('handles invalid date strings gracefully', () => {
      expect(formatDate('invalid-date-string')).toBe('-');
      expect(formatTime('invalid-date-string')).toBe('-');
    });
  });

  describe('maskWebhookUrl', () => {
    it('masks full webhook URL secrets while retaining origin', () => {
      const input = 'https://hook.make.com/abc123healthy1';
      const masked = maskWebhookUrl(input);
      expect(masked).toContain('https://hook.make.com');
      expect(masked).toContain('••••');
      expect(masked).not.toBe(input);
    });

    it('handles short URL paths safely', () => {
      const input = 'https://example.com/a';
      const masked = maskWebhookUrl(input);
      expect(masked).toBe('https://example.com/••••••••');
    });

    it('handles non-URL invalid strings', () => {
      expect(maskWebhookUrl('shortsecret')).toBe('••••••••');
      expect(maskWebhookUrl('longsecretkeywithcharacters')).toContain('••••');
    });

    it('handles null and undefined', () => {
      expect(maskWebhookUrl(null)).toBe('-');
      expect(maskWebhookUrl(undefined)).toBe('-');
    });
  });

  describe('renderStatusBadge', () => {
    it('renders badge for pending, posted, failed, and processing statuses', () => {
      const pending = renderStatusBadge('pending');
      expect(pending).toContain('bg-amber-500');
      expect(pending).toContain('Pending');

      const posted = renderStatusBadge('posted');
      expect(posted).toContain('bg-emerald-500');
      expect(posted).toContain('Posted');

      const failed = renderStatusBadge('failed');
      expect(failed).toContain('bg-rose-500');
      expect(failed).toContain('Failed');

      const processing = renderStatusBadge('processing');
      expect(processing).toContain('bg-sky-500');
      expect(processing).toContain('Processing');
    });

    it('sanitizes custom labels in badges against XSS', () => {
      const customLabel = '<img src=x onerror=alert(1)>';
      const rendered = renderStatusBadge('pending', customLabel);
      expect(rendered).not.toContain('<img');
      expect(rendered).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });
  });
});
