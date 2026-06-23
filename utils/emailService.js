const nodemailer = require('nodemailer');

let transporter = null;
let lastConfig   = '';

function getTransporter() {
  const port      = parseInt(process.env.EMAIL_PORT) || 587;
  const noAuth    = process.env.EMAIL_NO_AUTH === 'true';
  const configKey = `${process.env.EMAIL_HOST}|${port}|${process.env.EMAIL_USER}|${noAuth}`;

  if (!transporter || configKey !== lastConfig) {
    const config = {
      host:              process.env.EMAIL_HOST,
      port,
      secure:            port === 465,        // 465 = SSL, 587 = STARTTLS
      tls:               { rejectUnauthorized: false },
      connectionTimeout: 10000,
      greetingTimeout:   10000,
      socketTimeout:     15000
    };

    // Add auth only if credentials are present and EMAIL_NO_AUTH is not set
    if (!noAuth && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      config.auth = { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS };
      if (process.env.EMAIL_AUTH_METHOD) {
        config.authMethod = process.env.EMAIL_AUTH_METHOD; // PLAIN, LOGIN, CRAM-MD5
      }
    }

    transporter = nodemailer.createTransport(config);
    lastConfig   = configKey;
  }
  return transporter;
}

async function sendEmail({ to, subject, html, text }) {
  if (!process.env.EMAIL_HOST) {
    throw new Error('EMAIL_HOST not configured in .env');
  }
  const transport = getTransporter();
  const info = await transport.sendMail({
    from:    `"${process.env.EMAIL_FROM_NAME || 'Patrika HR'}" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html:    html || `<p>${text}</p>`,
    text:    text || ''
  });
  return info;
}

async function verifyConnection() {
  const transport = getTransporter();
  await transport.verify();
  return {
    host:   process.env.EMAIL_HOST,
    port:   process.env.EMAIL_PORT,
    user:   process.env.EMAIL_USER
  };
}

function applicationReceivedTemplate(candidateName, position) {
  return {
    subject: `Application Received – ${position} | Patrika HR`,
    html: `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e0c97a;border-radius:8px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#1a1a2e,#8b6914);padding:24px;text-align:center;">
        <h2 style="color:#f0c030;margin:0;font-size:22px;">Rajasthan Patrika | Patrika</h2>
        <p style="color:#fff;margin:4px 0 0;font-size:13px;">HR Intelligence System</p>
      </div>
      <div style="padding:32px;background:#fff;">
        <p style="font-size:16px;color:#333;">Dear <strong>${candidateName}</strong>,</p>
        <p style="color:#555;line-height:1.6;">Thank you for applying for the position of <strong>${position}</strong> at Patrika. We have successfully received your application and resume.</p>
        <p style="color:#555;line-height:1.6;">Our HR team will review your profile and reach out to you shortly if your qualifications match our requirements.</p>
        <div style="background:#f9f6ec;border-left:4px solid #d4a017;padding:16px;margin:24px 0;border-radius:4px;">
          <p style="margin:0;color:#7a5c00;font-size:14px;"><strong>Position Applied:</strong> ${position}</p>
        </div>
        <p style="color:#555;">Warm regards,<br><strong>HR Team</strong><br>Patrika Group</p>
      </div>
      <div style="background:#f5f5f5;padding:12px;text-align:center;">
        <p style="font-size:11px;color:#999;margin:0;">This is an automated message. Please do not reply to this email.</p>
      </div>
    </div>`
  };
}

module.exports = { sendEmail, verifyConnection, applicationReceivedTemplate };
