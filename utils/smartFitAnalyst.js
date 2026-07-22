'use strict';

const axios = require('axios');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

const PARAM_META = {
  graduation:         { label: 'Graduation',              desc: 'Undergraduate degree — field relevance to the role, institution, completion' },
  pg:                 { label: 'Post Graduation (PG)',    desc: 'Masters/MBA/PG degree — relevance, institution; score 1 if no PG at all' },
  technicalEducation: { label: 'Technical Education',     desc: 'Technical diplomas, certifications, vocational courses relevant to the role' },
  experience:         { label: 'Experience',              desc: 'Years, recency, and role-relevance of professional work history' },
  technicalSkills:    { label: 'Technical Skills',        desc: 'Specific tools, software, programming languages, or technical competencies required' },
  location:           { label: 'Location',                desc: 'Current location vs job location — same city=5, same state=3-4, different state=1-2' },
};

/**
 * config = { graduation: 25, experience: 30, ... } — only enabled params, weights sum to 100
 */
async function analyseSmartFit(candidate, positionName, config) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || !apiKey.trim()) return null;

  const enabledParams = Object.keys(config).filter(k => config[k] > 0 && PARAM_META[k]);

  const paramInstructions = enabledParams.map(k =>
    `  "${k}": score 1-5 — ${PARAM_META[k].desc}`
  ).join('\n');

  const systemPrompt = `You are a resume screening assistant. Score a candidate on specific parameters for a job position.

SCORING SCALE (1-5):
  5 = Excellent match / strong evidence
  4 = Good match / clear evidence
  3 = Partial match / some evidence
  2 = Weak match / limited evidence
  1 = No match / not evidenced

PARAMETERS TO SCORE FOR THIS ANALYSIS:
${paramInstructions}

RULES:
- Base every score strictly on the candidate data provided.
- If a parameter has no data (e.g. no PG mentioned), score it 1-2 with Low confidence.
- Be brief in evidence — one sentence maximum per parameter.
- Never infer or use age, gender, religion, or family status.

RESPOND ONLY with valid JSON in this exact format:
{
  "scores": {
${enabledParams.map(k => `    "${k}": { "score": 3, "evidence": "one sentence", "confidence": "High" }`).join(',\n')}
  },
  "summary": "2-sentence overall fit summary"
}`;

  let skills = '';
  try {
    const s = candidate.parsedSkills ? JSON.parse(candidate.parsedSkills) : [];
    skills = Array.isArray(s) ? s.join(', ') : String(s);
  } catch(e) {}

  let experience = '';
  try {
    const exp = candidate.parsedExperienceEntries ? JSON.parse(candidate.parsedExperienceEntries) : [];
    experience = Array.isArray(exp)
      ? exp.map(e => `- ${e.title||''} at ${e.company||''} (${e.duration||''})`).join('\n')
      : '';
  } catch(e) {}

  let education = '';
  try {
    const edu = candidate.parsedEducation ? JSON.parse(candidate.parsedEducation) : [];
    education = Array.isArray(edu)
      ? edu.map(e => `- ${e.degree||''} ${e.field||''} from ${e.institution||''} (${e.year||''})`).join('\n')
      : '';
  } catch(e) {}

  const profile = [
    `NAME: ${candidate.fullName}`,
    `POSITION APPLIED: ${positionName}`,
    `CURRENT LOCATION: ${candidate.currentLocation || 'Not provided'}`,
    candidate.parsedCurrentRole      ? `CURRENT ROLE: ${candidate.parsedCurrentRole}` : '',
    candidate.parsedTotalExperience  ? `TOTAL EXPERIENCE: ${candidate.parsedTotalExperience}` : '',
    education                        ? `EDUCATION:\n${education}` : '',
    skills                           ? `SKILLS: ${skills}` : '',
    experience                       ? `EXPERIENCE:\n${experience}` : '',
    candidate.parsedRawText          ? `RESUME EXTRACT:\n${candidate.parsedRawText.substring(0, 2000)}` : '',
  ].filter(Boolean).join('\n\n');

  try {
    const response = await axios.post(
      GROQ_API_URL,
      {
        model:           process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: `TARGET POSITION: ${positionName}\n\nCANDIDATE DATA:\n${profile}` }
        ],
        temperature:     0,
        max_tokens:      1000,
        response_format: { type: 'json_object' }
      },
      {
        headers: { 'Authorization': `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json' },
        timeout: 25000
      }
    );

    const raw  = response.data.choices[0]?.message?.content || '{}';
    const result = JSON.parse(raw);
    if (!result || !result.scores) return null;

    // Compute weighted total
    let total = 0;
    enabledParams.forEach(k => {
      const s = result.scores[k];
      if (s) {
        const normalized = Math.min(5, Math.max(1, parseInt(s.score) || 1));
        total += (normalized / 5) * config[k]; // weight% contribution
        s.score = normalized;
      }
    });

    return {
      scores:  result.scores,
      summary: result.summary || '',
      total:   Math.round(total),  // 0-100
      config,
    };
  } catch (err) {
    console.error('SmartFit error:', err.response?.data?.error?.message || err.message);
    return null;
  }
}

module.exports = { analyseSmartFit, PARAM_META };
