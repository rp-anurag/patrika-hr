const axios   = require('axios');
const { Candidate, Position } = require('../models');

const GROQ_API_URL = 'https://api.groqcloud.com/openai/v1/chat/completions'.replace('groqcloud','groq');

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

DIMENSIONS & WEIGHTS (default):
  D1. Relevant Experience       (30%) — depth, recency, role-specific experience
  D2. Skills & Competency Match (25%) — technical/functional skills vs JD
  D3. Leadership & Scope        (20%) — scale of responsibility, measurable outcomes
  D4. Motivation & Culture Fit  (15%) — whyJoinUs answer quality, 90-day plan
  D5. Compensation Alignment    (10%) — current package vs role budget fit

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
    c.parsedTotalExperience  ? `TOTAL EXPERIENCE: ${c.parsedTotalExperience}` : '',
    c.parsedSummary          ? `PROFESSIONAL SUMMARY:\n${c.parsedSummary}` : '',
    skills                   ? `SKILLS: ${skills}` : '',
    experience               ? `EXPERIENCE ENTRIES:\n${experience}` : '',
    education                ? `EDUCATION:\n${education}` : '',
    c.parsedRawText          ? `RESUME EXTRACT (first 2500 chars):\n${c.parsedRawText.substring(0, 2500)}` : '',
    c.whyJoinUs              ? `WHY JOIN US (candidate answer):\n${c.whyJoinUs}` : 'WHY JOIN US: not provided',
    c.first90DaysPlan        ? `FIRST 90-DAY PLAN (candidate answer):\n${c.first90DaysPlan}` : 'FIRST 90-DAY PLAN: not provided'
  ].filter(Boolean).join('\n\n');
}

exports.showPage = async (req, res) => {
  try {
    const [candidates, positions] = await Promise.all([
      Candidate.findAll({ attributes: ['id','fullName','positionApplying','status','grade'], order: [['submittedAt','DESC']] }),
      Position.findAll({ where: { isActive: true }, attributes: ['id','name','department','jdHtml'], order: [['sortOrder','ASC'],['name','ASC']] })
    ]);
    res.render('admin/talent-analyst', {
      title: 'AI Talent Analyst',
      adminName: req.session.adminName || 'Admin',
      candidates,
      positions,
      v: res.locals.v
    });
  } catch (err) {
    console.error('talent-analyst showPage error:', err);
    res.status(500).send('<h2>Error</h2><pre>' + err.message + '</pre>');
  }
};

exports.analyse = async (req, res) => {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return res.status(400).json({ success: false, error: 'GROQ_API_KEY not configured' });

    const { candidateIds, jd, roleName, customRubric } = req.body;

    if (!candidateIds || !candidateIds.length) {
      return res.status(400).json({ success: false, error: 'No candidates selected' });
    }

    const ids = Array.isArray(candidateIds) ? candidateIds : [candidateIds];
    const candidates = await Candidate.findAll({ where: { id: ids } });
    if (!candidates.length) return res.status(404).json({ success: false, error: 'Candidates not found' });

    const results = [];

    for (const c of candidates) {
      const profile = buildCandidateProfile(c);
      const userMsg = [
        roleName ? `TARGET ROLE: ${roleName}` : `TARGET ROLE: ${c.positionApplying}`,
        jd       ? `JOB DESCRIPTION:\n${jd.substring(0, 3000)}` : 'JOB DESCRIPTION: (not provided — assess against role title only)',
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

        const raw    = response.data.choices[0]?.message?.content || '{}';
        const report = JSON.parse(raw);

        results.push({
          candidateId:   c.id,
          candidateName: c.fullName,
          position:      c.positionApplying,
          currentGrade:  c.grade,
          report
        });
      } catch (groqErr) {
        const msg = groqErr.response?.data?.error?.message || groqErr.message;
        results.push({
          candidateId:   c.id,
          candidateName: c.fullName,
          position:      c.positionApplying,
          error:         msg
        });
      }
    }

    res.json({ success: true, results, roleName: roleName || '' });
  } catch (err) {
    console.error('talent-analyst analyse error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
