import { getAlert } from '../alert';

describe('getAlert', () => {
  // Heat bands are fixed: ≤85 safe, 86–90 oversized box, >90 hard hold.
  // Only heat-pack caution is configurable.
  const call = (hi: number | null, lo: number | null) => getAlert(hi, lo, 45);

  describe('heat bands', () => {
    it('85°F → safe', () => {
      expect(call(85, 60).level).toBe('safe');
    });

    it('80°F → safe (no separate ice-pack caution band anymore)', () => {
      expect(call(80, 60).level).toBe('safe');
    });

    it('86°F → oversized box', () => {
      const a = call(86, 60);
      expect(a.level).toBe('insulated');
      expect(a.headline).toBe('Use oversized box — 86°F high expected');
      expect(a.body).toContain('Pack in an oversized box with an ice pack');
    });

    it('90°F → oversized box (still ships)', () => {
      const a = call(90, 70);
      expect(a.level).toBe('insulated');
      expect(a.headline).toContain('Use oversized box');
    });

    it.each([91, 100, 101])('%i°F → hard hold (above 90)', (high) => {
      const a = call(high, 70);
      expect(a.level).toBe('danger');
      expect(a.headline).toContain('Do not ship');
    });

    it('rounds 85.4°F down to 85 → safe', () => {
      expect(call(85.4, 60).level).toBe('safe');
    });

    it('rounds 85.5°F up to 86 → insulated', () => {
      expect(call(85.5, 60).level).toBe('insulated');
    });

    it('rounds 90.4°F down to 90 → insulated (not held)', () => {
      expect(call(90.4, 70).level).toBe('insulated');
    });
  });

  it('rounds 90.5°F up to 91 → hard hold', () => {
    expect(call(90.5, 70).level).toBe('danger');
  });

  describe('cold thresholds', () => {
    it.each([-10, -1, -0.1])('%s°F low → danger', (low) => {
      const a = call(50, low);
      expect(a.level).toBe('danger');
      expect(a.headline).toContain(String(low) + '°F');
    });

    it.each([0, 0.1, 20, 32])('%s°F low → ship insulated', (low) => {
      const a = call(50, low);
      expect(a.level).toBe('insulated');
      expect(a.headline).toBe('Ship in insulated box — ' + low + '°F low expected');
    });

    it.each([32.1, 33, 35, 36])('%s°F low → heat-pack caution, not hold', (low) => {
      expect(call(50, low).level).toBe('caution');
    });

    it('retains extreme heat holds even with a freezing low', () => {
      expect(call(91, 32).level).toBe('danger');
    });

    it('insulates freezing lows even when heat-pack caution is set lower', () => {
      expect(getAlert(50, 32, 10).level).toBe('insulated');
    });

    it('45°F low → heat pack caution', () => {
      const a = call(75, 45);
      expect(a.level).toBe('caution');
      expect(a.headline).toContain('Heat pack');
    });

    it('null low → safe', () => {
      expect(call(75, null).level).toBe('safe');
    });
  });

  describe('safe / unavailable', () => {
    it('moderate temps → safe', () => {
      const a = call(72, 60);
      expect(a.level).toBe('safe');
      expect(a.headline).toContain('Safe to ship');
    });

    it('null high → unknown', () => {
      const a = call(null, 50);
      expect(a.level).toBe('unknown');
      expect(a.headline).toContain('Forecast unavailable');
    });
  });
});
