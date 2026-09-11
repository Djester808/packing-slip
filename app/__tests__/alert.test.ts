import { getAlert } from '../alert';

describe('getAlert', () => {
  // Heat bands are fixed: ≤85 safe, 86–90 oversized box, >90 hard hold.
  // Only cold thresholds are passed (dontShipBelow=35, cautionBelow=45).
  const call = (hi: number | null, lo: number | null) => getAlert(hi, lo, 35, 45);

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
    it('35°F low → danger', () => {
      const a = call(50, 35);
      expect(a.level).toBe('danger');
      expect(a.headline).toContain('35°F');
    });

    it('36°F low → not danger', () => {
      expect(call(50, 36).level).not.toBe('danger');
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
