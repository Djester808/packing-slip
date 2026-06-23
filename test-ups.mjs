import { getUPSTransitDays } from './build/server/index.js';

// Test the UPS API with different methods
const testMethods = [
  'UPS 2nd Day Air',
  'UPS Next Day Air',
  'UPS Ground',
  'UPS Next Day Air Saver'
];

const zip = '12603';
const shipDate = new Date('2026-04-27');

console.log('Testing UPS Transit Days calculation:\n');

for (const method of testMethods) {
  try {
    const days = await getUPSTransitDays(zip, method, shipDate, 'NY', 'Highland');
    console.log(`✓ ${method.padEnd(25)} → ${days} days`);
  } catch (e) {
    console.log(`✗ ${method.padEnd(25)} → ERROR: ${e.message.substring(0, 50)}`);
  }
}
