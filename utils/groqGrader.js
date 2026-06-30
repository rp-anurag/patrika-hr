const axios = require('axios');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildPrompt(candidate, jdHtml, positionName) {
  const jdText  = stripHtml(jdHtml).substring(0, 3000);
  let skills = '';
  try {
    const s = candidate.parsedSkills ? JSON.parse(candidate.parsedSkills) : [];
    skills = Array.isArray(s) ? s.join(', ') : String(s);
  } catch(e) { skills = candidate.parsedSkills || ''; }

  const resumeText = [
    candidate.parsedSummary        ? `Summary: ${candidate.parsedSummary}` : '',
    candidate.parsedTotalExperience ? `Total Experience: ${candidate.parsedTotalExperience}` : '',
    candidate.parsedCurrentRole     ? `Current Role: ${candidate.parsedCurrentRole}` : '',
    skills                          ? `Skills: ${skills}` : '',
    candidate.parsedLocation        ? `Location: ${candidate.parsedLocation}` : '',
    candidate.parsedRawText         ? `Resume Extract:\n${candidate.parsedRawText.substring(0, 2500)}` : ''
  ].filter(Boolean).join('\n');

  return `You are a senior HR recruiter evaluating a candidate for a media company position.

POSITION APPLIED FOR: ${positionName}

JOB DESCRIPTION:
${jdText || '(No JD provided)'}

CANDIDATE PROFILE:
${resumeText || '(No resume data available)'}

Evaluate this candidate's fit strictly based on the JD requirements and candidate profile above.

Grade scale:
- A (80-100): Excellent fit — strong relevant experience, matches most key requirements, high confidence hire
- B (55-79): Good fit — meets core requirements, minor gaps that can be bridged
- C (30-54): Partial fit — relevant background but significant gaps in experience or skills
- D (0-29): Poor fit — does not meet key requirements or insufficient information to evaluate

Respond ONLY with valid JSON, no explanation outside the JSON:
{
  "grade": "A",
  "score": 85,
  "reason": "2-3 sentence explanation highlighting strengths and gaps."
}`;
}

exports.gradeWithAI = async function(candidate, jdHtml, positionName) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    return null; // No key configured — caller should fallback
  }

  try {
    const response = await axios.post(
      GROQ_API_URL,
      {
        model:       process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are a precise HR evaluation assistant. Always respond with valid JSON only.' },
          { role: 'user',   content: buildPrompt(candidate, jdHtml, positionName) }
        ],
        temperature:  0.1,
        max_tokens:   300,
        response_format: { type: 'json_object' }
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`,
          'Content-Type':  'application/json'
        },
        timeout: 15000
      }
    );

    const content = response.data.choices[0]?.message?.content || '';
    const parsed  = JSON.parse(content);

    const grade = ['A','B','C','D'].includes(parsed.grade) ? parsed.grade : 'D';
    const score = Math.min(100, Math.max(0, parseInt(parsed.score) || 0));
    const reason = (parsed.reason || '').substring(0, 1000);

    return { grade, score, reason, source: 'ai' };
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error('Groq grading error:', msg);
    return null; // fallback to keyword grader
  }
};
