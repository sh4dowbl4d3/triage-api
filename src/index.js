require('dotenv').config();

async function testConnection() {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
      messages: [
        { role: 'user', content: 'Reply with exactly one word: ready' }
      ]
    })
  });

  const data = await response.json();
  console.log(JSON.stringify(data, null, 2));
}

testConnection();
