const nodemailer = require('nodemailer');

// Configure email transporter
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_HOST || 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

// Email templates
const getSenderEmailTemplate = (shipment) => {
    const trackingLink = `${process.env.FRONTEND_URL}/tracking/${shipment.trackingNumber}`;
    
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #1a56db; color: white; padding: 20px; text-align: center; }
                .content { padding: 20px; background: #f9fafb; }
                .details { background: white; padding: 15px; margin: 15px 0; border-radius: 5px; }
                .tracking-btn { display: inline-block; background: white; color: black; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
                .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
            </style>
        </head>
        <body> 
            <div class="container">
                <div class="header">
                    <h1>Shipment Created Successfully</h1>
                </div>
                <div class="content">
                    <h2>Dear ${shipment.sender?.name || 'Customer'},</h2>
                    <p>Your shipment has been successfully created and is now being processed.</p>
                    
                    <div class="details">
                        <h3>Shipment Details:</h3>
                        <p><strong>Shipment Number:</strong> ${shipment.shipmentNumber}</p>
                        <p><strong>Tracking Number:</strong> ${shipment.trackingNumber}</p>
                        <p><strong>Service Type:</strong> ${shipment.serviceType}</p>
                        <p><strong>Origin:</strong> ${shipment.shipmentDetails?.origin}</p>
                        <p><strong>Destination:</strong> ${shipment.shipmentDetails?.destination}</p>
                        <p><strong>Estimated Delivery:</strong> ${shipment.dates?.estimatedArrival ? new Date(shipment.dates.estimatedArrival).toLocaleDateString() : 'To be confirmed'}</p>
                        <p><strong>Status:</strong> ${shipment.shipmentStatus}</p>
                    </div>
                    
                    <div class="details">
                        <h3>Package Details:</h3>
                        ${shipment.shipmentDetails?.packageDetails?.map(pkg => `
                            <p><strong>${pkg.description || 'Package'}:</strong> ${pkg.quantity} x ${pkg.weight}kg</p>
                        `).join('') || '<p>No package details available</p>'}
                    </div>
                    
                    <center>
                        <a href="${trackingLink}" class="tracking-btn">Track Your Shipment</a>
                    </center>
                    
                    <p>You can track your shipment anytime using the tracking number: <strong>${shipment.trackingNumber}</strong></p>
                    <p>For any questions, please contact our support team.</p>
                </div>
                <div class="footer">
                    <p>&copy; ${new Date().getFullYear()} Cargo Logistics Group. All rights reserved.</p>
                    <p>This is an automated message, please do not reply.</p>
                </div>
            </div>
        </body>
        </html>
    `;
};

const getReceiverEmailTemplate = (shipment) => {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #10b981; color: white; padding: 20px; text-align: center; }
                .content { padding: 20px; background: #f9fafb; }
                .details { background: white; padding: 15px; margin: 15px 0; border-radius: 5px; }
                .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Your Parcel is On The Way!</h1>
                </div>
                <div class="content">
                    <h2>Dear ${shipment.receiver?.name || 'Customer'},</h2>
                    <p>We're pleased to inform you that a parcel has been dispatched to you.</p>
                    
                    <div class="details">
                        <h3>Shipment Details:</h3>
                        <p><strong>Shipment Number:</strong> ${shipment.shipmentNumber}</p>
                        <p><strong>Tracking Number:</strong> ${shipment.trackingNumber}</p>
                        <p><strong>Origin:</strong> ${shipment.shipmentDetails?.origin}</p>
                        <p><strong>Destination:</strong> ${shipment.shipmentDetails?.destination}</p>
                        <p><strong>Estimated Delivery:</strong> ${shipment.dates?.estimatedArrival ? new Date(shipment.dates.estimatedArrival).toLocaleDateString() : 'To be confirmed'}</p>
                    </div>
                    
                    <p>You can track your parcel using the tracking number above.</p>
                    <p>For any questions about delivery, please contact our support team.</p>
                </div>
                <div class="footer">
                    <p>&copy; ${new Date().getFullYear()} Cargo Logistics Group. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
    `;
};

const getAdminEmailTemplate = (shipment) => {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #7c3aed; color: white; padding: 20px; text-align: center; }
                .content { padding: 20px; background: #f9fafb; }
                .details { background: white; padding: 15px; margin: 15px 0; border-radius: 5px; }
                .alert { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 15px 0; }
                .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>New Shipment Created</h1>
                </div>
                <div class="content">
                    <div class="alert">
                        <strong>⚠️ Action Required:</strong> A new shipment has been created and requires processing.
                    </div>
                    
                    <div class="details">
                        <h3>Shipment Information:</h3>
                        <p><strong>Shipment Number:</strong> ${shipment.shipmentNumber}</p>
                        <p><strong>Tracking Number:</strong> ${shipment.trackingNumber}</p>
                        <p><strong>Service Type:</strong> ${shipment.serviceType}</p>
                        <p><strong>Status:</strong> ${shipment.shipmentStatus}</p>
                        <p><strong>Created By:</strong> ${shipment.createdBy || 'System'}</p>
                        <p><strong>Created At:</strong> ${new Date(shipment.createdAt).toLocaleString()}</p>
                    </div>
                    
                    <div class="details">
                        <h3>Sender Information:</h3>
                        <p><strong>Name:</strong> ${shipment.sender?.name || 'N/A'}</p>
                        <p><strong>Email:</strong> ${shipment.sender?.email || 'N/A'}</p>
                        <p><strong>Phone:</strong> ${shipment.sender?.phone || 'N/A'}</p>
                    </div>
                    
                    <div class="details">
                        <h3>Receiver Information:</h3>
                        <p><strong>Name:</strong> ${shipment.receiver?.name || 'N/A'}</p>
                        <p><strong>Email:</strong> ${shipment.receiver?.email || 'N/A'}</p>
                        <p><strong>Phone:</strong> ${shipment.receiver?.phone || 'N/A'}</p>
                    </div>
                    
                    <div class="details">
                        <h3>Financial Information:</h3>
                        <p><strong>Quoted Amount:</strong> ${shipment.quotedPrice?.currency || 'USD'} ${shipment.quotedPrice?.amount || 0}</p>
                        <p><strong>Payment Mode:</strong> ${shipment.payment?.mode || 'Not specified'}</p>
                    </div>
                    
                    <center>
                        <a href="${process.env.ADMIN_URL}/shipments/${shipment._id}" style="display: inline-block; background: #7c3aed; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">
                            View in Admin Panel
                        </a>
                    </center>
                </div>
                <div class="footer">
                    <p>&copy; ${new Date().getFullYear()} Cargo Logistics Group. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
    `;
};

// Send email function
const sendEmail = async (to, subject, html, attachments = []) => {
    try {
        const mailOptions = {
            from: `"Cargo Logistics" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
            to,
            subject,
            html,
            attachments
        };
        
        const info = await transporter.sendMail(mailOptions);
        console.log(`Email sent to ${to}:`, info.messageId);
        return true;
    } catch (error) {
        console.error(`Failed to send email to ${to}:`, error);
        return false;
    }
};

module.exports = {
    sendEmail,
    getSenderEmailTemplate,
    getReceiverEmailTemplate,
    getAdminEmailTemplate
};