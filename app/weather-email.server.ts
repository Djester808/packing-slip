import nodemailer from "nodemailer";

let _transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function makeTransporter() {
  if (!_transporter) {
    console.log(`[Email] Initializing transporter for ${process.env.OUTLOOK_EMAIL}`);
    _transporter = nodemailer.createTransport({
      host: "smtp-mail.outlook.com",
      port: 587,
      secure: false,
      auth: {
        user: process.env.OUTLOOK_EMAIL,
        pass: process.env.OUTLOOK_PASSWORD,
      },
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
  shippingMethod?: string,
): Promise<boolean> {
  try {
    const logoHtml = logoUrl ? `<div style="margin-bottom:16px;"><img src="${logoUrl}" alt="Superior Shrimp & Aquatics" style="width:72px;height:72px;border-radius:50%;object-fit:cover;border:3px solid rgba(255,255,255,0.25);display:block;margin:0 auto;" /></div>` : "";
    const deliveryHtml = deliveryDate ? `<p style="font-size:15px; line-height:1.6; color:#6b6060; margin:0 0 18px 0;"><strong>Estimated Delivery:</strong> ${deliveryDate}</p>` : "";
    const tempHtml = maxTempF ? `<p style="font-size:15px; line-height:1.6; color:#6b6060; margin:0 0 18px 0;"><strong>Estimated Temp:</strong> ${Math.round(maxTempF)}°F</p>` : "";
    const speedHtml = shippingMethod ? `<p style="font-size:15px; line-height:1.6; color:#6b6060; margin:0 0 18px 0;"><strong>Shipping Method:</strong> ${shippingMethod}</p>` : "";

    const html = `<!-- Superior Shrimp & Aquatics - Weather Delay Email -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0; padding:0; background-color:#f5f5f5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px; background-color:#ffffff; border-radius:8px; overflow:hidden;">
        <tr>
          <td style="padding:32px 36px; background-color:#fafafa; border-bottom:2px solid #e8e2da;">
            ${logoHtml}
            <div style="font-family:Arial, sans-serif; font-size:24px; font-weight:bold; color:#1a1a1a; margin-top:12px;">Heat Advisory: Shipping Delays This Week</div>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 36px; font-family:Arial, sans-serif; line-height:1.6; color:#333333;">
            <p style="font-size:16px; margin:0 0 20px 0;">Hi ${firstName},</p>
            <p style="font-size:15px; margin:0 0 18px 0;">A heat wave is moving across much of the country, and we're holding orders to protect your livestock. High temperatures during transit are one of the biggest risks to live shrimp and fish, and shipping into dangerous heat is not worth the loss.</p>

            <div style="background-color:#f0f0f0; border-left:4px solid #666; padding:16px; margin:20px 0; border-radius:4px;">
              <p style="font-size:15px; font-weight:bold; color:#1a1a1a; margin:0 0 12px 0;">What this means for you:</p>
              <ul style="font-size:14px; margin:0; padding-left:20px; color:#333;">
                <li style="margin-bottom:8px;">Many orders will be delayed until conditions improve in transit zones</li>
                <li style="margin-bottom:8px;">We process in the order received (FIFO) once it's safe to ship</li>
                <li style="margin-bottom:8px;">Orders ship with cold packs as conditions require</li>
                <li>You'll get tracking as soon as your order goes out</li>
              </ul>
            </div>

            <p style="font-size:15px; margin:20px 0;">We watch the forecasts daily and ship the moment the route clears. Holding your order is a deliberate call to make sure your animals arrive alive and healthy.</p>

            <p style="font-size:15px; margin:20px 0;">This affects order <strong>${orderName}</strong>.</p>

            <p style="font-size:15px; margin:0;">Thanks for trusting us with your livestock. Questions about a specific order? Reply here or email us.</p>

            <p style="font-size:16px; font-weight:bold; color:#1a1a1a; margin:24px 0 0 0;">John - Owner<br/>Superior Shrimp & Aquatics</p>

            <p style="font-size:13px; color:#666; margin:16px 0 0 0;"><a href="https://www.superiorshrimpaquatics.com" style="color:#0066cc; text-decoration:none;">www.superiorshrimpaquatics.com</a></p>
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
