import express from 'express';
import axios from 'axios';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

// AI Configuration
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3:8b';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

let mockJiraData = { issues: [] };
let mockConfluenceData = { pages: [] };

function loadMockData() {
  const baseDir = process.cwd();
  try {
    const jiraPath = join(baseDir, 'data', 'mock_jira.json');
    const confluencePath = join(baseDir, 'data', 'mock_confluence.json');
    mockJiraData = JSON.parse(readFileSync(jiraPath, 'utf-8'));
    mockConfluenceData = JSON.parse(readFileSync(confluencePath, 'utf-8'));
    console.log('✓ Mock data loaded');
  } catch (err) {
    console.log('⚠ Mock data files not found, using empty context');
  }
}

async function queryAI(userMessage) {
  const systemPrompt = `You are a QA Agent assistant for a software development team.
You have access to the following data sources:

JIRA ISSUES:
${JSON.stringify(mockJiraData.issues, null, 2)}

CONFLUENCE PAGES:
${JSON.stringify(mockConfluenceData.pages, null, 2)}

Instructions:
- Answer questions based on the data above
- If you can't find info, say so
- Be concise and helpful
- Reference issue keys (QA-XXX) when relevant`;

  // Try OpenAI first (if API key provided)
  if (OPENAI_API_KEY) {
    try {
      console.log('Using OpenAI...');
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.7
      }, {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });
      return response.data.choices[0].message.content;
    } catch (err) {
      console.error('OpenAI error:', err.message);
    }
  }

  // Try Claude (if API key provided)
  if (CLAUDE_API_KEY) {
    try {
      console.log('Using Claude...');
      const response = await axios.post('https://api.anthropic.com/v1/messages', {
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userMessage }
        ]
      }, {
        headers: {
          'x-api-key': CLAUDE_API_KEY,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01'
        },
        timeout: 30000
      });
      return response.data.content[0].text;
    } catch (err) {
      console.error('Claude error:', err.message);
    }
  }

  // Try Ollama (fallback) - use if OLLAMA_URL configured (including localhost)
  if (OLLAMA_URL) {
    try {
      console.log('Using Ollama:', OLLAMA_URL);
      const response = await axios.post(`${OLLAMA_URL}/api/generate`, {
        model: OLLAMA_MODEL,
        prompt: `System: ${systemPrompt}\n\nUser: ${userMessage}\n\nAssistant:`,
        stream: false
      }, {
        timeout: 60000,
        headers: { 'Content-Type': 'application/json' }
      });
      return response.data.response;
    } catch (err) {
      console.error('Ollama error:', err.message);
    }
  }

  // Demo mode
  return "Configure an AI: add OLLAMA_URL, OPENAI_API_KEY, or CLAUDE_API_KEY to environment.";

}

app.get('/', (req, res) => {
  res.json({
    status: 'running',
    ai: {
      openai: !!OPENAI_API_KEY,
      claude: !!CLAUDE_API_KEY,
      ollama: !!OLLAMA_URL
    },
    endpoints: {
      health: 'GET /health',
      chat: 'POST /webhook',
      slack: 'POST /slack'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/slack', (req, res) => {
  res.status(200).send('OK');
});

app.post('/webhook', async (req, res) => {
  try {
    const { message, text } = req.body;
    const userMessage = message || text || '';
    
    if (!userMessage) {
      return res.status(400).json({ error: 'No message provided' });
    }

    console.log(`Processing: "${userMessage}"`);
    const response = await queryAI(userMessage);
    
    res.json({ response });
  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/slack', async (req, res) => {
  try {
    const { challenge, type, token } = req.body;
    
    if (type === 'url_verification') {
      return res.json({ challenge });
    }

    if (process.env.SLACK_VERIFICATION_TOKEN && token !== process.env.SLACK_VERIFICATION_TOKEN) {
      return res.status(200).send();
    }

    const { event } = req.body;
    if (!event || event.type !== 'message' || event.subtype === 'bot_message') {
      return res.status(200).send();
    }

    const userMessage = event.text;
    const channelId = event.channel;
    const threadTs = event.thread_ts || event.ts;
    
    console.log(`Slack message: "${userMessage}" (thread: ${threadTs})`);
    
    if (!userMessage.includes('Analyst') && !userMessage.includes('@')) {
      return res.status(200).send();
    }
    
    const response = await queryAI(userMessage);
    
    if (SLACK_BOT_TOKEN) {
      await axios.post('https://slack.com/api/chat.postMessage', {
        channel: channelId,
        thread_ts: threadTs,
        text: response
      }, {
        headers: {
          'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      console.log('✓ Replied in thread');
    }

    res.status(200).send();
  } catch (err) {
    console.error('Slack error:', err.message);
    res.status(500).send();
  }
});

loadMockData();

app.listen(PORT, () => {
  console.log(`🚀 QA Agent running on http://localhost:${PORT}`);
  console.log(`   AI: ${OPENAI_API_KEY ? 'OpenAI' : CLAUDE_API_KEY ? 'Claude' : OLLAMA_URL ? 'Ollama' : 'Demo'}`);
  console.log(`   Endpoints: /webhook, /slack`);
});

export default app;