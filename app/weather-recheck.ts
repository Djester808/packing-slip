// Keep this schedule aligned with the Support Desk weather-check job.
export function nextWeatherRecheck(time = new Date()): Date {
  const candidate = new Date(time);
  candidate.setUTCHours(0, 0, 0, 0);
  const format = new Intl.DateTimeFormat('en-US', {timeZone:'America/Chicago', weekday:'short', hour:'2-digit', hourCycle:'h23'});
  for (let i = 0; i < 9 * 24; i++) {
    const parts = Object.fromEntries(format.formatToParts(candidate).map(p => [p.type, p.value]));
    if (candidate > time && ['Sun','Mon','Tue'].includes(parts.weekday) && parts.hour === '16') return candidate;
    candidate.setUTCHours(candidate.getUTCHours() + 1);
  }
  throw new Error('The next weather recheck could not be calculated.');
}
export function weatherRecheckDay(time = new Date()): string {
  return nextWeatherRecheck(time).toLocaleDateString('en-US', {timeZone:'America/Chicago', weekday:'long', month:'long', day:'numeric'});
}

export function weatherShippingDay(time = new Date()): string {
  const shippingDay = new Date(nextWeatherRecheck(time).getTime() + 24 * 60 * 60 * 1000);
  return shippingDay.toLocaleDateString('en-US', {timeZone:'America/Chicago', weekday:'long', month:'long', day:'numeric'});
}
