import type { EmailRecipient } from "@/lib/emailCenter";

const LOGO_URL = "https://kentbusinesscollege.org/email-assets/logo.png";
const EMAIL_WIDTH = 420;
const CONTENT_WIDTH = 360;

const colors = {
  cream: "#F9F4EC",
  sand: "#E9D9BD",
  gold: "#B27715",
  goldDark: "#80560F",
  purpleLight: "#F9F5FF",
  purple: "#644D93",
  purpleDark: "#241453",
  grey50: "#F8F8F8",
  grey200: "#E4E4E4",
  grey700: "#808080",
  grey900: "#4C4C4C",
};

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const escapeAttribute = (value: unknown) =>
  escapeHtml(value).replace(/`/g, "&#96;");

const paragraphsFromText = (text: string) =>
  String(text || "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\n/).map(escapeHtml).join("<br />");
      return `<p style="margin:0 0 16px 0; color:${colors.grey900}; font-family:Arial, Helvetica, sans-serif; font-size:18px !important; line-height:28px !important; mso-line-height-rule:exactly;">${lines}</p>`;
    })
    .join("");

const actionLabelByCategory: Record<string, string> = {
  "review-due": "Book Progress Review",
  "coaching-due": "Book Monthly Coaching Meeting",
  "missed-session": "Contact Your Coach",
  "otj-behind": "Discuss Catch-Up Plan",
};

const introByCategory: Record<string, string> = {
  "missed-session": "Attendance action required",
  "review-due": "Progress review follow-up",
  "coaching-due": "Monthly coaching meeting follow-up",
  "otj-behind": "Off-the-job training support",
};

export function buildBrandedEmailHtml({
  subject,
  body,
  recipient,
  kpiCategory,
  previewMode = false,
}: {
  subject: string;
  body: string;
  recipient: EmailRecipient;
  kpiCategory: string;
  previewMode?: boolean;
}) {
  const bookingLink = String(recipient.bookingLink || "").trim();
  const coachEmail = String(recipient.coachEmail || "").trim();
  const programme = String(recipient.programme || "Programme").trim() || "Programme";
  const hasActionButton =
    ["missed-session", "review-due", "coaching-due"].includes(kpiCategory) ||
    (previewMode && kpiCategory === "otj-behind");
  const actionUrl = hasActionButton ? bookingLink || (coachEmail ? `mailto:${coachEmail}` : "") : "";
  const actionLabel = actionLabelByCategory[kpiCategory] || "View Next Step";
  const eyebrow = introByCategory[kpiCategory] || "Learner support update";
  const safeSubject = escapeHtml(subject);
  const safeProgramme = escapeHtml(programme);
  const safeActionUrl = escapeAttribute(actionUrl || "#");
  const actionButton = hasActionButton && (actionUrl || previewMode)
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 20px 0;">
        <tr>
          <td width="220" align="center" bgcolor="${colors.gold}" style="border-radius:10px; background:${colors.gold};">
            <a href="${safeActionUrl}" target="_blank" style="display:block; padding:14px 18px; color:#ffffff; font-family:Arial, Helvetica, sans-serif; font-size:16px !important; line-height:20px; font-weight:700; text-decoration:none; border-radius:10px;">
              ${escapeHtml(actionLabel)}
            </a>
          </td>
        </tr>
      </table>
    `
    : "";

  const fallbackLine = hasActionButton && !actionUrl && !previewMode
    ? `<p style="margin:0 0 16px 0; color:${colors.grey700}; font-family:Arial, Helvetica, sans-serif; font-size:16px !important; line-height:24px;">No booking link is currently available for this coach. Please contact the engagement team for support.</p>`
    : "";

  return `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safeSubject}</title>
  </head>
  <body style="margin:0; padding:0; background:${colors.grey50}; font-family:Arial, Helvetica, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${colors.grey50}" style="width:100%; background:${colors.grey50}; margin:0;">
      <tr>
        <td align="center" style="padding:18px 8px;">
          <table role="presentation" width="${EMAIL_WIDTH}" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:${EMAIL_WIDTH}px; background:#ffffff; border:1px solid ${colors.grey200}; border-radius:16px; overflow:hidden;">
            <tr>
              <td width="${EMAIL_WIDTH}" bgcolor="${colors.purpleDark}" style="width:${EMAIL_WIDTH}px; background:${colors.purpleDark}; padding:0;">
                <table role="presentation" width="${EMAIL_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:${EMAIL_WIDTH}px;">
                  <tr>
                    <td width="230" valign="middle" style="width:230px; padding:20px 24px;">
                      <img src="${LOGO_URL}" width="126" alt="Kent Business College" style="display:block; width:126px; height:auto; border:0; outline:none; text-decoration:none;" />
                    </td>
                    <td width="190" align="right" valign="middle" style="width:190px; padding:20px 24px; color:${colors.sand}; font-family:Arial, Helvetica, sans-serif; font-size:10px; line-height:15px; font-weight:700; letter-spacing:.06em; text-transform:uppercase;">
                      Engagement Workspace
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td width="${EMAIL_WIDTH}" style="width:${EMAIL_WIDTH}px; padding:24px 20px 20px 20px;">
                <table role="presentation" width="${CONTENT_WIDTH}" cellpadding="0" cellspacing="0" border="0" bgcolor="${colors.purpleLight}" style="width:${CONTENT_WIDTH}px; background:${colors.purpleLight}; border:1px solid #E7DAF4; border-radius:14px; margin-bottom:22px;">
                  <tr>
                    <td style="padding:18px 18px;">
                      <p style="margin:0 0 8px 0; color:${colors.goldDark}; font-family:Arial, Helvetica, sans-serif; font-size:11px; line-height:15px; font-weight:800; letter-spacing:.07em; text-transform:uppercase;">${escapeHtml(eyebrow)}</p>
                      <h1 style="margin:0; color:${colors.purpleDark}; font-family:Arial, Helvetica, sans-serif; font-size:25px !important; line-height:31px !important; font-weight:800; mso-line-height-rule:exactly;">${safeSubject}</h1>
                      <p style="margin:10px 0 0 0; color:${colors.grey700}; font-family:Arial, Helvetica, sans-serif; font-size:14px !important; line-height:20px;">${safeProgramme}</p>
                    </td>
                  </tr>
                </table>

                ${paragraphsFromText(body)}
                ${actionButton}
                ${fallbackLine}

                <table role="presentation" width="${CONTENT_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:${CONTENT_WIDTH}px; margin-top:22px; border-top:1px solid ${colors.grey200};">
                  <tr>
                    <td style="padding-top:16px;">
                      <p style="margin:0; color:${colors.grey700}; font-family:Arial, Helvetica, sans-serif; font-size:13px !important; line-height:19px;">
                        Kent Business College<br />
                        This message was sent by the Engagement Coordinator team.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td width="${EMAIL_WIDTH}" bgcolor="${colors.cream}" style="width:${EMAIL_WIDTH}px; background:${colors.cream}; border-top:1px solid ${colors.sand}; padding:14px 20px; color:${colors.grey700}; font-family:Arial, Helvetica, sans-serif; font-size:12px !important; line-height:18px;">
                Please do not ignore this message. If you have already completed this action, contact your coach so records can be updated.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
