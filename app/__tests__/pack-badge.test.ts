import { getPackBadge } from '../pack-badge';

describe('getPackBadge', () => {
  describe('Breeder Pack', () => {
    it('should return breeder pack badge for breeder pack variant', () => {
      const result = getPackBadge('Breeder Pack', 2, 'Shrimp');
      expect(result).toEqual({
        text: '= 24 TOTAL (4M/16F)',
        bg: '#007a5a',
      });
    });

    it('should calculate extras correctly for breeder pack', () => {
      const result = getPackBadge('breeder pack', 1, 'Shrimp');
      expect(result).toEqual({
        text: '= 12 TOTAL (2M/8F)',
        bg: '#007a5a',
      });
    });
  });

  describe('Ultimate Pack', () => {
    it('should return ultimate pack badge for ultimate pack variant', () => {
      const result = getPackBadge('Ultimate Pack', 1, 'Snowball Shrimp');
      expect(result).toEqual({
        text: 'ULTIMATE = 12 TOTAL (2M/8F)',
        bg: '#5c007a',
      });
    });

    it('should calculate extras correctly for ultimate pack (20% bonus)', () => {
      const result = getPackBadge('Ultimate Pack', 2, 'Shrimp');
      expect(result).toEqual({
        text: 'ULTIMATE = 24 TOTAL (4M/16F)',
        bg: '#5c007a',
      });
    });
  });

  describe('Skittles Pack', () => {
    it('should show correct amount for skittles (no 10x multiplier)', () => {
      const result = getPackBadge(null, 5, 'Skittles');
      expect(result).toEqual({
        text: '= 6 TOTAL',
        bg: '#b45309',
      });
    });

    it('should handle skittles pack variant', () => {
      const result = getPackBadge('Skittles Pack', 3, 'Mixed Color Skittles');
      expect(result).toEqual({
        text: '= 3 TOTAL',
        bg: '#b45309',
      });
    });

    it('should calculate bonus shrimp correctly (1 per 5)', () => {
      const result = getPackBadge(null, 10, 'Skittles');
      expect(result).toEqual({
        text: '= 12 TOTAL',
        bg: '#b45309',
      });
    });
  });

  describe('Numeric Variants', () => {
    it('should multiply pack size by quantity', () => {
      const result = getPackBadge('25 Pack', 2, 'Cherry Shrimp');
      expect(result).toEqual({
        text: '= 60 TOTAL',
        bg: '#b45309',
      });
    });

    it('should add 20% bonus for numeric packs', () => {
      const result = getPackBadge('10 Pack', 3, 'Red Shrimp');
      expect(result).toEqual({
        text: '= 36 TOTAL',
        bg: '#b45309',
      });
    });

    it('should return null if variant has no number > 1', () => {
      const result = getPackBadge('Default Title', 5, 'Cherry Shrimp');
      expect(result).not.toBeNull();
      expect(result?.text).toBe('= 6 TOTAL');
    });
  });

  describe('Live Animal Detection', () => {
    it('should detect shrimp ending title', () => {
      const result = getPackBadge(null, 5, 'Snowball Shrimp');
      expect(result).not.toBeNull();
    });

    it('should not detect shrimp in middle (food product)', () => {
      const result = getPackBadge(null, 5, 'Baby Shrimp Food');
      expect(result).toBeNull();
    });

    it('should detect snails', () => {
      const result = getPackBadge(null, 3, 'Assassin Snails');
      expect(result).not.toBeNull();
    });

    it('should detect crayfish', () => {
      const result = getPackBadge(null, 2, 'Crayfish Mix');
      expect(result).not.toBeNull();
    });

    it('should detect crab', () => {
      const result = getPackBadge(null, 1, 'Vampire Crab');
      expect(result).not.toBeNull();
    });

    it('should detect culls', () => {
      const result = getPackBadge(null, 10, 'Grade A Culls');
      expect(result).not.toBeNull();
    });

    it('should return null for non-live animal titles', () => {
      const result = getPackBadge(null, 5, 'Fish Food');
      expect(result).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    it('should handle quantity of 0', () => {
      const result = getPackBadge(null, 0, 'Shrimp');
      expect(result).toEqual({
        text: '= 0 TOTAL',
        bg: '#b45309',
      });
    });

    it('should handle large quantities', () => {
      const result = getPackBadge('50 Pack', 10, 'Cherry Shrimp');
      expect(result).toEqual({
        text: '= 600 TOTAL',
        bg: '#b45309',
      });
    });

    it('should handle null variant for live animals', () => {
      const result = getPackBadge(null, 5, 'Crayfish');
      expect(result).toEqual({
        text: '= 6 TOTAL',
        bg: '#b45309',
      });
    });
  });
});
