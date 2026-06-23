const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

/**
 * RESUME PARSER — How it works:
 *
 * Accepts either a file path (string) OR a Buffer (from memory upload).
 * 1. Extracts raw text:  PDF → pdf-parse,  DOCX/DOC → mammoth
 * 2. Runs regex patterns to identify: email, phone, name, location, skills
 * 3. Returns { name, email, phone, location, skills, rawText }
 *    Fields that fail to parse are returned as null — form stays blank for manual fill.
 *
 * To customize patterns, edit the REGEX PATTERNS section below.
 */

// ─── REGEX PATTERNS ────────────────────────────────────────────────────────────
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

const SKILLS_SECTION_REGEX = /(?:skills?|technical skills?|key skills?|core competencies?|expertise)[:\s]*\n([\s\S]{0,800}?)(?:\n\n|\n[A-Z]|experience|education|work|project)/i;

// ─── TEXT EXTRACTORS (accept path OR Buffer) ────────────────────────────────────
async function extractPDF(input) {
  const buf = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  const data = await pdfParse(buf);
  return data.text || '';
}

async function extractDOCX(input) {
  const opts = Buffer.isBuffer(input) ? { buffer: input } : { path: input };
  const result = await mammoth.extractRawText(opts);
  return result.value || '';
}

// ─── FIELD PARSERS ─────────────────────────────────────────────────────────────
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

function parseSkills(text) {
  const match = text.match(SKILLS_SECTION_REGEX);
  if (!match) return [];
  return match[1]
    .split(/[,\n•\|·\t]+/)
    .map(s => s.trim())
    .filter(s => s.length > 1 && s.length < 50 && !/^\d+$/.test(s))
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 25);
}

// ─── MAIN PARSE FUNCTION ───────────────────────────────────────────────────────
// input: file path (string) — for saved uploads
//        Buffer             — for in-memory AJAX parse (no disk write)
// mimetype: MIME type string
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
    name:     parseName(rawText),
    email:    parseEmail(rawText),
    phone:    parsePhone(rawText),
    location: parseLocation(rawText),
    skills:   parseSkills(rawText),
    rawText:  rawText.slice(0, 10000)
  };
}

module.exports = { parseResume };
