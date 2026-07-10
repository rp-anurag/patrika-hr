'use strict';
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

const POLL_INTERVAL_MS = 60 * 1000; // check inbox every 60 seconds
let polling = false;

// Strip quoted reply history ("On ... wrote:", "> quoted") so only the fresh reply is stored
function extractReplyText(text) {
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  const kept = [];
  for (const line of lines) {
    if (/^On .{5,80}wrote:\s*$/.test(line.trim())) break;   // Gmail/Outlook reply header
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line.trim())) break;
    if (/^From:\s.+@/i.test(line.trim()) && kept.length > 0) break;
    if (line.trim().startsWith('>')) continue;               // quoted lines
    kept.push(line);
  }
  return kept.join('\n').trim().substring(0, 5000);
}

async function checkInbox() {
  if (polling) return; // don't overlap runs
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;
  polling = true;

  const imapPort = parseInt(process.env.EMAIL_IMAP_PORT) || 993;
  const client = new ImapFlow({
    host:   process.env.EMAIL_HOST,
    port:   imapPort,
    secure: imapPort === 993,
    auth:   { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    tls:    { rejectUnauthorized: false },
    logger: false
  });

  try {
    const { Candidate, Communication, ActivityLog } = require('../models');
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const unseen = await client.search({ seen: false });
      if (unseen && unseen.length) {
        for (const uid of unseen) {
          try {
            const msg = await client.fetchOne(uid, { source: true });
            if (!msg || !msg.source) continue;
            const parsed = await simpleParser(msg.source);

            const fromAddr = (parsed.from?.value?.[0]?.address || '').toLowerCase().trim();
            if (!fromAddr) { await client.messageFlagsAdd(uid, ['\\Seen']); continue; }

            // Skip mail we sent ourselves (Sent-append echoes, bounces from our own address)
            if (fromAddr === (process.env.EMAIL_USER || '').toLowerCase()) {
              await client.messageFlagsAdd(uid, ['\\Seen']);
              continue;
            }

            // Match sender to a candidate (most recent application first)
            const candidate = await Candidate.findOne({
              where: { email: fromAddr },
              order: [['submittedAt', 'DESC']]
            });
            if (!candidate) { await client.messageFlagsAdd(uid, ['\\Seen']); continue; }

            const bodyText = extractReplyText(parsed.text || '') ||
                             (parsed.html ? parsed.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 5000) : '');
            const subject  = (parsed.subject || '(no subject)').substring(0, 500);

            await Communication.create({
              candidateId: candidate.id,
              channel:     'Email',
              direction:   'inbound',
              subject,
              message:     bodyText || '(empty message)',
              sentAt:      parsed.date || new Date(),
              sentBy:      candidate.fullName,
              status:      'Sent'
            });

            await ActivityLog.create({
              candidateId:  candidate.id,
              activityType: 'email_received',
              title:        'Reply received from candidate',
              details:      `${subject} — ${bodyText.substring(0, 300)}`,
              performedBy:  candidate.fullName,
              createdAt:    parsed.date || new Date()
            }).catch(() => {});

            await client.messageFlagsAdd(uid, ['\\Seen']);
            console.log(`[inboundMail] Reply from ${fromAddr} linked to candidate #${candidate.id} (${candidate.fullName})`);
          } catch (msgErr) {
            console.warn('[inboundMail] Message processing error:', msgErr.message);
          }
        }
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (err) {
    console.warn('[inboundMail] Inbox check failed:', err.message);
    try { await client.logout(); } catch (_) {}
  } finally {
    polling = false;
  }
}

function startInboundMailPolling() {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('[inboundMail] Email credentials not configured — inbound polling disabled');
    return;
  }
  checkInbox().catch(() => {});
  setInterval(() => checkInbox().catch(() => {}), POLL_INTERVAL_MS);
  console.log(`[inboundMail] Polling INBOX every ${POLL_INTERVAL_MS / 1000}s for candidate replies`);
}

module.exports = { startInboundMailPolling, checkInbox };
