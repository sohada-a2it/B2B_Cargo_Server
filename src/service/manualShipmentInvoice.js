const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// Ensure invoices directory exists
const invoicesDir = path.join(__dirname, '../invoices');
if (!fs.existsSync(invoicesDir)) {
    fs.mkdirSync(invoicesDir, { recursive: true });
}

// Professional color scheme - Modern & Elegant
const COLORS = {
    primary: '#1e3c72',
    secondary: '#2a5298',
    accent: '#e67e22',
    gold: '#f39c12',
    border: '#e8ecf1',
    text: '#2c3e50',
    textLight: '#7f8c8d',
    header: '#f8f9fa',
    success: '#27ae60',
    bgLight: '#ffffff'
};

// Format currency
const formatCurrency = (amount, currency = 'USD') => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency,
        minimumFractionDigits: 2
    }).format(amount);
};

// Format date
const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
};

// Generate PDF invoice - Professional design strictly in 1 page
const generateInvoicePDF = async (shipment) => {
    return new Promise((resolve, reject) => {
        try {
            const invoiceNumber = `INV-${shipment.shipmentNumber || `SHP-${Date.now()}`}`;
            const fileName = `${invoiceNumber}.pdf`;
            const filePath = path.join(invoicesDir, fileName);
            
            // Optimized margins for better space utilization
            const doc = new PDFDocument({ 
                margin: 35,
                size: 'A4',
                layout: 'portrait',
                info: {
                    Title: `Invoice ${invoiceNumber}`,
                    Author: 'Cargo Logistics Group'
                }
            });
            
            const stream = fs.createWriteStream(filePath);
            doc.pipe(stream);
            
            let yPosition = doc.y;
            
            // ========== HEADER SECTION ==========
            // Top decorative line
            doc.rect(35, yPosition, 540, 3).fill(COLORS.primary);
            yPosition += 10;
            
            // Company Logo Area - Modern design
            doc.rect(35, yPosition, 130, 45).fill(COLORS.primary);
            doc.fillColor('white')
                .fontSize(16)
                .font('Helvetica-Bold')
                .text('CARGO', 50, yPosition + 10)
                .fontSize(9)
                .text('LOGISTICS', 50, yPosition + 28)
                .font('Helvetica')
                .text('GROUP', 50, yPosition + 38);
            
            // Company Info - Right aligned
            doc.fillColor(COLORS.text)
                .fontSize(8)
                .font('Helvetica');
            
            doc.text('Cargo Logistics Group', 450, yPosition + 5, { align: 'right' });
            doc.text('123 Logistics Avenue, Business District', 450, yPosition + 17, { align: 'right' });
            doc.text('Tel: +1 234 567 8900 | Email: billing@cargologistics.com', 450, yPosition + 29, { align: 'right' });
            
            // INVOICE Badge - Modern
            doc.rect(460, yPosition + 38, 115, 28).fill(COLORS.accent);
            doc.fillColor('white')
                .fontSize(12)
                .font('Helvetica-Bold')
                .text('INVOICE', 475, yPosition + 48);
            
            yPosition += 55;
            
            // ========== INVOICE INFO GRID ==========
            // Invoice details card
            doc.rect(35, yPosition, 540, 65).fill(COLORS.header);
            
            // Left column
            doc.fillColor(COLORS.textLight)
                .fontSize(7)
                .font('Helvetica')
                .text('INVOICE NUMBER', 50, yPosition + 10);
            doc.fillColor(COLORS.text)
                .fontSize(9)
                .font('Helvetica-Bold')
                .text(invoiceNumber, 50, yPosition + 22);
            
            doc.fillColor(COLORS.textLight)
                .fontSize(7)
                .font('Helvetica')
                .text('INVOICE DATE', 50, yPosition + 38);
            doc.fillColor(COLORS.text)
                .fontSize(9)
                .font('Helvetica-Bold')
                .text(formatDate(new Date()), 50, yPosition + 50);
            
            // Middle column
            doc.fillColor(COLORS.textLight)
                .fontSize(7)
                .font('Helvetica')
                .text('DUE DATE', 220, yPosition + 10);
            doc.fillColor(COLORS.text)
                .fontSize(9)
                .font('Helvetica-Bold')
                .text(formatDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)), 220, yPosition + 22);
            
            doc.fillColor(COLORS.textLight)
                .fontSize(7)
                .font('Helvetica')
                .text('TRACKING NO.', 220, yPosition + 38);
            doc.fillColor(COLORS.text)
                .fontSize(9)
                .font('Helvetica-Bold')
                .text(shipment.trackingNumber || 'N/A', 220, yPosition + 50);
            
            // Right column - Status badge
            doc.fillColor(COLORS.success)
                .fontSize(9)
                .font('Helvetica-Bold')
                .text('● PAID', 490, yPosition + 35);
            
            doc.fillColor(COLORS.textLight)
                .fontSize(7)
                .font('Helvetica')
                .text('Payment Terms: Net 30', 490, yPosition + 50);
            
            yPosition += 80;
            
            // ========== BILLING & SHIPPING SECTION ==========
            // Bill To Section
            doc.rect(35, yPosition, 260, 85).fill(COLORS.header);
            doc.fillColor(COLORS.primary)
                .fontSize(8)
                .font('Helvetica-Bold')
                .text('BILL TO', 45, yPosition + 8);
            
            doc.fillColor(COLORS.text)
                .fontSize(7)
                .font('Helvetica');
            
            let billY = yPosition + 25;
            doc.text(shipment.sender?.name || 'N/A', 45, billY, { lineGap: 4 });
            billY += 13;
            if (shipment.sender?.companyName) {
                doc.text(shipment.sender.companyName, 45, billY);
                billY += 13;
            }
            doc.text(shipment.sender?.email || 'N/A', 45, billY);
            billY += 13;
            doc.text(shipment.sender?.phone || 'N/A', 45, billY);
            billY += 13;
            const senderAddress = shipment.sender?.address;
            if (senderAddress) {
                const addressLine = `${senderAddress.addressLine1 || ''} ${senderAddress.city || ''} ${senderAddress.state || ''}`.trim();
                const countryLine = senderAddress.country || '';
                if (addressLine) {
                    doc.text(addressLine, 45, billY);
                    billY += 13;
                }
                if (countryLine) {
                    doc.text(countryLine, 45, billY);
                }
            }
            
            // Ship To Section
            doc.rect(310, yPosition, 265, 85).fill(COLORS.header);
            doc.fillColor(COLORS.primary)
                .fontSize(8)
                .font('Helvetica-Bold')
                .text('SHIP TO', 320, yPosition + 8);
            
            doc.fillColor(COLORS.text)
                .fontSize(7)
                .font('Helvetica');
            
            let shipY = yPosition + 25;
            doc.text(shipment.receiver?.name || 'N/A', 320, shipY);
            shipY += 13;
            if (shipment.receiver?.companyName) {
                doc.text(shipment.receiver.companyName, 320, shipY);
                shipY += 13;
            }
            doc.text(shipment.receiver?.email || 'N/A', 320, shipY);
            shipY += 13;
            doc.text(shipment.receiver?.phone || 'N/A', 320, shipY);
            shipY += 13;
            const receiverAddress = shipment.receiver?.address;
            if (receiverAddress) {
                const addressLine = `${receiverAddress.addressLine1 || ''} ${receiverAddress.city || ''} ${receiverAddress.state || ''}`.trim();
                const countryLine = receiverAddress.country || '';
                if (addressLine) {
                    doc.text(addressLine, 320, shipY);
                    shipY += 13;
                }
                if (countryLine) {
                    doc.text(countryLine, 320, shipY);
                }
            }
            
            yPosition += 100;
            
            // ========== SHIPMENT INFO - Compact ==========
            doc.rect(35, yPosition, 540, 45).fill(COLORS.bgLight);
            doc.strokeColor(COLORS.border)
                .lineWidth(0.5)
                .rect(35, yPosition, 540, 45)
                .stroke();
            
            // Shipment details grid
            const infoItems = [
                { label: 'Shipment Number', value: shipment.shipmentNumber || 'N/A', x: 45 },
                { label: 'Service Type', value: shipment.serviceType?.toUpperCase() || 'N/A', x: 220 },
                { label: 'Shipping Mode', value: shipment.shipmentDetails?.shippingMode || 'N/A', x: 395 },
                { label: 'Origin', value: shipment.shipmentDetails?.origin || 'N/A', x: 45, yOffset: 22 },
                { label: 'Destination', value: shipment.shipmentDetails?.destination || 'N/A', x: 220, yOffset: 22 },
                { label: 'Shipment Date', value: formatDate(shipment.createdAt || new Date()), x: 395, yOffset: 22 }
            ];
            
            doc.fillColor(COLORS.textLight)
                .fontSize(6)
                .font('Helvetica');
            
            infoItems.forEach(item => {
                const yPos = yPosition + (item.yOffset || 8);
                doc.text(item.label, item.x, yPos);
                doc.fillColor(COLORS.text)
                    .fontSize(7)
                    .font('Helvetica-Bold')
                    .text(item.value, item.x, yPos + 9);
                doc.fillColor(COLORS.textLight)
                    .fontSize(6)
                    .font('Helvetica');
            });
            
            yPosition += 55;
            
            // ========== PACKAGE DETAILS TABLE ==========
            doc.fillColor(COLORS.primary)
                .fontSize(9)
                .font('Helvetica-Bold')
                .text('PACKAGE DETAILS', 35, yPosition);
            
            yPosition += 12;
            
            // Table Header
            const tableX = 35;
            const tableWidths = {
                description: 210,
                qty: 45,
                weight: 65,
                unitPrice: 90,
                total: 90
            };
            
            let currentX = tableX;
            
            // Header background
            doc.rect(tableX, yPosition, 540, 22).fill(COLORS.primary);
            
            // Header texts
            doc.fillColor('white')
                .fontSize(7)
                .font('Helvetica-Bold');
            
            doc.text('DESCRIPTION', currentX + 8, yPosition + 7);
            currentX += tableWidths.description;
            
            doc.text('QTY', currentX + 15, yPosition + 7, { align: 'center' });
            currentX += tableWidths.qty;
            
            doc.text('WEIGHT', currentX + 12, yPosition + 7, { align: 'center' });
            currentX += tableWidths.weight;
            
            doc.text('UNIT PRICE', currentX + 10, yPosition + 7, { align: 'right' });
            currentX += tableWidths.unitPrice;
            
            doc.text('TOTAL', currentX + 10, yPosition + 7, { align: 'right' });
            
            yPosition += 22;
            
            // Table Rows
            const packages = shipment.shipmentDetails?.packageDetails || [];
            const totalQty = packages.reduce((sum, pkg) => sum + (pkg.quantity || 1), 0);
            const subtotal = shipment.quotedPrice?.amount || 0;
            const unitPrice = totalQty > 0 ? subtotal / totalQty : 0;
            
            let rowCount = 0;
            const maxRows = 4; // Limit to 4 rows to ensure single page
            
            packages.slice(0, maxRows).forEach((pkg, index) => {
                if (rowCount >= maxRows) return;
                
                const description = pkg.description || 'Package';
                const quantity = pkg.quantity || 1;
                const weight = pkg.weight || 0;
                const total = unitPrice * quantity;
                
                // Alternate row background
                if (rowCount % 2 === 0) {
                    doc.rect(tableX, yPosition - 2, 540, 18).fill(COLORS.header);
                }
                
                currentX = tableX;
                
                doc.fillColor(COLORS.text)
                    .fontSize(7)
                    .font('Helvetica')
                    .text(description.substring(0, 35), currentX + 5, yPosition, { width: tableWidths.description - 10 });
                currentX += tableWidths.description;
                
                doc.text(quantity.toString(), currentX + 15, yPosition, { align: 'center', width: tableWidths.qty - 10 });
                currentX += tableWidths.qty;
                
                doc.text(weight.toFixed(1), currentX + 15, yPosition, { align: 'center', width: tableWidths.weight - 10 });
                currentX += tableWidths.weight;
                
                doc.text(formatCurrency(unitPrice, shipment.quotedPrice?.currency), currentX + 10, yPosition, { align: 'right', width: tableWidths.unitPrice - 10 });
                currentX += tableWidths.unitPrice;
                
                doc.text(formatCurrency(total, shipment.quotedPrice?.currency), currentX + 10, yPosition, { align: 'right', width: tableWidths.total - 10 });
                
                yPosition += 16;
                rowCount++;
            });
            
            // If no packages, show one row
            if (packages.length === 0) {
                doc.rect(tableX, yPosition - 2, 540, 18).fill(COLORS.header);
                doc.fillColor(COLORS.textLight)
                    .fontSize(7)
                    .font('Helvetica')
                    .text('No package details available', tableX + 5, yPosition, { width: 530, align: 'center' });
                yPosition += 18;
            }
            
            yPosition += 8;
            
            // ========== SUMMARY SECTION ==========
            const tax = subtotal * 0.10;
            const total = subtotal + tax;
            
            // Summary Box - Positioned strategically
            const summaryX = 380;
            const summaryY = yPosition;
            
            doc.rect(summaryX, summaryY, 195, 75).fill(COLORS.header);
            doc.strokeColor(COLORS.border)
                .lineWidth(0.5)
                .rect(summaryX, summaryY, 195, 75)
                .stroke();
            
            doc.fillColor(COLORS.text)
                .fontSize(7)
                .font('Helvetica');
            
            doc.text('Subtotal:', summaryX + 15, summaryY + 12);
            doc.text(formatCurrency(subtotal, shipment.quotedPrice?.currency), summaryX + 175, summaryY + 12, { align: 'right' });
            
            doc.text('Tax (10%):', summaryX + 15, summaryY + 30);
            doc.text(formatCurrency(tax, shipment.quotedPrice?.currency), summaryX + 175, summaryY + 30, { align: 'right' });
            
            // Total line
            doc.strokeColor(COLORS.gold)
                .lineWidth(1)
                .moveTo(summaryX + 10, summaryY + 46)
                .lineTo(summaryX + 185, summaryY + 46)
                .stroke();
            
            doc.fillColor(COLORS.primary)
                .fontSize(10)
                .font('Helvetica-Bold')
                .text('TOTAL AMOUNT:', summaryX + 15, summaryY + 54);
            doc.fillColor(COLORS.accent)
                .fontSize(11)
                .font('Helvetica-Bold')
                .text(formatCurrency(total, shipment.quotedPrice?.currency), summaryX + 175, summaryY + 54, { align: 'right' });
            
            yPosition += 85;
            
            // ========== FOOTER SECTION ==========
            // Ensure everything fits on one page (max Y = 780)
            if (yPosition <= 740) {
                // Decorative line
                doc.strokeColor(COLORS.border)
                    .lineWidth(0.5)
                    .moveTo(35, yPosition)
                    .lineTo(575, yPosition)
                    .stroke();
                
                yPosition += 10;
                
                // Payment Instructions - 2 columns
                doc.fillColor(COLORS.textLight)
                    .fontSize(6)
                    .font('Helvetica-Bold')
                    .text('PAYMENT INSTRUCTIONS', 35, yPosition);
                
                doc.fillColor(COLORS.textLight)
                    .fontSize(6)
                    .font('Helvetica');
                
                // Left column
                doc.text('Bank: Cargo Logistics Bank', 35, yPosition + 10);
                doc.text('Account: 1234567890', 35, yPosition + 18);
                doc.text('Sort Code: 12-34-56', 35, yPosition + 26);
                
                // Right column
                doc.text('IBAN: GB12CLG1234567890', 300, yPosition + 10);
                doc.text('SWIFT: CLGBGB2L', 300, yPosition + 18);
                doc.text('Reference: ' + invoiceNumber, 300, yPosition + 26);
                
                yPosition += 45;
                
                // Thank You Message
                doc.fillColor(COLORS.accent)
                    .fontSize(8)
                    .font('Helvetica-Bold')
                    .text('✦ Thank you for choosing Cargo Logistics Group! ✦', 35, yPosition, { align: 'center' });
                
                doc.fillColor(COLORS.textLight)
                    .fontSize(6)
                    .font('Helvetica')
                    .text('This is a computer generated invoice. No signature required.', 35, yPosition + 12, { align: 'center' });
            }
            
            doc.end();
            
            stream.on('finish', () => {
                resolve({
                    path: filePath,
                    filename: fileName,
                    invoiceNumber,
                    filePath: filePath
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
        customerName: shipment.sender?.name,
        trackingNumber: shipment.trackingNumber
    };
};

module.exports = {
    generateInvoicePDF,
    saveInvoiceRecord,
    invoicesDir
};