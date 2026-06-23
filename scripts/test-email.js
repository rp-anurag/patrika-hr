require('dotenv').config();
const nodemailer = require('nodemailer');

const TO   = process.argv[2] || process.env.EMAIL_USER;
const HOST = process.env.EMAIL_HOST;
const PORT = parseInt(process.env.EMAIL_PORT) || 587;
const USER = process.env.EMAIL_USER;
const PASS = process.env.EMAIL_PASS;

async function tryTransport(label, config) {
  console.log(`\n  Testing: ${label}`);
  const t = nodemailer.createTransport(config);
  try {
    await t.verify();
    console.log(`  [OK] Connected — sending test mail to ${TO}...`);
    const r = await t.sendMail({
      from:    `"Patrika HR Test" <${USER}>`,
      to:      TO,
      subject: 'Patrika HR SMTP Test',
      text:    `SMTP working via: ${label}`
    });
    console.log(`  [OK] Sent! MessageID: ${r.messageId}`);
    return true;
  } catch (err) {
    console.log(`  [FAIL] ${err.message}`);
    return false;
  }
}

async function run() {
  console.log(`\n  Host: ${HOST}   User: ${USER}\n`);

  // Option 1 — Port 587, STARTTLS, with auth
  if (await tryTransport('587 STARTTLS + auth', {
    host: HOST, port: 587, secure: false,
    auth: { user: USER, pass: PASS },
    tls: { rejectUnauthorized: false }
  })) return;

  // Option 2 — Port 587, STARTTLS, NO auth (relay from trusted IP)
  if (await tryTransport('587 STARTTLS, no auth (relay)', {
    host: HOST, port: 587, secure: false,
    tls: { rejectUnauthorized: false }
  })) return;

  // Option 3 — Port 25, plain, NO auth (internal relay)
  if (await tryTransport('Port 25, no auth (relay)', {
    host: HOST, port: 25, secure: false,
    tls: { rejectUnauthorized: false }
  })) return;

  // Option 4 — Port 587, LOGIN auth method explicitly
  if (await tryTransport('587 STARTTLS, LOGIN method', {
    host: HOST, port: 587, secure: false,
    authMethod: 'LOGIN',
    auth: { user: USER, pass: PASS },
    tls: { rejectUnauthorized: false }
  })) return;

  // Option 5 — Port 587, PLAIN auth method explicitly
  if (await tryTransport('587 STARTTLS, PLAIN method', {
    host: HOST, port: 587, secure: false,
    authMethod: 'PLAIN',
    auth: { user: USER, pass: PASS },
    tls: { rejectUnauthorized: false }
  })) return;

  console.log('\n  All options failed. Please verify credentials or contact your mail server admin.\n');
}

run();
