import { buildWeatherDelayEmail, sendWeatherDelayEmail } from '../weather-email.server';
import { nextWeatherRecheck, weatherShippingDay } from '../weather-recheck';
const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({__esModule:true, default:{createTransport:()=>({sendMail:(...args:unknown[])=>mockSendMail(...args)})}}));
beforeEach(()=>{mockSendMail.mockReset();});
it.each([
 ['2026-09-20T20:59:59Z','2026-09-20T21:00:00.000Z','Sunday, September 20'],
 ['2026-09-20T21:00:00Z','2026-09-21T21:00:00.000Z','Monday, September 21'],
 ['2026-09-21T21:00:00Z','2026-09-22T21:00:00.000Z','Tuesday, September 22'],
 ['2026-09-22T21:00:00Z','2026-09-27T21:00:00.000Z','Sunday, September 27'],
 ['2026-10-31T12:00:00Z','2026-11-01T22:00:00.000Z','Sunday, November 1'],
 ['2026-03-08T12:00:00Z','2026-03-08T21:00:00.000Z','Sunday, March 8']
])('renders the next real recheck day and date after %s',(now,expected,label)=>{
 const time=new Date(now),html=buildWeatherDelayEmail('Alex','#TEST-9001',undefined,undefined,undefined,undefined,time);
 expect(nextWeatherRecheck(time).toISOString()).toBe(expected);expect(html).toContain(label+' at 4:00 PM Central');expect(html).toContain('No reply is needed.');expect(html).toContain('automated weather-hold notice');expect(html).toContain('full UPS Store street address');expect(html).not.toContain('until we hear from you');expect(html).not.toContain('reevaluate shipping next week');expect(html).not.toContain('—');expect(mockSendMail).not.toHaveBeenCalled();
});
it('the actual sender uses the updated template and preserves provider errors',async()=>{
 mockSendMail.mockResolvedValue({});expect(await sendWeatherDelayEmail('alex@example.invalid','Alex','#TEST-9001')).toBe(true);
 expect(mockSendMail.mock.calls[0][0]).toMatchObject({to:'alex@example.invalid',subject:'Weather hold on your order #TEST-9001'});expect(mockSendMail.mock.calls[0][0].html).toContain('No reply is needed.');
 mockSendMail.mockRejectedValue(new Error('Synthetic mail outage'));const spy=jest.spyOn(console,'error').mockImplementation(()=>{});expect(await sendWeatherDelayEmail('alex@example.invalid','Alex','#TEST-9001')).toBe(false);spy.mockRestore();
});

it.each([
 ['2026-09-20T20:59:59Z', 'Monday, September 21'],
 ['2026-09-20T21:00:00Z', 'Tuesday, September 22'],
 ['2026-09-21T21:00:00Z', 'Wednesday, September 23'],
 ['2026-09-22T21:00:00Z', 'Monday, September 28'],
 ['2026-10-31T12:00:00Z', 'Monday, November 2'],
 ['2026-03-08T12:00:00Z', 'Monday, March 9']
])('pairs the recheck with its next shipping day after %s', (now, expected) => {
 const time = new Date(now);
 expect(weatherShippingDay(time)).toBe(expected);
 const html = buildWeatherDelayEmail('Alex', '#TEST-9001', undefined, undefined, undefined, undefined, time);
 expect(html).toContain('do our best to get your order out on');
 expect(html).toContain(expected);
 expect(html).toContain('Monday, Tuesday, and Wednesday');
 expect(html).toContain('Replies come directly to our team.');
});

it('keeps the order number intact in the reply button and renders zero-degree forecasts', () => {
 const html = buildWeatherDelayEmail('Alex', '#TEST-9001', undefined, 'Tuesday, September 29', 0, 'UPS 2nd Day Air');
 const href = html.match(/href="(mailto:support[^\"]+subject=[^\"]+)"/)![1];
 const target = new URL(href);
 expect(target.searchParams.get('subject')).toBe('Access Point Address for Order #TEST-9001');
 expect(target.hash).toBe('');
 expect(html).toContain('0°F');
 expect(html).toContain('UPS 2nd Day Air');
 expect(html).not.toContain('Estimated Delivery:');
 expect(mockSendMail).not.toHaveBeenCalled();
});
