import { getAlert } from '../alert';

describe('getAlert', () => {
  // Heat: 90–99 → insulated box (still ships); 100+ → hard hold (danger).
  const T = { dontShipAbove: 90, icePackAbove: 80, dontShipBelow: 35, cautionBelow: 45, heatHoldAbove: 100 };
  const call = (hi: number | null, lo: number | null) =>
    getAlert(hi, lo, T.dontShipAbove, T.icePackAbove, T.dontShipBelow, T.cautionBelow, T.heatHoldAbove);

  describe('insulated box band (90–99°F)', () => {
    it('90°F → insulated, not held', () => {
      const alert = call(90, 60);
      expect(alert.level).toBe('insulated');
      expect(alert.headline).toContain('insulated');
      expect(alert.headline).toContain('90°F');
    });

    it('99°F → insulated, not held', () => {
      expect(call(99, 60).level).toBe('insulated');
    });

    it('rounds 89.5°F up to 90°F → insulated', () => {
      const alert = call(89.5, 50);
      expect(alert.level).toBe('insulated');
      expect(alert.headline).toContain('90°F');
    });

    it('89°F → not insulated (ice-pack caution instead)', () => {
      const alert = call(89, 50);
      expect(alert.level).toBe('caution');
    });
  });

  describe('heat hard hold (100°F+)', () => {
    it('blocks shipping at exactly 100°F', () => {
      const alert = call(100, 70);
      expect(alert.level).toBe('danger');
      expect(alert.headline).toContain('Do not ship');
      expect(alert.headline).toContain('100°F');
    });

    it('blocks shipping at 105°F', () => {
      expect(call(105, 75).level).toBe('danger');
    });

    it('99°F is NOT a hard hold', () => {
      expect(call(99, 70).level).not.toBe('danger');
    });
  });

  describe('low temperature thresholds', () => {
    it('blocks shipping at exactly 35°F', () => {
      const alert = call(50, 35);
      expect(alert.level).toBe('danger');
      expect(alert.headline).toContain('Do not ship');
      expect(alert.headline).toContain('35°F');
    });

    it('allows shipping at 36°F', () => {
      expect(call(50, 36).level).not.toBe('danger');
    });

    it('handles null low temperature', () => {
      expect(call(75, null).level).toBe('safe');
    });
  });

  describe('ice pack recommendations', () => {
    it('recommends ice pack at exactly 80°F', () => {
      const alert = call(80, 65);
      expect(alert.level).toBe('caution');
      expect(alert.headline).toContain('Ice pack');
    });
  });

  describe('heat pack recommendations', () => {
    it('recommends heat pack at exactly 45°F', () => {
      const alert = call(75, 45);
      expect(alert.level).toBe('caution');
      expect(alert.headline).toContain('Heat pack');
    });
  });

  describe('safe shipping', () => {
    it('marks as safe with moderate temperatures', () => {
      const alert = call(72, 60);
      expect(alert.level).toBe('safe');
      expect(alert.headline).toContain('Safe to ship');
    });

    it('handles missing low temperature', () => {
      const alert = call(70, null);
      expect(alert.level).toBe('safe');
      expect(alert.headline).toContain('70°F');
    });
  });

  describe('unavailable forecast', () => {
    it('returns unknown when forecast is unavailable', () => {
      const alert = call(null, 50);
      expect(alert.level).toBe('unknown');
      expect(alert.headline).toContain('Forecast unavailable');
    });
  });
});
