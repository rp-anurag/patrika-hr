const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const QR_OUTPUT_PATH = path.join(__dirname, '../public/images/form-qr.png');

/**
 * Generates a QR code image pointing to the candidate application form URL.
 * Saved to public/images/form-qr.png — accessible at /images/form-qr.png
 */
async function generateQR(url) {
  await QRCode.toFile(QR_OUTPUT_PATH, url, {
    errorCorrectionLevel: 'H',
    type: 'png',
    width: 300,
    margin: 2,
    color: {
      dark: '#1a1a2e',   // dark navy squares
      light: '#FFFFFF'
    }
  });
  console.log(`QR Code generated → ${url}`);
  return QR_OUTPUT_PATH;
}

function qrExists() {
  return fs.existsSync(QR_OUTPUT_PATH);
}

module.exports = { generateQR, qrExists };
