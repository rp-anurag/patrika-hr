const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

// ─── TEXT EXTRACTORS ──────────────────────────────────────────────────────────
async function extractPDF(input) {
  const buf = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  const data = await pdfParse(buf);
  let text = data.text || '';

  // Scanned/image PDF fallback: no usable text layer → OCR via Groq vision
  if (text.replace(/\s/g, '').length < 100) {
    try {
      const ocrText = await ocrPdfWithVision(buf);
      if (ocrText && ocrText.replace(/\s/g, '').length > text.replace(/\s/g, '').length) {
        console.log('[resumeParser] Scanned PDF detected — used OCR fallback (' + ocrText.length + ' chars)');
        text = ocrText;
      }
    } catch (e) {
      console.warn('[resumeParser] OCR fallback failed:', e.message);
    }
  }
  return text;
}

// Render PDF pages to PNG and transcribe them with Groq's vision model
async function ocrPdfWithVision(pdfBuffer) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return '';
  const axios = require('axios');
  const { pdfToPng } = require('pdf-to-png-converter');

  const pages = await pdfToPng(pdfBuffer, {
    viewportScale: 2.0,
    pagesToProcess: [1, 2, 3]   // first 3 pages are enough for a resume
  });

  let fullText = '';
  for (const page of pages) {
    const b64 = page.content.toString('base64');
    const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Transcribe ALL text from this resume page exactly as written. Preserve section headings, dates, company names, and bullet points. Output plain text only, no commentary.' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } }
        ]
      }],
      temperature: 0,
      max_tokens: 4000
    }, {
      headers: { 'Authorization': `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json' },
      timeout: 60000
    });
    fullText += (response.data.choices[0]?.message?.content || '') + '\n\n';
  }
  return fullText.trim();
}

async function extractDOCX(input) {
  const opts = Buffer.isBuffer(input) ? { buffer: input } : { path: input };
  const result = await mammoth.extractRawText(opts);
  return result.value || '';
}

// ─── BASIC FIELD PARSERS ──────────────────────────────────────────────────────
const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /(?:\+91[\s\-]?)?(?:\(0\d{2,4}\)[\s\-]?)?[6-9]\d{9}|(?:\+91[\s\-]?)?\d{10}|(?:0\d{2,4}[\s\-]?\d{6,8})/g;

const LOCATION_KEYWORDS = [
  'Jaipur', 'Delhi', 'Mumbai', 'Bangalore', 'Bengaluru', 'Hyderabad', 'Chennai',
  'Kolkata', 'Pune', 'Ahmedabad', 'Surat', 'Bhopal', 'Indore', 'Nagpur',
  'Lucknow', 'Kanpur', 'Agra', 'Varanasi', 'Patna', 'Guwahati', 'Chandigarh',
  'Jodhpur', 'Udaipur', 'Kota', 'Ajmer', 'Bikaner', 'Rajasthan', 'Gujarat',
  'Maharashtra', 'Karnataka', 'Madhya Pradesh', 'Uttar Pradesh', 'Noida',
  'Gurugram', 'Gurgaon', 'Faridabad', 'Ghaziabad', 'Dehradun', 'Raipur'
];

function parseEmail(text) {
  const matches = text.match(EMAIL_REGEX);
  if (!matches) return null;
  return matches.find(e => !e.includes('noreply') && !e.includes('example')) || matches[0];
}

function parsePhone(text) {
  const matches = text.match(PHONE_REGEX);
  if (!matches) return null;
  for (const match of matches) {
    const digits = match.replace(/\D/g, '');
    if (digits.length >= 10) {
      const last10 = digits.slice(-10);
      if (/^[6-9]\d{9}$/.test(last10)) return last10;
    }
  }
  return matches[0].trim();
}

function parseName(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 8)) {
    if (line.length < 3 || line.length > 60) continue;
    if (/@|www\.|http|linkedin|github/i.test(line)) continue;
    if (/^\d/.test(line)) continue;
    if (/resume|curriculum|cv|profile/i.test(line)) continue;
    if (/^[A-Za-z][A-Za-z\s.\-']{2,59}$/.test(line)) return line;
  }
  return null;
}

function parseLocation(text) {
  for (const city of LOCATION_KEYWORDS) {
    if (new RegExp(`\\b${city}\\b`, 'i').test(text)) return city;
  }
  return null;
}

function parseLinkedIn(text) {
  const match = text.match(/(?:linkedin\.com\/in\/|linkedin:\s*)([A-Za-z0-9\-_%]+)/i);
  return match ? `https://linkedin.com/in/${match[1]}` : null;
}

// ─── SKILLS ───────────────────────────────────────────────────────────────────
function parseSkills(text) {
  const sectionMatch = text.match(
    /(?:skills?|technical skills?|key skills?|core competencies?|expertise)[:\s]*\n([\s\S]{0,1000}?)(?:\n\n|\n[A-Z]|experience|education|work|project)/i
  );
  const source = sectionMatch ? sectionMatch[1] : text.slice(0, 2000);
  return source
    .split(/[,\n•\|·\t;\/]+/)
    .map(s => s.trim())
    .filter(s => s.length > 1 && s.length < 50 && !/^\d+$/.test(s))
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 30);
}

// ─── EXPERIENCE ───────────────────────────────────────────────────────────────
function parseTotalExperience(text) {
  // Matches: "8 years", "8+ years", "8.5 years of experience", "over 10 years"
  const patterns = [
    /(\d+(?:\.\d+)?)\s*\+?\s*years?\s+(?:of\s+)?(?:total\s+)?(?:work\s+)?experience/i,
    /(?:experience\s+of\s+|over\s+)(\d+(?:\.\d+)?)\s*\+?\s*years?/i,
    /total\s+(?:work\s+)?experience[:\s]+(\d+(?:\.\d+)?)\s*\+?\s*years?/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return `${m[1]}+ years`;
  }
  return null;
}

function parseExperienceEntries(text) {
  // Find experience section
  const sectionMatch = text.match(
    /(?:work\s+experience|professional\s+experience|employment\s+history|experience)[:\s]*\n([\s\S]{0,3000}?)(?:\n(?:education|qualification|skills?|projects?|certif|awards?|references?)\b)/i
  );
  const section = sectionMatch ? sectionMatch[1] : '';
  if (!section) return [];

  const entries = [];
  const lines = section.split('\n').map(l => l.trim()).filter(Boolean);

  // Date range pattern: Jan 2020 – Present, 2018-2021, Mar'19 – Jun'22, etc.
  const dateRangeRe = /(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z']*[\s,]*\d{2,4}|(?:19|20)\d{2})\s*(?:–|-|to)\s*(?:present|current|(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z']*[\s,]*\d{2,4})|(?:19|20)\d{2})/i;

  let current = null;
  for (const line of lines) {
    if (dateRangeRe.test(line)) {
      if (current) entries.push(current);
      current = { role: '', company: '', period: line.match(dateRangeRe)[0], description: [] };
    } else if (current) {
      if (!current.role && line.length < 80) current.role = line;
      else if (!current.company && line.length < 80) current.company = line;
      else if (line.length > 10) current.description.push(line);
    } else {
      // Try to pick up company + role lines before a date range
      if (line.length < 80 && !entries.length) {
        if (!current) current = { role: '', company: '', period: '', description: [] };
        if (!current.role) current.role = line;
        else if (!current.company) current.company = line;
      }
    }
  }
  if (current && (current.role || current.company)) entries.push(current);

  return entries.slice(0, 8);
}

// ─── EDUCATION ────────────────────────────────────────────────────────────────
const DEGREE_KEYWORDS = [
  'b\\.tech', 'b\\.e\\.?', 'm\\.tech', 'm\\.e\\.?', 'mba', 'bba', 'bca', 'mca',
  'b\\.sc', 'm\\.sc', 'b\\.com', 'm\\.com', 'b\\.a\\.?', 'm\\.a\\.?',
  'bachelor', 'master', 'phd', 'ph\\.d', 'diploma', 'b\\.arch', 'llb', 'mbbs',
  'intermediate', '12th', '10th', 'ssc', 'hsc', 'pgdm', 'post.?graduate'
];
const DEGREE_RE = new RegExp(`(${DEGREE_KEYWORDS.join('|')})`, 'i');

function parseEducation(text) {
  const sectionMatch = text.match(
    /(?:education|qualification|academic|educational\s+background)[:\s]*\n([\s\S]{0,2000}?)(?:\n(?:experience|skills?|projects?|certif|awards?|references?|work\s+history)\b)/i
  );
  const section = sectionMatch ? sectionMatch[1] : '';
  const source = section || text;

  const entries = [];
  const lines = source.split('\n').map(l => l.trim()).filter(Boolean);

  let current = null;
  for (const line of lines) {
    if (DEGREE_RE.test(line)) {
      if (current) entries.push(current);
      current = { degree: line, institution: '', year: '' };
    } else if (current) {
      const yearMatch = line.match(/\b(19|20)\d{2}\b/);
      if (yearMatch && !current.year) current.year = yearMatch[0];
      if (!current.institution && line.length > 3 && line.length < 120) current.institution = line;
    }
  }
  if (current) entries.push(current);

  // Fallback: scan full text for degree mentions if section not found
  if (!entries.length) {
    const fallbackMatches = source.match(new RegExp(
      `(${DEGREE_KEYWORDS.join('|')})[^\\n]{0,100}`,
      'gi'
    )) || [];
    fallbackMatches.slice(0, 4).forEach(m => entries.push({ degree: m.trim(), institution: '', year: '' }));
  }

  return entries.slice(0, 6);
}

// ─── SUMMARY / OBJECTIVE ──────────────────────────────────────────────────────
function parseSummary(text) {
  const sectionMatch = text.match(
    /(?:summary|objective|profile|about\s+me|career\s+objective|professional\s+summary)[:\s]*\n([\s\S]{0,600}?)(?:\n\n|\n[A-Z][A-Z\s]{3,}\n)/i
  );
  if (sectionMatch) return sectionMatch[1].replace(/\n/g, ' ').trim().slice(0, 500);

  // Fallback: first long paragraph-like line
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 20)) {
    if (line.length > 80) return line.slice(0, 500);
  }
  return null;
}

// ─── CURRENT COMPANY / DESIGNATION ───────────────────────────────────────────
function parseCurrentRole(text) {
  const m = text.match(/(?:currently\s+working\s+(?:at|with|as)|present\s+employer|current\s+(?:company|employer|organization))[:\s]+([^\n]{3,80})/i);
  return m ? m[1].trim() : null;
}

// ─── MAIN PARSE FUNCTION ──────────────────────────────────────────────────────
async function parseResume(input, mimetype) {
  let rawText = '';
  try {
    const ext = typeof input === 'string' ? path.extname(input).toLowerCase() : '';

    if (mimetype === 'application/pdf' || ext === '.pdf') {
      rawText = await extractPDF(input);
    } else if (
      mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      ext === '.docx'
    ) {
      rawText = await extractDOCX(input);
    } else if (mimetype === 'application/msword' || ext === '.doc') {
      try { rawText = await extractDOCX(input); } catch { rawText = ''; }
    }
  } catch (err) {
    console.error('Resume extraction error:', err.message);
    return { name: null, email: null, phone: null, location: null, skills: [], rawText: '' };
  }

  return {
    name:               parseName(rawText),
    email:              parseEmail(rawText),
    phone:              parsePhone(rawText),
    location:           parseLocation(rawText),
    linkedin:           parseLinkedIn(rawText),
    summary:            parseSummary(rawText),
    totalExperience:    parseTotalExperience(rawText),
    currentRole:        parseCurrentRole(rawText),
    experienceEntries:  parseExperienceEntries(rawText),
    education:          parseEducation(rawText),
    skills:             parseSkills(rawText),
    rawText:            rawText.slice(0, 10000)
  };
}

module.exports = { parseResume };
