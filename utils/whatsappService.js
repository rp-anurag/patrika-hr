const twilio = require('twilio');

/**
 * WhatsApp via Twilio Sandbox / Business API
 *
 * Sandbox setup:
 *   1. Go to https://console.twilio.com > Messaging > Try it out > Send a WhatsApp message
 *   2. Follow sandbox join instructions (candidate sends "join <word>" to the Twilio number)
 *   3. Fill TWILIO_* env vars
 *
 * Production: replace TWILIO_WHATSAPP_NUMBER with your approved WhatsApp sender.
 */

function getTwilioClient() {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN ||
      process.env.TWILIO_ACCOUNT_SID.startsWith('ACxxxxxxx')) {
    throw new Error('Twilio credentials not configured. Update TWILIO_* vars in .env');
  }
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

/**
 * Send WhatsApp message to a candidate
 * @param {string} toNumber - 10-digit Indian mobile number (e.g. 9876543210)
 * @param {string} message  - Message body text
 */
async function sendWhatsApp(toNumber, message) {
  const client = getTwilioClient();

  // Normalize to E.164 with whatsapp: prefix
  const digits = toNumber.replace(/\D/g, '');
  const normalized = digits.startsWith('91') ? `+${digits}` : `+91${digits}`;
  const to = `whatsapp:${normalized}`;
  const from = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';

  const msg = await client.messages.create({ from, to, body: message });
  return msg;
}

// Pre-built WhatsApp message templates
function applicationConfirmationMsg(candidateName, position) {
  return `Hello ${candidateName}! 👋\n\nThank you for applying for *${position}* at *Patrika Group*.\n\nYour application has been received. Our HR team will review your profile and get back to you soon.\n\nWarm regards,\n_Patrika HR Team_`;
}

function interviewInviteMsg(candidateName, position, dateTime, venue) {
  return `Dear ${candidateName},\n\nWe are pleased to invite you for an interview for the position of *${position}* at *Patrika Group*.\n\n📅 *Date & Time:* ${dateTime}\n📍 *Venue:* ${venue}\n\nPlease confirm your availability by replying to this message.\n\nBest regards,\n_Patrika HR Team_`;
}

module.exports = { sendWhatsApp, applicationConfirmationMsg, interviewInviteMsg };
