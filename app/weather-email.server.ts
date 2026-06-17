import nodemailer from "nodemailer";

let _transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function makeTransporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      pool: true,
      maxConnections: 3,
      maxMessages: Infinity,
      host: "smtp.office365.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: {
        user: process.env.OUTLOOK_EMAIL,
        pass: process.env.OUTLOOK_PASSWORD,
      },
      tls: { ciphers: "SSLv3", rejectUnauthorized: false },
    });
  }
  return _transporter;
}

export async function sendWeatherDelayEmail(
  email: string,
  firstName: string,
  orderName: string,
  logoUrl?: string,
  deliveryDate?: string,
  maxTempF?: number | null,
  transitDays?: number,
): Promise<boolean> {
  try {
    const logoHtml = logoUrl ? `<div style="margin-bottom:16px;"><img src="${logoUrl}" alt="Superior Shrimp & Aquatics" style="width:72px;height:72px;border-radius:50%;object-fit:cover;border:3px solid rgba(255,255,255,0.25);display:block;margin:0 auto;" /></div>` : "";
    const deliveryHtml = deliveryDate ? `<p style="font-size:15px; line-height:1.6; color:#6b6060; margin:0 0 18px 0;"><strong>Estimated Delivery:</strong> ${deliveryDate}</p>` : "";
    const tempHtml = maxTempF ? `<p style="font-size:15px; line-height:1.6; color:#6b6060; margin:0 0 18px 0;"><strong>Estimated Temp:</strong> ${Math.round(maxTempF)}°F</p>` : "";
    const speedHtml = transitDays ? `<p style="font-size:15px; line-height:1.6; color:#6b6060; margin:0 0 18px 0;"><strong>Shipping Speed:</strong> ${transitDays} day${transitDays > 1 ? "s" : ""}</p>` : "";

    const html = `<!-- Superior Shrimp & Aquatics - Weather Delay Email -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0; padding:0; background-color:#f7f3ee;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px; background-color:#ffffff; border-radius:14px; overflow:hidden; border:1px solid #e8e2da;">
        <tr>
          <td style="background-color:#b50707; background-image:linear-gradient(160deg,#b50707 0%,#F40909 100%); padding:32px 36px; text-align:center;">
            ${logoHtml}
            <div style="font-family:'Playfair Display',Georgia,serif; font-size:26px; font-weight:700; color:#ffffff; line-height:1.2;">Superior Shrimp & Aquatics</div>
            <div style="font-family:'DM Sans',Arial,sans-serif; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:#ffe5e5; margin-top:8px;">Weather Hold Notice</div>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 36px 8px 36px; font-family:'DM Sans',Arial,sans-serif;">
            <p style="font-family:'Playfair Display',Georgia,serif; font-size:22px; font-weight:600; color:#1e1a1a; margin:0 0 18px 0;">Thank you for your order, ${firstName}!</p>
            <p style="font-size:15px; line-height:1.7; color:#6b6060; margin:0 0 18px 0;">Currently, the temperatures in your area are above our safety threshold for shipping live animals. We don't want your shipment sitting on a hot truck all day, so to get it out to you this week, we would need to route it to a <strong style="color:#111111;">UPS Access Point</strong> near you for pickup.</p>
            ${deliveryHtml}
            ${tempHtml}
            ${speedHtml}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 26px 0;">
              <tr>
                <td style="background-color:#fff0f0; border-left:4px solid #F40909; border-radius:10px; padding:14px 18px;">
                  <p style="font-size:14px; line-height:1.6; color:#1e1a1a; margin:0;">This affects order <strong style="color:#b50707;">${orderName}</strong>. Live animals only ship when conditions are safe, so we are pausing it until we hear from you.</p>
                </td>
              </tr>
            </table>
            <p style="font-size:12px; font-weight:500; letter-spacing:0.12em; text-transform:uppercase; color:#b50707; margin:0 0 4px 0;">What To Do</p>
            <p style="font-family:'Playfair Display',Georgia,serif; font-size:19px; font-weight:600; color:#1e1a1a; margin:0 0 18px 0;">Find a UPS Access Point Near You</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px 0;">
              <tr>
                <td width="40" valign="top" style="padding-top:2px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="28" height="28" align="center" valign="middle" style="background-color:#F40909; border-radius:50%; font-family:'DM Sans',Arial,sans-serif; font-size:13px; font-weight:700; color:#ffffff; line-height:28px;">1</td></tr></table>
                </td>
                <td valign="top" style="font-family:'DM Sans',Arial,sans-serif; font-size:14px; line-height:1.6; color:#6b6060;">Visit <a href="https://www.ups.com/dropoff" style="color:#b50707; text-decoration:underline;">ups.com</a> and go to the <strong style="color:#111111;">Find Locations</strong> page, or search "UPS Access Point near me."</td>
              </tr>
            </table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px 0;">
              <tr>
                <td width="40" valign="top" style="padding-top:2px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="28" height="28" align="center" valign="middle" style="background-color:#F40909; border-radius:50%; font-family:'DM Sans',Arial,sans-serif; font-size:13px; font-weight:700; color:#ffffff; line-height:28px;">2</td></tr></table>
                </td>
                <td valign="top" style="font-family:'DM Sans',Arial,sans-serif; font-size:14px; line-height:1.6; color:#6b6060;">Enter your ZIP code or address.</td>
              </tr>
            </table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
              <tr>
                <td width="40" valign="top" style="padding-top:2px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="28" height="28" align="center" valign="middle" style="background-color:#F40909; border-radius:50%; font-family:'DM Sans',Arial,sans-serif; font-size:13px; font-weight:700; color:#ffffff; line-height:28px;">3</td></tr></table>
                </td>
                <td valign="top" style="font-family:'DM Sans',Arial,sans-serif; font-size:14px; line-height:1.6; color:#6b6060;">Choose one convenient to you and copy down the <strong style="color:#111111;">full street address</strong>.</td>
              </tr>
            </table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 26px 0;">
              <tr>
                <td style="background-color:#f7f3ee; border:1px solid #e8e2da; border-radius:12px; padding:22px 22px;">
                  <p style="font-family:'Playfair Display',Georgia,serif; font-size:17px; font-weight:600; color:#1e1a1a; margin:0 0 8px 0;">Reply with your pickup address</p>
                  <p style="font-family:'DM Sans',Arial,sans-serif; font-size:14px; line-height:1.65; color:#6b6060; margin:0 0 16px 0;">Once you have it, just reply to this email with the full Access Point street address and we will get your order shipped there. Prefer to wait? We can hold your order and reevaluate shipping next week instead.</p>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td align="center" style="background-color:#F40909; border-radius:8px;">
                        <a href="mailto:support@superiorshrimpaquatics.com?subject=Access%20Point%20Address%20for%20Order%20${orderName}" style="display:inline-block; font-family:'DM Sans',Arial,sans-serif; font-size:15px; font-weight:600; color:#ffffff; text-decoration:none; padding:13px 28px;">Reply With My Address</a>
                      </td>
                    </tr>
                  </table>
                  <p style="font-family:'DM Sans',Arial,sans-serif; font-size:12px; line-height:1.5; color:#80666b; margin:14px 0 0 0;">Please let us know as soon as you can, otherwise your order may be delayed.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background-color:#111111; padding:28px 36px; text-align:center;">
            <p style="font-family:'Playfair Display',Georgia,serif; font-size:16px; font-weight:600; color:#ffffff; margin:0 0 6px 0;">Superior Shrimp & Aquatics</p>
            <p style="font-family:'DM Sans',Arial,sans-serif; font-size:12px; line-height:1.6; color:#b8aeae; margin:0 0 16px 0;">Thank you for supporting a small, family-run business.</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 16px auto;">
              <tr>
                <td style="padding:0 9px;"><a href="https://www.facebook.com/p/Superior-Shrimp-Aquatics-61553268254349/" style="font-family:'DM Sans',Arial,sans-serif; font-size:12px; font-weight:500; color:#ff8a8a; text-decoration:none;">Facebook</a></td>
                <td style="color:#444444; font-size:12px;">|</td>
                <td style="padding:0 9px;"><a href="https://www.instagram.com/superior_shrimp_aquatics/" style="font-family:'DM Sans',Arial,sans-serif; font-size:12px; font-weight:500; color:#ff8a8a; text-decoration:none;">Instagram</a></td>
                <td style="color:#444444; font-size:12px;">|</td>
                <td style="padding:0 9px;"><a href="https://www.tiktok.com/@superiorshrimp" style="font-family:'DM Sans',Arial,sans-serif; font-size:12px; font-weight:500; color:#ff8a8a; text-decoration:underline;">TikTok</a></td>
              </tr>
            </table>
            <p style="font-family:'DM Sans',Arial,sans-serif; font-size:12px; line-height:1.7; color:#b8aeae; margin:0 0 4px 0;">
              <a href="https://www.superiorshrimpaquatics.com/pages/shipping-info-practices" style="color:#ff8a8a; text-decoration:underline;">Shipping Info & Practices</a>
            </p>
            <p style="font-family:'DM Sans',Arial,sans-serif; font-size:12px; line-height:1.7; color:#b8aeae; margin:0;">Questions? <a href="mailto:support@superiorshrimpaquatics.com" style="color:#ff8a8a; text-decoration:underline;">support@superiorshrimpaquatics.com</a></p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;

    await makeTransporter().sendMail({
      from: process.env.OUTLOOK_EMAIL,
      to: email,
      subject: `Your order ${orderName} — Weather delay`,
      html,
    });

    console.log(`[Webhook] Weather delay email sent to ${email} for order ${orderName}`);
    return true;
  } catch (error) {
    console.error(`[Webhook] Error sending weather delay email to ${email}:`, error);
    return false;
  }
}
