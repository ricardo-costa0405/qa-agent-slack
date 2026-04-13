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

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3:8b';
const PORT = process.env.PORT || 3000;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

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

async function queryOllama(userMessage) {
  const OLLAMA_URL = process.env.OLLAMA_URL;
  
  // Check if OLLAMA_URL is set for local development
  if (!OLLAMA_URL || OLLAMA_URL === 'http://localhost:11434') {
    console.log('No Ollama configured - using demo mode');
    return "I'm running in demo mode! Waiting for AI configuration.";
  }
  
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

  try {
    const response = await axios.post(`${OLLAMA_URL}/api/generate`, {
      model: OLLAMA_MODEL,
      prompt: `System: ${systemPrompt}\n\nUser: ${userMessage}\n\nAssistant:`,
      stream: false
    }, {
      timeout: 180000
    });

    return response.data.response;
  } catch (err) {
    console.error('Ollama error:', err.message);
    throw new Error('Failed to get response from AI');
  }
}

app.get('/', (req, res) => {
  res.json({
    status: 'running',
    model: OLLAMA_MODEL,
    slack: SLACK_BOT_TOKEN ? 'configured' : 'not configured',
    endpoints: {
      health: 'GET /health',
      chat: 'POST /webhook',
      slack: 'POST /slack (for Slack Events)'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Slack verification endpoint (GET for URL verification)
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
    const response = await queryOllama(userMessage);
    
    res.json({ response });
  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/slack', async (req, res) => {
  try {
    const { challenge, type, token } = req.body;
    
    // Slack URL verification (required for Event Subscriptions)
    if (type === 'url_verification') {
      console.log('Slack URL verification challenge:', challenge);
      return res.json({ challenge });
    }

    // Check if from Slack (verify token if set)
    if (process.env.SLACK_VERIFICATION_TOKEN && token !== process.env.SLACK_VERIFICATION_TOKEN) {
      console.log('Invalid token, ignoring');
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
    
    // Only respond to mentions
    if (!userMessage.includes('Analyst') && !userMessage.includes('@')) {
      console.log('Not mentioning bot, ignoring');
      return res.status(200).send();
    }
    
    const response = await queryOllama(userMessage);
    
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
    } else {
      console.log('⚠ No SLACK_BOT_TOKEN configured - cannot reply in thread');
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
  console.log(`   Model: ${OLLAMA_MODEL}`);
  console.log(`   Slack: ${SLACK_BOT_TOKEN ? 'configured' : 'NOT configured'}`);
  console.log(`   Endpoints: /webhook, /slack`);
});

export default app;