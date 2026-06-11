import { getAlert } from '../alert';

describe('getAlert', () => {
  const defaultThresholds = {
    dontShipAbove: 90,
    icePackAbove: 80,
    dontShipBelow: 35,
    cautionBelow: 45,
  };

  describe('temperature rounding', () => {
    it('rounds 89.4°F down to 89°F and allows shipping', () => {
      const alert = getAlert(89.4, 50, defaultThresholds.dontShipAbove, defaultThresholds.icePackAbove, defaultThresholds.dontShipBelow, defaultThresholds.cautionBelow);
      expect(alert.level).not.toBe('danger');
    });

    it('rounds 89.5°F up to 90°F and blocks shipping', () => {
      const alert = getAlert(89.5, 50, defaultThresholds.dontShipAbove, defaultThresholds.icePackAbove, defaultThresholds.dontShipBelow, defaultThresholds.cautionBelow);
      expect(alert.level).toBe('danger');
      expect(alert.headline).toContain('90°F');
    });

    it('rounds 89.6°F up to 90°F and blocks shipping', () => {
      const alert = getAlert(89.6, 50, defaultThresholds.dontShipAbove, defaultThresholds.icePackAbove, defaultThresholds.dontShipBelow, defaultThresholds.cautionBelow);
      expect(alert.level).toBe('danger');
      expect(alert.headline).toContain('90°F');
    });

    it('rounds 90.4°F down to 90°F and blocks shipping', () => {
      const alert = getAlert(90.4, 50, defaultThresholds.dontShipAbove, defaultThresholds.icePackAbove, defaultThresholds.dontShipBelow, defaultThresholds.cautionBelow);
      expect(alert.level).toBe('danger');
      expect(alert.headline).toContain('90°F');
    });
  });

  describe('high temperature thresholds', () => {
    it('blocks shipping at exactly 90°F', () => {
      const alert = getAlert(90, 50, 90, 80, 35, 45);
      expect(alert.level).toBe('danger');
      expect(alert.headline).toContain('Do not ship');
    });

    it('allows shipping at 89°F', () => {
      const alert = getAlert(89, 50, 90, 80, 35, 45);
      expect(alert.level).not.toBe('danger');
    });

    it('blocks shipping at 96.5°F (South Carolina scenario)', () => {
      const alert = getAlert(96.5, 74.55, 90, 80, 35, 45);
      expect(alert.level).toBe('danger');
      expect(alert.headline).toContain('97°F');
    });
  });

  describe('low temperature thresholds', () => {
    it('blocks shipping at exactly 35°F', () => {
      const alert = getAlert(50, 35, 90, 80, 35, 45);
      expect(alert.level).toBe('danger');
      expect(alert.headline).toContain('Do not ship');
      expect(alert.headline).toContain('35°F');
    });

    it('allows shipping at 36°F', () => {
      const alert = getAlert(50, 36, 90, 80, 35, 45);
      expect(alert.level).not.toBe('danger');
    });

    it('handles null low temperature', () => {
      const alert = getAlert(75, null, 90, 80, 35, 45);
      expect(alert.level).toBe('safe');
    });
  });

  describe('ice pack recommendations', () => {
    it('recommends ice pack at exactly 80°F', () => {
      const alert = getAlert(80, 65, 90, 80, 35, 45);
      expect(alert.level).toBe('caution');
      expect(alert.headline).toContain('Ice pack');
    });

    it('allows shipping with caution at 80°F', () => {
      const alert = getAlert(80, 65, 90, 80, 35, 45);
      expect(alert.level).toBe('caution');
    });
  });

  describe('heat pack recommendations', () => {
    it('recommends heat pack at exactly 45°F', () => {
      const alert = getAlert(75, 45, 90, 80, 35, 45);
      expect(alert.level).toBe('caution');
      expect(alert.headline).toContain('Heat pack');
    });

    it('allows shipping with caution at 45°F', () => {
      const alert = getAlert(75, 45, 90, 80, 35, 45);
      expect(alert.level).toBe('caution');
    });
  });

  describe('safe shipping', () => {
    it('marks as safe with moderate temperatures', () => {
      const alert = getAlert(72, 60, 90, 80, 35, 45);
      expect(alert.level).toBe('safe');
      expect(alert.headline).toContain('Safe to ship');
    });

    it('handles missing low temperature', () => {
      const alert = getAlert(70, null, 90, 80, 35, 45);
      expect(alert.level).toBe('safe');
      expect(alert.headline).toContain('70°F');
    });
  });

  describe('unavailable forecast', () => {
    it('returns unknown when forecast is unavailable', () => {
      const alert = getAlert(null, 50, 90, 80, 35, 45);
      expect(alert.level).toBe('unknown');
      expect(alert.headline).toContain('Forecast unavailable');
    });
  });
});
