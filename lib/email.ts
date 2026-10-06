import "server-only";

/* Email via the Resend API. Without RESEND_API_KEY the message is logged to
 * the server console instead, so the flows still work in development. */

type RenderedEmail = { subject: string; html: string };

const ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "STAR SAAS <no-reply@star-saas.com>";

async function send(to: string, email: RenderedEmail, consoleFallback: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // The fallback text carries live reset links and login codes; never write it to production logs.
    if (process.env.NODE_ENV === "production") {
      console.error(`RESEND_API_KEY is not set; "${email.subject}" was not sent.`);
      return { sent: false, mocked: false };
    }
    console.log(`[email mock] ${consoleFallback}`);
    return { sent: true, mocked: true };
  }
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from: process.env.EMAIL_FROM || DEFAULT_FROM, to: [to], subject: email.subject, html: email.html }),
  });
  if (!res.ok) {
    console.error(`Resend send failed (${res.status}): ${await res.text().catch(() => "")}`);
    return { sent: false, mocked: false };
  }
  return { sent: true, mocked: false };
}

function esc(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Dark header, white card, grey footer; email-safe inline styles. */
function layout(body: string, footer: string) {
  return `<div style="margin:0;padding:0;background-color:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:32px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#0f172a,#1e293b);padding:28px 40px;">
              <span style="font-size:20px;font-weight:900;color:#94a3b8;letter-spacing:0.5px;">STAR</span><span style="margin-left:4px;padding:2px 6px;border-radius:3px;background:#ffffff;font-size:20px;font-weight:900;color:#0f172a;letter-spacing:0.5px;">SAAS</span>
            </td>
          </tr>
          ${body}
        </table>
        <table role="presentation" width="480" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding:20px 40px;">
              <p style="margin:0;font-size:12px;color:#94a3b8;">${footer}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>`;
}

function securityNote(text: string) {
  return `<tr>
            <td style="padding:16px 40px 36px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-top:1px solid #e2e8f0;padding-top:16px;">
                    <p style="margin:0;font-size:12px;line-height:18px;color:#94a3b8;">${text}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
}

export function sendSignInCodeEmail(to: string, name: string, code: string) {
  const body = `<tr>
            <td style="padding:36px 40px 16px 40px;">
              <p style="margin:0 0 8px 0;font-size:18px;font-weight:bold;color:#0f172a;">Your verification code</p>
              <p style="margin:0 0 24px 0;font-size:14px;line-height:22px;color:#475569;">
                Hi ${esc(name)}, use the code below to finish signing in to STAR SAAS Invoice.
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background-color:#f1f5f9;border:1px solid #e2e8f0;border-radius:10px;padding:20px;">
                    <span style="font-family:'Courier New',Courier,monospace;font-size:32px;font-weight:bold;letter-spacing:10px;color:#0f172a;">${esc(code)}</span>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0 0;font-size:13px;line-height:20px;color:#64748b;">
                This code expires in <strong>10 minutes</strong> and can only be used once.
              </p>
            </td>
          </tr>
          ${securityNote(
            "If you didn't try to sign in, you can safely ignore this email. Never share this code with anyone."
          )}`;
  return send(
    to,
    {
      subject: `${code} is your STAR SAAS Invoice verification code`,
      html: layout(body, `This email was sent to ${esc(to)} because a sign-in was attempted on your account.`),
    },
    `Sign-in code for ${to}: ${code}`
  );
}

export function sendInviteEmail(to: string, inviteLink: string, inviterName: string, roleLabel: string) {
  const link = esc(inviteLink);
  const body = `<tr>
            <td style="padding:36px 40px 16px 40px;">
              <p style="margin:0 0 8px 0;font-size:18px;font-weight:bold;color:#0f172a;">You're invited to STAR SAAS Invoice &amp; Cash</p>
              <p style="margin:0 0 24px 0;font-size:14px;line-height:22px;color:#475569;">
                ${esc(inviterName)} invited you to join STAR SAAS Invoice &amp; Cash as <strong>${esc(roleLabel)}</strong>. Accept the invitation to set your name and password.
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:8px 0 8px 0;">
                    <a href="${link}" target="_blank"
                       style="display:inline-block;background-color:#0f172a;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 36px;border-radius:8px;">
                      Accept invitation
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0 0;font-size:13px;line-height:20px;color:#64748b;">
                This link is valid for <strong>72 hours</strong> and can only be used once. You'll set up two-factor sign-in the first time you sign in.
              </p>
              <p style="margin:16px 0 0 0;font-size:12px;line-height:18px;color:#94a3b8;">
                If the button doesn't work, copy and paste this link into your browser:<br />
                <a href="${link}" target="_blank" style="color:#2563eb;word-break:break-all;">${link}</a>
              </p>
            </td>
          </tr>
          ${securityNote("If you weren't expecting this invitation, you can ignore this email. No account is activated until the link is used.")}`;
  return send(
    to,
    {
      subject: `${inviterName} invited you to STAR SAAS Invoice & Cash`,
      html: layout(body, `This email was sent to ${esc(to)} because an administrator invited you.`),
    },
    `Invitation for ${to}: ${inviteLink}`
  );
}

export function sendPasswordResetEmail(to: string, resetLink: string) {
  const link = esc(resetLink);
  const body = `<tr>
            <td style="padding:36px 40px 16px 40px;">
              <p style="margin:0 0 8px 0;font-size:18px;font-weight:bold;color:#0f172a;">Reset your password</p>
              <p style="margin:0 0 24px 0;font-size:14px;line-height:22px;color:#475569;">
                We received a request to reset the password for your STAR SAAS Invoice account. Click the button below to choose a new one.
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:8px 0 8px 0;">
                    <a href="${link}" target="_blank"
                       style="display:inline-block;background-color:#0f172a;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 36px;border-radius:8px;">
                      Reset password
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0 0;font-size:13px;line-height:20px;color:#64748b;">
                This link expires in <strong>30 minutes</strong> and can only be used once.
              </p>
              <p style="margin:16px 0 0 0;font-size:12px;line-height:18px;color:#94a3b8;">
                If the button doesn't work, copy and paste this link into your browser:<br />
                <a href="${link}" target="_blank" style="color:#2563eb;word-break:break-all;">${link}</a>
              </p>
            </td>
          </tr>
          ${securityNote("If you didn't request a password reset, you can safely ignore this email. Your password won't change.")}`;
  return send(
    to,
    {
      subject: "Reset your STAR SAAS Invoice password",
      html: layout(body, `This email was sent to ${esc(to)} because a password reset was requested for your account.`),
    },
    `Password reset for ${to}: ${resetLink}`
  );
}
