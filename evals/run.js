import { readFileSync } from 'fs';

const cases = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf-8'));

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runEvals() {
  let correct = 0;
  const failures = [];

  for (const testCase of cases) {
    const response = await fetch('http://localhost:3000/api/triage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: testCase.text })
    });

    const result = await response.json();

    if (result.category === testCase.expected_category) {
      correct++;
    } else {
      failures.push({
        text: testCase.text,
        expected: testCase.expected_category,
        got: result.category ?? `ERROR: ${JSON.stringify(result)}`
      });
    }

    await sleep(2000);
  }

  console.log(`${correct}/${cases.length} correct`);
  if (failures.length > 0) {
    console.log('Failures:');
    console.log(JSON.stringify(failures, null, 2));
  }
}

runEvals();