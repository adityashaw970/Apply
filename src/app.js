const express = require('express');
const cors = require('cors');
const { AIService } = require('../engine/ai-service');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'MassApply AI Server' });
});

// ─── Answer form questions (batch) ───
// Receives ALL questions at once, returns ALL answers at once
app.post('/api/answer', async (req, res) => {
  try {
    const { questions, jobContext, userProfile, apiKeys } = req.body;

    if (!apiKeys || apiKeys.trim() === '') {
      return res.status(400).json({
        error: 'No API key configured',
        answers: questions.map(q => ({ label: q.label, answer: '', error: 'No API key' }))
      });
    }

    if (!questions || questions.length === 0) {
      return res.json({ answers: [] });
    }

    const aiService = new AIService(apiKeys);
    aiService.initialize();

    // Send ALL questions in one batch to Gemini
    const answers = await aiService.answerQuestions(questions, jobContext, userProfile);
    res.json({ answers });
  } catch (err) {
    console.error('AI answer error:', err.message);
    res.status(500).json({
      error: err.message,
      answers: (req.body.questions || []).map(q => ({
        label: q.label, answer: '', error: err.message
      }))
    });
  }
});

// ─── Summarize job description ───
app.post('/api/summarize', async (req, res) => {
  try {
    const { rawText, apiKeys } = req.body;

    if (!apiKeys || apiKeys.trim() === '') {
      return res.status(400).json({ error: 'No API key configured' });
    }

    const aiService = new AIService(apiKeys);
    aiService.initialize();

    const summary = await aiService.summarizeJobDescription(rawText || '');
    res.json(summary);
  } catch (err) {
    console.error('Summarize error:', err.message);
    res.status(500).json({
      title: 'Unknown', company: 'Unknown',
      description: '', requirements: '', location: ''
    });
  }
});

module.exports = app;
