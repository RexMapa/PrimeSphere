const { Resend } = require('resend');

// Same reasoning as db.js: the Resend SDK throws synchronously if its API
// key is missing, and that used to happen at module-load time — crashing
// the whole process before server.js ever reached app.listen(). Guarding it
// here means a missing RESEND_API_KEY only disables email sending, not the
// entire site.
let resend = null;
if (process.env.RESEND_API_KEY) {
  try {
    resend = new Resend(process.env.RESEND_API_KEY);
  } catch (err) {
    console.error('⚠️  Failed to create the Resend client:', err.message);
    resend = null;
  }
} else {
  console.warn('⚠️  RESEND_API_KEY is not set — verification emails are disabled (the rest of the site will still work).');
}

async function sendVerificationEmail(to, code) {
  if (!resend) {
    throw new Error('Email sending is not configured (missing RESEND_API_KEY).');
  }

  const from = process.env.EMAIL_FROM || 'Ledger <onboarding@resend.dev>';

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject: `Your Ledger verification code is ${code}`,
    text: `Your Ledger verification code is ${code}. It expires in ${process.env.CODE_TTL_MINUTES || 10} minutes. If you didn't request this, you can ignore this email.`,
    html: `
      <div style="font-family:sans-serif; max-width:420px; margin:0 auto;">
        <h2 style="margin-bottom:4px;">Verify your email</h2>
        <p style="color:#555;">Enter this code to finish creating your Ledger account:</p>
        <div style="font-size:32px; letter-spacing:6px; font-weight:600; background:#f3f3f3; padding:16px 20px; border-radius:10px; text-align:center; margin:20px 0;">
          ${code}
        </div>
        <p style="color:#888; font-size:13px;">This code expires in ${process.env.CODE_TTL_MINUTES || 10} minutes. If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });

  if (error) {
    // Surface a clear error to the caller instead of failing silently —
    // signup should not proceed if we can't actually deliver the code.
    throw new Error('Email send failed: ' + (error.message || JSON.stringify(error)));
  }

  return data;
}

/*
 * --- Alternative: SendGrid ---
 * If you'd rather use SendGrid instead of Resend:
 *
 *   npm install @sendgrid/mail
 *
 *   const sgMail = require('@sendgrid/mail');
 *   sgMail.setApiKey(process.env.SENDGRID_API_KEY);
 *
 *   async function sendVerificationEmail(to, code) {
 *     await sgMail.send({
 *       to,
 *       from: process.env.EMAIL_FROM,
 *       subject: `Your Ledger verification code is ${code}`,
 *       text: `Your verification code is ${code}`,
 *       html: `<p>Your verification code is <strong>${code}</strong></p>`,
 *     });
 *   }
 */

module.exports = { sendVerificationEmail };
