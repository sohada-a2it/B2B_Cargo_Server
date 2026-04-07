const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// Ensure invoices directory exists
const invoicesDir = path.join(__dirname, '../invoices');
if (!fs.existsSync(invoicesDir)) {
    fs.mkdirSync(invoicesDir, { recursive: true });
}

// Generate PDF invoice
const generateInvoicePDF = async (shipment) => {
    return new Promise((resolve, reject) => {
        try {
            const invoiceNumber = `INV-${shipment.shipmentNumber}`;
            const fileName = `${invoiceNumber}.pdf`;
            const filePath = path.join(invoicesDir, fileName);
            
            const doc = new PDFDocument({ margin: 50 });
            const stream = fs.createWriteStream(filePath);
            
            doc.pipe(stream);
            
            // Header
            doc.fontSize(20)
                .font('Helvetica-Bold')
                .text('CARGO LOGISTICS GROUP', { align: 'center' });
            
            doc.fontSize(10)
                .font('Helvetica')
                .text('123 Logistics Avenue, Business District', { align: 'center' })
                .text('Tel: +1 234 567 8900 | Email: billing@cargologistics.com', { align: 'center' })
                .moveDown();
            
            // Invoice Title
            doc.fontSize(16)
                .font('Helvetica-Bold')
                .text('INVOICE', { align: 'center' })
                .moveDown();
            
            // Invoice Details
            doc.fontSize(10)
                .font('Helvetica')
                .text(`Invoice Number: ${invoiceNumber}`, { align: 'right' })
                .text(`Date: ${new Date().toLocaleDateString()}`, { align: 'right' })
                .text(`Due Date: ${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString()}`, { align: 'right' })
                .moveDown();
            
            // Bill To
            doc.font('Helvetica-Bold')
                .text('BILL TO:', { underline: true })
                .font('Helvetica');
            
            doc.text(shipment.sender?.name || 'N/A')
                .text(shipment.sender?.companyName || '')
                .text(shipment.sender?.email || '')
                .text(shipment.sender?.phone || '')
                .text(shipment.sender?.address || '')
                .moveDown();
            
            // Ship To (Receiver)
            doc.font('Helvetica-Bold')
                .text('SHIP TO:', { underline: true })
                .font('Helvetica');
            
            doc.text(shipment.receiver?.name || 'N/A')
                .text(shipment.receiver?.companyName || '')
                .text(shipment.receiver?.email || '')
                .text(shipment.receiver?.phone || '')
                .text(shipment.receiver?.address || '')
                .moveDown();
            
            // Shipment Details
            doc.font('Helvetica-Bold')
                .text('SHIPMENT DETAILS:', { underline: true })
                .moveDown(0.5);
            
            doc.font('Helvetica')
                .text(`Shipment Number: ${shipment.shipmentNumber}`)
                .text(`Tracking Number: ${shipment.trackingNumber}`)
                .text(`Service Type: ${shipment.serviceType}`)
                .text(`Origin: ${shipment.shipmentDetails?.origin || 'N/A'}`)
                .text(`Destination: ${shipment.shipmentDetails?.destination || 'N/A'}`)
                .moveDown();
            
            // Package Details Table Header
            const tableTop = doc.y;
            doc.font('Helvetica-Bold');
            doc.text('Description', 50, tableTop);
            doc.text('Qty', 250, tableTop);
            doc.text('Weight (kg)', 320, tableTop);
            doc.text('Unit Price', 400, tableTop);
            doc.text('Total', 470, tableTop);
            
            doc.moveDown();
            doc.font('Helvetica');
            
            let currentY = doc.y;
            let subtotal = 0;
            
            // Package Details Rows
            const packages = shipment.shipmentDetails?.packageDetails || [];
            packages.forEach((pkg, index) => {
                const description = pkg.description || 'Package';
                const quantity = pkg.quantity || 1;
                const weight = pkg.weight || 0;
                const unitPrice = shipment.quotedPrice?.amount / (packages.reduce((sum, p) => sum + (p.quantity || 1), 0) || 1);
                const total = unitPrice * quantity;
                subtotal += total;
                
                doc.text(description, 50, currentY);
                doc.text(quantity.toString(), 250, currentY);
                doc.text(weight.toString(), 320, currentY);
                doc.text(`${shipment.quotedPrice?.currency || 'USD'} ${unitPrice.toFixed(2)}`, 400, currentY);
                doc.text(`${shipment.quotedPrice?.currency || 'USD'} ${total.toFixed(2)}`, 470, currentY);
                
                currentY += 20;
                
                if (currentY > 700) {
                    doc.addPage();
                    currentY = 50;
                }
            });
            
            // Summary
            const summaryY = Math.max(currentY + 20, tableTop + 100);
            doc.moveTo(50, summaryY)
                .lineTo(550, summaryY)
                .stroke();
            
            const tax = subtotal * 0.10; // 10% tax
            const total = subtotal + tax;
            
            doc.font('Helvetica')
                .text(`Subtotal:`, 400, summaryY + 10)
                .text(`${shipment.quotedPrice?.currency || 'USD'} ${subtotal.toFixed(2)}`, 470, summaryY + 10)
                .text(`Tax (10%):`, 400, summaryY + 30)
                .text(`${shipment.quotedPrice?.currency || 'USD'} ${tax.toFixed(2)}`, 470, summaryY + 30)
                .font('Helvetica-Bold')
                .text(`Total:`, 400, summaryY + 50)
                .text(`${shipment.quotedPrice?.currency || 'USD'} ${total.toFixed(2)}`, 470, summaryY + 50);
            
            // Footer
            doc.fontSize(8)
                .font('Helvetica')
                .text('Thank you for choosing Cargo Logistics Group!', 50, 750, { align: 'center' })
                .text('Payment is due within 30 days. Please include invoice number with payment.', 50, 765, { align: 'center' });
            
            doc.end();
            
            stream.on('finish', () => {
                resolve({
                    path: filePath,
                    filename: fileName,
                    invoiceNumber
                });
            });
            
            stream.on('error', reject);
            
        } catch (error) {
            reject(error);
        }
    });
};

// Save invoice record to database
const saveInvoiceRecord = async (shipment, invoiceDetails) => {
    // You can create an Invoice model if needed
    // For now, we'll just return the details
    return {
        shipmentId: shipment._id,
        shipmentNumber: shipment.shipmentNumber,
        invoiceNumber: invoiceDetails.invoiceNumber,
        invoiceDate: new Date(),
        amount: shipment.quotedPrice?.amount || 0,
        currency: shipment.quotedPrice?.currency || 'USD',
        status: 'generated',
        pdfPath: invoiceDetails.path,
        customerEmail: shipment.sender?.email,
        customerName: shipment.sender?.name
    };
};

module.exports = {
    generateInvoicePDF,
    saveInvoiceRecord,
    invoicesDir
};