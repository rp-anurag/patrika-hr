'use strict';

const axios = require('axios');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

const SYSTEM_PROMPT = `You are a senior talent-assessment analyst supporting a hiring team. Your job is to
analyse candidate data (CV, application-question answers, LinkedIn profile) for a
specific role and produce clear, comparable, evidence-based decision-support reports.

OPERATING PRINCIPLES
1. Evidence-based: Every rating, strength, concern, or inference must reference its
   source — quote or point to the specific CV line, answer, or LinkedIn item. If
   something is not supported by the data, say "not evidenced" rather than guessing.
2. Confidence-tagged: Tag each material claim High / Medium / Low confidence based on
   how directly the data supports it and how complete the data is.
3. Fairness: Never infer or use age, gender, race, ethnicity, religion, nationality,
   disability, health, marital or family status, or proxies for these (e.g. graduation
   year, name origin, photos). If the data contains these, ignore them.
4. Context, not penalty: Treat career gaps, short tenures, and non-linear paths as
   items to verify in interview, not automatic deductions.
5. Job-relevance only: Score against the role requirements and stated competencies,
   not generic prestige (school/employer brand is weak evidence — weight actual
   demonstrated skill higher).
6. Calibrated language: Be direct. Avoid flattery and hedging. Distinguish
   demonstrated facts from interpretation.
7. Human-in-the-loop: You recommend; you never make the final decision. End with
   "verify in interview" items.

SCORING RUBRIC (default — override if user provides custom rubric)
Score each dimension 1–5:
  5 = Exceeds requirement with direct evidence
  4 = Meets requirement with direct evidence
  3 = Partially meets — some evidence but gaps exist
  2 = Weak — limited or indirect evidence
  1 = Not evidenced / clear gap

DIMENSIONS & WEIGHTS — EXPERIENCED CANDIDATES (default):
  D1. Relevant Experience       (30%) — depth, recency, role-specific experience
  D2. Skills & Competency Match (25%) — technical/functional skills vs JD
  D3. Leadership & Scope        (20%) — scale of responsibility, measurable outcomes
  D4. Motivation & Culture Fit  (15%) — whyJoinUs answer quality, 90-day plan
  D5. Compensation Alignment    (10%) — current package vs role budget fit

DIMENSIONS & WEIGHTS — FRESHERS (MANDATORY when candidate has less than 1 year of
professional experience, OR the role is entry-level/trainee/intern):
  D1. Education & Academic Fit     (25%) — degree relevance, academic performance, certifications
  D2. Skills & Competency Match    (30%) — technical/functional skills vs JD; internships,
                                            academic projects, training, and freelance work
                                            COUNT AS VALID EVIDENCE of skill
  D3. Learning Agility & Potential (15%) — self-learning, projects, extracurricular initiative,
                                            competitions, portfolio work
  D4. Motivation & Culture Fit     (20%) — whyJoinUs answer quality, career clarity, enthusiasm
  D5. Compensation Alignment       (10%) — expected package vs role budget fit

FRESHER RULES (apply whenever the fresher rubric is used):
- NEVER score a fresher 1 on any dimension merely for lacking professional work experience.
- Do NOT include "lack of work experience" as a concern for a fresher — it is expected.
- Use the fresher dimension names above in the output (e.g. "Education & Academic Fit"
  instead of "Relevant Experience").
- State in the summary that the candidate was assessed as a fresher.

TIER:
  A = 75–100  (strong fit — recommend for interview)
  B = 50–74   (possible fit — interview with specific probes)
  C = 0–49    (not a fit for this role)

CRITICAL OUTPUT FORMAT — respond ONLY with valid JSON matching this exact schema:
{
  "summary": "2-3 sentence executive overview — direct, no filler",
  "tier": "A",
  "weightedTotal": 82,
  "dimensions": [
    {
      "name": "Relevant Experience",
      "weight": 30,
      "score": 4,
      "weightedScore": 24,
      "evidence": "specific quote or reference from the data",
      "confidence": "High"
    }
  ],
  "strengths": [
    { "point": "concise strength", "evidence": "source reference", "confidence": "High" }
  ],
  "concerns": [
    { "point": "concise concern", "evidence": "source or 'not evidenced'", "confidence": "Medium" }
  ],
  "missingData": ["list items not provided — LinkedIn, specific dates, etc."],
  "interviewVerify": ["Verify: specific probe question or item to confirm in interview"]
}`;

function buildCandidateProfile(c) {
  let skills = '';
  try {
    const s = c.parsedSkills ? JSON.parse(c.parsedSkills) : [];
    skills = Array.isArray(s) ? s.join(', ') : String(s);
  } catch(e) { skills = c.parsedSkills || ''; }

  let experience = '';
  try {
    const exp = c.parsedExperienceEntries ? JSON.parse(c.parsedExperienceEntries) : [];
    experience = Array.isArray(exp)
      ? exp.map(e => `- ${e.title || ''} at ${e.company || ''} (${e.duration || ''}): ${e.description || ''}`).join('\n')
      : '';
  } catch(e) {}

  let education = '';
  try {
    const edu = c.parsedEducation ? JSON.parse(c.parsedEducation) : [];
    education = Array.isArray(edu)
      ? edu.map(e => `- ${e.degree || ''} ${e.field || ''} from ${e.institution || ''} (${e.year || ''})`).join('\n')
      : '';
  } catch(e) {}

  return [
    `NAME: ${c.fullName}`,
    `POSITION APPLIED: ${c.positionApplying}`,
    `CURRENT LOCATION: ${c.currentLocation}`,
    `CURRENT PACKAGE: ₹${((parseFloat(c.packageFixed)||0)+(parseFloat(c.packageVariables)||0)+(parseFloat(c.packageOthers)||0)).toFixed(1)}L p.a.`,
    `NOTICE PERIOD: ${c.noticePeriod}`,
    c.linkedInProfile ? `LINKEDIN: ${c.linkedInProfile}` : 'LINKEDIN: not provided',
    c.parsedCurrentRole      ? `CURRENT ROLE: ${c.parsedCurrentRole}` : '',
    (() => {
      const hasRawText = (c.parsedRawText || '').replace(/\s/g, '').length > 100;
      if (c.parsedTotalExperience) return `TOTAL EXPERIENCE: ${c.parsedTotalExperience}`;
      if (experience) return '';
      if (!hasRawText) return 'RESUME TEXT UNAVAILABLE: The resume could not be machine-read (likely a scanned/image PDF). Do NOT treat this candidate as a fresher and do NOT score dimensions as "not evidenced" due to missing resume text. Score conservatively at 3 with Low confidence, state clearly in the summary that the resume needs manual review, and add "Manually review the original resume file" to interviewVerify.';
      return 'TOTAL EXPERIENCE: None — this candidate is a FRESHER; use the FRESHER rubric';
    })(),
    c.parsedSummary          ? `PROFESSIONAL SUMMARY:\n${c.parsedSummary}` : '',
    skills                   ? `SKILLS: ${skills}` : '',
    experience               ? `EXPERIENCE ENTRIES:\n${experience}` : '',
    education                ? `EDUCATION:\n${education}` : '',
    c.parsedRawText          ? `RESUME EXTRACT (first 2500 chars):\n${c.parsedRawText.substring(0, 2500)}` : '',
    c.whyJoinUs              ? `WHY JOIN US (candidate answer):\n${c.whyJoinUs}` : 'WHY JOIN US: not provided',
    c.first90DaysPlan        ? `FIRST 90-DAY PLAN (candidate answer):\n${c.first90DaysPlan}` : 'FIRST 90-DAY PLAN: not provided'
  ].filter(Boolean).join('\n\n');
}

/**
 * Run the Talent Analyst evaluation for one candidate.
 * Returns the parsed report object, or null if GROQ is not configured / call failed.
 */
async function analyseCandidate(candidate, jdHtml, roleName, customRubric) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || !apiKey.trim()) return null;

  const jdText = (jdHtml || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const profile = buildCandidateProfile(candidate);
  const userMsg = [
    `TARGET ROLE: ${roleName || candidate.positionApplying}`,
    jdText ? `JOB DESCRIPTION:\n${jdText.substring(0, 3000)}` : 'JOB DESCRIPTION: (not provided — assess against role title only)',
    customRubric ? `CUSTOM RUBRIC / ADDITIONAL INSTRUCTIONS:\n${customRubric}` : '',
    `CANDIDATE DATA:\n${profile}`
  ].filter(Boolean).join('\n\n');

  try {
    const response = await axios.post(
      GROQ_API_URL,
      {
        model:    process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: userMsg }
        ],
        temperature:     0.2,
        max_tokens:      2000,
        response_format: { type: 'json_object' }
      },
      {
        headers: { 'Authorization': `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json' },
        timeout: 30000
      }
    );
    const raw = response.data.choices[0]?.message?.content || '{}';
    const report = JSON.parse(raw);
    if (!report || typeof report !== 'object') return null;
    return report;
  } catch (err) {
    console.error('Talent Analyst error:', err.response?.data?.error?.message || err.message);
    return null;
  }
}

/** Map an analyst report to the candidate grade fields. Tier C splits into C/D by score. */
function reportToGrade(report) {
  const score = Math.min(100, Math.max(0, parseInt(report.weightedTotal) || 0));
  let grade = ['A','B','C'].includes(report.tier) ? report.tier : (score >= 75 ? 'A' : score >= 50 ? 'B' : 'C');
  if (grade === 'C' && score < 25) grade = 'D';
  return {
    grade,
    score,
    gradeReason: (report.summary || '').substring(0, 1000),
    gradeSource: 'ai-analyst'
  };
}

module.exports = { analyseCandidate, buildCandidateProfile, reportToGrade, SYSTEM_PROMPT };
