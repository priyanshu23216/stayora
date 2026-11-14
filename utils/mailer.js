import "dotenv/config";
import nodemailer from "nodemailer";

// 1. Gmail transporter configuration
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

// 2. OTP Verification Email
export const sendOtpEmail = async (toEmail, otp) => {
    const mailOptions = {
        from: `"Stayora" <${process.env.EMAIL_USER}>`,
        to: toEmail,
        subject: "Stayora - Your Verification Code",
        html: `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; background-color: #f7f9fa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
            <table width="100%" border="0" cellspacing="0" cellpadding="0" style="padding: 40px 15px;">
                <tr>
                    <td align="center">
                        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid #eef0f2;">
                            <!-- Header / Logo -->
                            <tr>
                                <td align="center" style="padding: 30px 20px 20px; border-bottom: 1px solid #f0f2f5;">
                                    <h1 style="margin: 0; font-size: 28px; font-weight: 800; color: #111827; letter-spacing: -0.5px;">Stayora<span style="color: #ff385c;">.</span></h1>
                                </td>
                            </tr>
                            
                            <!-- Body Content -->
                            <tr>
                                <td style="padding: 35px 35px 25px; text-align: center;">
                                    <h2 style="margin: 0 0 12px; font-size: 22px; font-weight: 700; color: #1f2937;">Verify Your Account</h2>
                                    <p style="margin: 0 0 28px; font-size: 15px; line-height: 24px; color: #4b5563;">
                                        Thank you for choosing Stayora. Please use the following 6-digit code to complete your verification:
                                    </p>

                                    <!-- OTP Box -->
                                    <div style="background: #fdf2f4; border: 1.5px dashed #ff385c; border-radius: 10px; padding: 18px 10px; margin: 0 auto 28px; max-width: 300px;">
                                        <span style="font-family: 'Courier New', Courier, monospace; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #ff385c; display: inline-block;">
                                            ${otp}
                                        </span>
                                    </div>

                                    <p style="margin: 0 0 10px; font-size: 13px; color: #6b7280;">
                                        ⏳ This code is valid for <strong>10 minutes</strong>.
                                    </p>
                                    <p style="margin: 0; font-size: 12px; color: #9ca3af;">
                                        If you did not request this verification, please safely ignore this email.
                                    </p>
                                </td>
                            </tr>

                            <!-- Footer -->
                            <tr>
                                <td style="background-color: #fafbfc; padding: 20px; text-align: center; border-top: 1px solid #f0f2f5;">
                                    <p style="margin: 0; font-size: 12px; color: #9ca3af;">
                                        © ${new Date().getFullYear()} Stayora Inc. All rights reserved.
                                    </p>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>
        `,
    };

    return await transporter.sendMail(mailOptions);
};

// 3. Booking Confirmation Email
export const sendBookingConfirmation = async (toEmail, booking) => {
    const mailOptions = {
        from: `"Stayora" <${process.env.EMAIL_USER}>`,
        to: toEmail,
        subject: `Booking Confirmed: ${booking.hotelName} (${booking.bookingId})`,
        html: `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; background-color: #f7f9fa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
            <table width="100%" border="0" cellspacing="0" cellpadding="0" style="padding: 40px 15px;">
                <tr>
                    <td align="center">
                        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 560px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid #eef0f2;">
                            
                            <!-- Header / Logo -->
                            <tr>
                                <td style="padding: 28px 35px 20px; border-bottom: 1px solid #f0f2f5;">
                                    <table width="100%">
                                        <tr>
                                            <td>
                                                <h1 style="margin: 0; font-size: 26px; font-weight: 800; color: #111827;">Stayora<span style="color: #ff385c;">.</span></h1>
                                            </td>
                                            <td align="right">
                                                <span style="background: #e6f9ed; color: #16a34a; font-weight: 700; font-size: 12px; padding: 5px 12px; border-radius: 20px; text-transform: uppercase;">Confirmed</span>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>

                            <!-- Hero message -->
                            <tr>
                                <td style="padding: 30px 35px 15px;">
                                    <h2 style="margin: 0 0 8px; font-size: 22px; font-weight: 700; color: #1f2937;">You're all set! Pack your bags 🧳</h2>
                                    <p style="margin: 0; font-size: 15px; color: #6b7280; line-height: 22px;">
                                        Your reservation at <strong>${booking.hotelName}</strong> is confirmed. Below are your booking details:
                                    </p>
                                </td>
                            </tr>

                            <!-- Booking Details Card -->
                            <tr>
                                <td style="padding: 10px 35px 25px;">
                                    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background: #f9fafb; border-radius: 10px; border: 1px solid #e5e7eb; overflow: hidden;">
                                        <tr>
                                            <td style="padding: 14px 18px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #6b7280;">Booking Reference</td>
                                            <td style="padding: 14px 18px; border-bottom: 1px solid #e5e7eb; font-size: 14px; font-weight: 700; color: #111827;" align="right">#${booking.bookingId}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 14px 18px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #6b7280;">Hotel</td>
                                            <td style="padding: 14px 18px; border-bottom: 1px solid #e5e7eb; font-size: 14px; font-weight: 600; color: #111827;" align="right">${booking.hotelName}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 14px 18px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #6b7280;">Room Category</td>
                                            <td style="padding: 14px 18px; border-bottom: 1px solid #e5e7eb; font-size: 14px; font-weight: 600; color: #111827;" align="right">${booking.roomType}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 14px 18px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #6b7280;">Check-In</td>
                                            <td style="padding: 14px 18px; border-bottom: 1px solid #e5e7eb; font-size: 14px; font-weight: 600; color: #111827;" align="right">${booking.checkIn}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 14px 18px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #6b7280;">Check-Out</td>
                                            <td style="padding: 14px 18px; border-bottom: 1px solid #e5e7eb; font-size: 14px; font-weight: 600; color: #111827;" align="right">${booking.checkOut}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 16px 18px; font-size: 15px; font-weight: 700; color: #111827;">Total Paid</td>
                                            <td style="padding: 16px 18px; font-size: 18px; font-weight: 800; color: #ff385c;" align="right">₹${booking.totalPrice}</td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>

                            <!-- Contact Support Note -->
                            <tr>
                                <td style="padding: 0 35px 30px;">
                                    <p style="margin: 0; font-size: 13px; color: #9ca3af; text-align: center;">
                                        Need to make changes? Reach out to our support team at <a href="mailto:support@stayora.com" style="color: #ff385c; text-decoration: none;">support@stayora.com</a>.
                                    </p>
                                </td>
                            </tr>

                            <!-- Footer -->
                            <tr>
                                <td style="background-color: #fafbfc; padding: 20px; text-align: center; border-top: 1px solid #f0f2f5;">
                                    <p style="margin: 0; font-size: 12px; color: #9ca3af;">
                                        © ${new Date().getFullYear()} Stayora Inc. All rights reserved.
                                    </p>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>
        `,
    };

    return await transporter.sendMail(mailOptions);
};

export const sendBookingCancellation = async (toEmail, booking) => {
    const mailOptions = {
        from: `"Stayora" <${process.env.EMAIL_USER}>`,
        to: toEmail,
        subject: `Booking Cancelled: ${booking.hotelName} (${booking.bookingId})`,
        html: 

        `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Booking Cancelled</title>
        </head>
        <body style="margin: 0; padding: 0; background-color: #f7f9fa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
            <table width="100%" border="0" cellspacing="0" cellpadding="0" style="padding: 40px 15px;">
                <tr>
                    <td align="center">
                        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 560px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid #eef0f2;">
                            
                            <!-- Header / Logo -->
                            <tr>
                                <td style="padding: 28px 35px 20px; border-bottom: 1px solid #f0f2f5;">
                                    <table width="100%" border="0" cellspacing="0" cellpadding="0">
                                        <tr>
                                            <td>
                                                <h1 style="margin: 0; font-size: 26px; font-weight: 800; color: #111827;">Stayora<span style="color: #ff385c;">.</span></h1>
                                            </td>
                                            <td align="right">
                                                <span style="background: #fee2e2; color: #dc2626; font-weight: 700; font-size: 12px; padding: 5px 12px; border-radius: 20px; text-transform: uppercase;">Cancelled</span>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                            <!-- Hero message -->
                            <tr>
                                <td style="padding: 30px 35px 15px;">
                                    <h2 style="margin: 0 0 8px; font-size: 22px; font-weight: 700; color: #1f2937;">Booking Cancellation Notice</h2>
                                    <p style="margin: 0; font-size: 15px; color: #6b7280; line-height: 22px;">
                                        Your reservation at <strong>${booking.hotelName}</strong> has been successfully cancelled as requested.
                                    </p>
                                </td>
                            </tr>
                            <!-- Refund Info Box -->
                            <tr>
                                <td style="padding: 0 35px 15px;">
                                    <div style="background-color: #fff7ed; border-left: 4px solid #f97316; padding: 14px 16px; border-radius: 6px;">
                                        <p style="margin: 0; font-size: 13px; line-height: 20px; color: #9a3412;">
                                            💳 <strong>Refund Information:</strong> If you are eligible for a refund, it will be processed back to your original payment method within <strong>5–7 business days</strong>.
                                        </p>
                                    </div>
                                </td>
                            </tr>
                            <!-- Cancelled Booking Details Card -->
                            <tr>
                                <td style="padding: 10px 35px 25px;">
                                    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background: #f9fafb; border-radius: 10px; border: 1px solid #e5e7eb; overflow: hidden;">
                                        <tr>
                                            <td style="padding: 14px 18px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #6b7280;">Booking Reference</td>
                                            <td style="padding: 14px 18px; border-bottom: 1px solid #e5e7eb; font-size: 14px; font-weight: 700; color: #111827;" align="right">#${booking.bookingId}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 14px 18px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #6b7280;">Hotel</td>
                                            <td style="padding: 14px 18px; border-bottom: 1px solid #e5e7eb; font-size: 14px; font-weight: 600; color: #111827;" align="right">${booking.hotelName}</td>
                                        </tr>
                                        ${booking.roomType ? `
                                        <tr>
                                            <td style="padding: 14px 18px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #6b7280;">Room Category</td>
                                            <td style="padding: 14px 18px; border-bottom: 1px solid #e5e7eb; font-size: 14px; font-weight: 600; color: #111827;" align="right">${booking.roomType}</td>
                                        </tr>` : ''}
                                        <tr>
                                            <td style="padding: 14px 18px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #6b7280;">Check-In</td>
                                            <td style="padding: 14px 18px; border-bottom: 1px solid #e5e7eb; font-size: 14px; font-weight: 600; color: #111827;" align="right">${booking.checkIn}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 14px 18px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #6b7280;">Check-Out</td>
                                            <td style="padding: 14px 18px; border-bottom: 1px solid #e5e7eb; font-size: 14px; font-weight: 600; color: #111827;" align="right">${booking.checkOut}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 16px 18px; font-size: 15px; font-weight: 700; color: #111827;">Total Amount</td>
                                            <td style="padding: 16px 18px; font-size: 18px; font-weight: 800; color: #6b7280; text-decoration: line-through;" align="right">₹${booking.totalPrice}</td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                            <!-- Contact Support Note -->
                            <tr>
                                <td style="padding: 0 35px 30px;">
                                    <p style="margin: 0; font-size: 13px; color: #9ca3af; text-align: center;">
                                        If this cancellation was not made by you or if you need assistance, please contact us immediately at <a href="mailto:support@stayora.com" style="color: #ff385c; text-decoration: none;">support@stayora.com</a>.
                                    </p>
                                </td>
                            </tr>
                            <!-- Footer -->
                            <tr>
                                <td style="background-color: #fafbfc; padding: 20px; text-align: center; border-top: 1px solid #f0f2f5;">
                                    <p style="margin: 0; font-size: 12px; color: #9ca3af;">
                                        © ${new Date().getFullYear()} Stayora Inc. All rights reserved.
                                    </p>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>`,
    };
    return await transporter.sendMail(mailOptions);
};


export const resetPassEmail = async (toEmail, message) => {
    const mailOptions = {
        from: `"Stayora" <${process.env.EMAIL_USER}>`,
        to: toEmail,
        subject: "Stayora - Regarding Password Reset",
        html: `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; background-color: #f7f9fa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
            <table width="100%" border="0" cellspacing="0" cellpadding="0" style="padding: 40px 15px;">
                <tr>
                    <td align="center">
                        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid #eef0f2;">
                            <!-- Header / Logo -->
                            <tr>
                                <td align="center" style="padding: 30px 20px 20px; border-bottom: 1px solid #f0f2f5;">
                                    <h1 style="margin: 0; font-size: 28px; font-weight: 800; color: #111827; letter-spacing: -0.5px;">Stayora<span style="color: #ff385c;">.</span></h1>
                                </td>
                            </tr>

                            <!-- Body Content -->
                            <tr>
                                <td style="padding: 35px 35px 28px;">
                                    <h2 style="margin: 0 0 14px; font-size: 20px; font-weight: 700; color: #1f2937; text-align: center;">Account Sign-In Notice</h2>

                                    <div style="background-color: #f9fafb; border-left: 4px solid #ff385c; border-radius: 6px; padding: 16px 18px; margin-bottom: 22px;">
                                        <p style="margin: 0; font-size: 15px; line-height: 24px; color: #374151;">
                                            ${message}
                                        </p>
                                    </div>

                                    <p style="margin: 0; font-size: 13px; line-height: 20px; color: #6b7280; text-align: center;">
                                        If you did not request this, you can safely ignore this email — your account remains secure.
                                    </p>
                                </td>
                            </tr>

                            <!-- Footer -->
                            <tr>
                                <td style="background-color: #fafbfc; padding: 20px; text-align: center; border-top: 1px solid #f0f2f5;">
                                    <p style="margin: 0; font-size: 12px; color: #9ca3af;">
                                        © ${new Date().getFullYear()} Stayora Inc. All rights reserved.
                                    </p>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>
        `,
    };

    return await transporter.sendMail(mailOptions);
};
export const passChangeAlertEmail = async (toEmail) => {
    const mailOptions = {
        from: `"Stayora" <${process.env.EMAIL_USER}>`,
        to: toEmail,
        subject: "Stayora - Security Alert!,Your Password was recently changed",
        html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Your Stayora password was changed</title>
        </head>
        <body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: Arial, Helvetica, sans-serif; color: #1f2937;">
            <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f3f4f6; padding: 32px 12px;">
                <tr>
                    <td align="center">
                        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 560px; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px;">
                            <tr>
                                <td align="center" style="padding: 26px 24px; border-bottom: 1px solid #eef0f2;">
                                    <h1 style="margin: 0; font-size: 26px; font-weight: 700; color: #111827;">Stayora<span style="color: #ff385c;">.</span></h1>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding: 32px 30px;">
                                    <h2 style="margin: 0 0 12px; font-size: 22px; line-height: 30px; text-align: center; color: #111827;">Your password was changed</h2>
                                    <p style="margin: 0 0 24px; font-size: 15px; line-height: 24px; text-align: center; color: #4b5563;">
                                        This is a confirmation that your Stayora account password was updated.
                                    </p>
                                    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 22px; background-color: #fff7f7; border: 1px solid #ffd5dc; border-radius: 8px;">
                                        <tr>
                                            <td style="padding: 16px 18px;">
                                                <p style="margin: 0; font-size: 14px; line-height: 22px; color: #374151;">
                                                    <strong style="color: #b4233b;">Change details</strong><br>
                                                    Your password change is complete.
                                                </p>
                                            </td>
                                        </tr>
                                    </table>
                                    <p style="margin: 0 0 12px; font-size: 14px; line-height: 22px; color: #374151;">
                                        <strong>Didn't make this change?</strong> Go to Stayora using your usual method and reset your password immediately.
                                    </p>
                                    <p style="margin: 0; font-size: 13px; line-height: 20px; color: #6b7280;">
                                        For your security, never share your password or verification codes with anyone.
                                    </p>
                                </td>
                            </tr>
                            <tr>
                                <td align="center" style="padding: 18px 24px; background-color: #fafafa; border-top: 1px solid #eef0f2; border-radius: 0 0 12px 12px;">
                                    <p style="margin: 0; font-size: 12px; line-height: 18px; color: #9ca3af;">
                                        &copy; ${new Date().getFullYear()} Stayora. All rights reserved.
                                    </p>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>
        `,
    };

    return await transporter.sendMail(mailOptions);
};



