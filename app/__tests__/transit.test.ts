import { getTransitDays } from '../transit.server';

// Mock Prisma to avoid DB connection issues in tests
jest.mock('../db.server', () => ({
  __esModule: true,
  default: {
    transitRule: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  },
}));

describe('getTransitDays', () => {
  describe('reship handling', () => {
    it('returns 2 days for any reship', async () => {
      const days = await getTransitDays('Reship - Ground');
      expect(days).toBe(2);
    });

    it('returns 2 days for RESHIP all caps', async () => {
      const days = await getTransitDays('RESHIP');
      expect(days).toBe(2);
    });
  });

  describe('2-day shipping method keyword matching', () => {
    it('matches "2-day" keyword in "Free 2-Day Shipping"', async () => {
      const days = await getTransitDays('Free 2-Day Shipping');
      expect(days).toBe(2);
    });

    it('matches "2-day" keyword in "Free 2-Day Shipping (Ships Mondays)"', async () => {
      const days = await getTransitDays('Free 2-Day Shipping (Ships Mondays)');
      expect(days).toBe(2);
    });

    it('matches "2-day" keyword exactly', async () => {
      const days = await getTransitDays('2-day');
      expect(days).toBe(2);
    });

    it('matches case-insensitive "2-DAY"', async () => {
      const days = await getTransitDays('2-DAY');
      expect(days).toBe(2);
    });
  });

  describe('other keyword patterns', () => {
    it('matches "next day" keyword to 1 day', async () => {
      const days = await getTransitDays('next day');
      expect(days).toBe(1);
    });

    it('matches "ground" keyword to 5 days', async () => {
      const days = await getTransitDays('UPS Ground');
      expect(days).toBe(5);
    });

    it('matches "express" keyword to 2 days', async () => {
      const days = await getTransitDays('express');
      expect(days).toBe(2);
    });
  });

  describe('fallback behavior', () => {
    it('returns 5 as default for unknown method', async () => {
      const days = await getTransitDays('Unknown Carrier XYZ');
      expect(days).toBe(5);
    });
  });
});
