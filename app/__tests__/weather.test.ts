import { nextShipDate, remainingShipDaysThisWeek, HOLIDAY_DATES } from '../weather.server';

// June 2026 is CDT (UTC-5). To represent a Central time, add 5h to get UTC.
// e.g. Tue Jun 2 9:00 AM CDT  = new Date("2026-06-02T14:00:00Z")
//      Tue Jun 2 1:00 PM CDT  = new Date("2026-06-02T18:00:00Z")
//
// June 2026 calendar: Jun 1 Mon, 2 Tue, 3 Wed, 4 Thu, 5 Fri, 6 Sat, 7 Sun, 8 Mon, 9 Tue, 15 Mon.
// Holidays used: 2026-05-25 (Memorial Day, Monday), 2028-07-04 (Tuesday).

function ct(isoUtc: string): Date { return new Date(isoUtc); }

describe('nextShipDate', () => {
  describe('normal weekly schedule (Mon + Tue primary, Wed restricted)', () => {
    it('Sunday → next Monday, no restriction', () => {
      const { date, isWednesdayOnly } = nextShipDate(ct('2026-06-07T14:00:00Z')); // Sun Jun 7
      expect(date.toISOString().slice(0, 10)).toBe('2026-06-08');
      expect(isWednesdayOnly).toBe(false);
    });

    it('Monday before 1 PM → same Monday, no restriction', () => {
      const { date, isWednesdayOnly } = nextShipDate(ct('2026-06-08T14:00:00Z')); // Mon Jun 8, 9 AM CDT
      expect(date.toISOString().slice(0, 10)).toBe('2026-06-08');
      expect(isWednesdayOnly).toBe(false);
    });

    it('Monday after 1 PM → Tuesday, no restriction', () => {
      const { date, isWednesdayOnly } = nextShipDate(ct('2026-06-08T19:00:00Z')); // Mon Jun 8, 2 PM CDT
      expect(date.toISOString().slice(0, 10)).toBe('2026-06-09');
      expect(isWednesdayOnly).toBe(false);
    });

    it('Tuesday before 1 PM → same Tuesday, no restriction', () => {
      const { date, isWednesdayOnly } = nextShipDate(ct('2026-06-02T17:59:00Z')); // Tue Jun 2, 12:59 PM CDT
      expect(date.toISOString().slice(0, 10)).toBe('2026-06-02');
      expect(isWednesdayOnly).toBe(false);
    });

    it('Tuesday exactly at 1 PM → Wednesday, restriction', () => {
      const { date, isWednesdayOnly } = nextShipDate(ct('2026-06-02T18:00:00Z')); // Tue Jun 2, 1:00 PM CDT
      expect(date.toISOString().slice(0, 10)).toBe('2026-06-03');
      expect(isWednesdayOnly).toBe(true);
    });

    it('Tuesday after 1 PM → Wednesday, restriction', () => {
      const { date, isWednesdayOnly } = nextShipDate(ct('2026-06-02T19:00:00Z')); // Tue Jun 2, 2:00 PM CDT
      expect(date.toISOString().slice(0, 10)).toBe('2026-06-03');
      expect(isWednesdayOnly).toBe(true);
    });

    it('Wednesday → next Monday, no restriction', () => {
      const { date, isWednesdayOnly } = nextShipDate(ct('2026-06-03T14:00:00Z')); // Wed Jun 3
      expect(date.toISOString().slice(0, 10)).toBe('2026-06-08');
      expect(isWednesdayOnly).toBe(false);
    });

    it('Thursday → next Monday, no restriction', () => {
      const { date, isWednesdayOnly } = nextShipDate(ct('2026-06-04T14:00:00Z'));
      expect(date.toISOString().slice(0, 10)).toBe('2026-06-08');
      expect(isWednesdayOnly).toBe(false);
    });

    it('Friday → next Monday, no restriction', () => {
      const { date, isWednesdayOnly } = nextShipDate(ct('2026-06-05T14:00:00Z'));
      expect(date.toISOString().slice(0, 10)).toBe('2026-06-08');
      expect(isWednesdayOnly).toBe(false);
    });

    it('Saturday → next Monday, no restriction', () => {
      const { date, isWednesdayOnly } = nextShipDate(ct('2026-06-06T14:00:00Z'));
      expect(date.toISOString().slice(0, 10)).toBe('2026-06-08');
      expect(isWednesdayOnly).toBe(false);
    });
  });

  describe('holiday handling', () => {
    it('confirms holiday dates used in tests', () => {
      expect(HOLIDAY_DATES.has('2028-07-04')).toBe(true); // Tuesday
      expect(HOLIDAY_DATES.has('2026-05-25')).toBe(true); // Monday (Memorial Day)
    });

    it('Monday (not a holiday) before a holiday Tuesday → ships that Monday', () => {
      // Mon Jul 3, 2028 9 AM CDT — Monday is open, Tuesday Jul 4 is the holiday
      const { date, isWednesdayOnly } = nextShipDate(ct('2028-07-03T14:00:00Z'));
      expect(date.toISOString().slice(0, 10)).toBe('2028-07-03');
      expect(isWednesdayOnly).toBe(false);
    });

    it('Monday after cutoff before a holiday Tuesday → Wednesday with restriction', () => {
      // Mon Jul 3, 2028 2 PM CDT — past cutoff, Tuesday Jul 4 is a holiday
      const { date, isWednesdayOnly } = nextShipDate(ct('2028-07-03T19:00:00Z'));
      expect(date.toISOString().slice(0, 10)).toBe('2028-07-05');
      expect(isWednesdayOnly).toBe(true);
    });

    it('holiday Tuesday before 1 PM → ships Wednesday with restriction', () => {
      const { date, isWednesdayOnly } = nextShipDate(ct('2028-07-04T14:00:00Z'));
      expect(date.toISOString().slice(0, 10)).toBe('2028-07-05');
      expect(isWednesdayOnly).toBe(true);
    });

    it('holiday Tuesday after 1 PM → ships Wednesday with restriction', () => {
      const { date, isWednesdayOnly } = nextShipDate(ct('2028-07-04T19:00:00Z'));
      expect(date.toISOString().slice(0, 10)).toBe('2028-07-05');
      expect(isWednesdayOnly).toBe(true);
    });

    it('Sunday before a holiday Monday → skips to Tuesday', () => {
      // Sun May 24, 2026 — Monday May 25 is Memorial Day
      const { date, isWednesdayOnly } = nextShipDate(ct('2026-05-24T14:00:00Z'));
      expect(date.toISOString().slice(0, 10)).toBe('2026-05-26');
      expect(isWednesdayOnly).toBe(false);
    });

    it('holiday Monday → ships Tuesday', () => {
      // Mon May 25, 2026 9 AM CDT (holiday)
      const { date, isWednesdayOnly } = nextShipDate(ct('2026-05-25T14:00:00Z'));
      expect(date.toISOString().slice(0, 10)).toBe('2026-05-26');
      expect(isWednesdayOnly).toBe(false);
    });
  });

  describe('return value shape', () => {
    it('always returns { date: Date, isWednesdayOnly: boolean }', () => {
      const result = nextShipDate(ct('2026-06-02T14:00:00Z'));
      expect(result).toHaveProperty('date');
      expect(result).toHaveProperty('isWednesdayOnly');
      expect(result.date).toBeInstanceOf(Date);
      expect(typeof result.isWednesdayOnly).toBe('boolean');
    });

    it('returned date is never in the past relative to input', () => {
      const now = ct('2026-06-02T14:00:00Z');
      const { date } = nextShipDate(now);
      expect(date.getTime()).toBeGreaterThanOrEqual(
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).getTime()
      );
    });
  });
});

describe('remainingShipDaysThisWeek (in-week roll-forward, never next week)', () => {
  // June 2026: 8 Mon, 9 Tue, 10 Wed, 15 Mon (Wed marked with *)
  const days = (d: string) =>
    remainingShipDaysThisWeek(new Date(d)).map((x) => `${x.date.toISOString().slice(0, 10)}${x.restricted ? '*' : ''}`);

  it('Monday → Tuesday then restricted Wednesday (same week only)', () => {
    expect(days('2026-06-08')).toEqual(['2026-06-09', '2026-06-10*']);
  });

  it('Tuesday → restricted Wednesday only (never jumps to next Monday)', () => {
    // The repeated "SHIPS MON, JUN 22" bug was this returning a next-week date.
    expect(days('2026-06-09')).toEqual(['2026-06-10*']);
  });

  it('Wednesday → nothing (last ship day of the week)', () => {
    expect(days('2026-06-10')).toEqual([]);
  });

  it('skips a holiday Tuesday but keeps the eligible Wednesday', () => {
    // From Mon 2028-07-03: Tuesday Jul 4 is a holiday → skipped; Wednesday Jul 5* kept
    expect(days('2028-07-03')).toEqual(['2028-07-05*']);
  });
});
