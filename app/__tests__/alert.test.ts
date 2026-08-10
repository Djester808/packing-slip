import { getAlert } from '../alert';

describe('getAlert', () => {
  // Heat bands are fixed: ≤85 safe, 86–100 insulated box, >100 hard hold.
  // Only cold thresholds are passed (dontShipBelow=35, cautionBelow=45).
  const call = (hi: number | null, lo: number | null) => getAlert(hi, lo, 35, 45);

  describe('heat bands', () => {
    it('85°F → safe', () => {
      expect(call(85, 60).level).toBe('safe');
    });

    it('80°F → safe (no separate ice-pack caution band anymore)', () => {
      expect(call(80, 60).level).toBe('safe');
    });

    it('86°F → oversized box (not insulated)', () => {
      const a = call(86, 60);
      expect(a.level).toBe('insulated');
      expect(a.headline).toBe('Use oversized box — 86°F high expected');
    });

    it('90°F → oversized box (top of the plain-oversized band)', () => {
      expect(call(90, 60).headline).toContain('Use oversized box');
    });

    it('91°F → oversized insulated box', () => {
      expect(call(91, 60).headline).toContain('Use oversized insulated box');
    });

    it('100°F → oversized insulated box (still ships)', () => {
      const a = call(100, 70);
      expect(a.level).toBe('insulated');
      expect(a.headline).toContain('Use oversized insulated box');
    });

    it('101°F → hard hold (above 100)', () => {
      const a = call(101, 70);
      expect(a.level).toBe('danger');
      expect(a.headline).toContain('Do not ship');
    });

    it('rounds 85.4°F down to 85 → safe', () => {
      expect(call(85.4, 60).level).toBe('safe');
    });

    it('rounds 85.5°F up to 86 → insulated', () => {
      expect(call(85.5, 60).level).toBe('insulated');
    });

    it('rounds 100.4°F down to 100 → insulated (not held)', () => {
      expect(call(100.4, 70).level).toBe('insulated');
    });
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
