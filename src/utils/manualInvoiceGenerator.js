// utils/invoiceGenerator.js - SINGLE FILE FOR BOTH VERECL & RENDER
const PDFDocument = require('pdfkit');
const Invoice = require('../models/ManualInvoice');

// ========== ENVIRONMENT DETECTION ==========
const isVercel = process.env.VERCEL === '1';
const isRender = process.env.RENDER === 'true';

console.log(`✅ Running on: ${isVercel ? 'Vercel' : isRender ? 'Render' : 'Local'}`);

// ========== IN-MEMORY STORAGE FOR VERECL ==========
const pdfStorage = new Map();

// ========== UTILITY FUNCTIONS ==========
const generateInvoiceNumber = async () => {
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const count = await Invoice.countDocuments();
    const sequence = String(count + 1).padStart(6, '0');
    return `INV-${year}${month}-${sequence}`;
};

const formatCurrency = (amount, currency = 'USD') => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency,
        minimumFractionDigits: 2
    }).format(amount || 0);
};

const formatDate = (date) => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
};

// ========== PDF GENERATION (Universal) ==========
const generateInvoicePDF = async (invoice, shipment) => {
    return new Promise((resolve, reject) => {
        try {
            const filename = `${invoice.invoiceNumber}.pdf`;
            const doc = new PDFDocument({ margin: 50, size: 'A4' });
            
            const chunks = [];
            doc.on('data', (chunk) => chunks.push(chunk));
            
            // ===== HEADER =====
            doc.rect(0, 0, doc.page.width, 120).fill('#1a1a2e');
            doc.fillColor('#ffffff');
            doc.fontSize(24).font('Helvetica-Bold').text('CARGO LOGISTICS', 50, 40);
            doc.fontSize(9).font('Helvetica').text('Global Shipping & Logistics Solutions', 50, 70);
            doc.fontSize(8).text('8825 STANFORD BLVD, SUITE 306, COLUMBIA, MD 21045, USA', 50, 90);
            doc.text('Phone: +1-647-362-7735 | Email: info@cargologisticscompany.com', 50, 105);
            
            doc.rect(doc.page.width - 180, 40, 130, 70).fill('#E67E22');
            doc.fillColor('#ffffff');
            doc.fontSize(16).font('Helvetica-Bold').text('INVOICE', doc.page.width - 170, 55);
            doc.fontSize(8).font('Helvetica').text(`Number: ${invoice.invoiceNumber}`, doc.page.width - 170, 78);
            doc.text(`Date: ${formatDate(invoice.generatedAt)}`, doc.page.width - 170, 93);
            doc.fillColor('#333333');

            // ===== SHIPMENT & BILLING INFO =====
            let yPos = 150;
            doc.rect(50, yPos, 250, 75).fill('#f8f9fa');
            doc.rect(310, yPos, 240, 75).fill('#f8f9fa');
            
            doc.fillColor('#E67E22');
            doc.fontSize(9).font('Helvetica-Bold').text('SHIPMENT DETAILS', 60, yPos + 10);
            doc.fillColor('#333333');
            doc.fontSize(8).font('Helvetica');
            doc.text(`Shipment: ${invoice.shipmentNumber}`, 60, yPos + 28);
            doc.text(`Tracking: ${shipment?.trackingNumber || 'N/A'}`, 60, yPos + 43);
            doc.text(`Service: ${shipment?.serviceType || 'Standard'}`, 60, yPos + 58);
            
            doc.fillColor('#E67E22');
            doc.text('BILLING INFO', 320, yPos + 10);
            doc.fillColor('#333333');
            doc.text(`Status: ${invoice.status.toUpperCase()}`, 320, yPos + 28);
            doc.text(`Due: ${formatDate(invoice.paymentDueDate)}`, 320, yPos + 43);
            doc.text(`Currency: ${invoice.currency}`, 320, yPos + 58);
            
            yPos += 95;
            
            // ===== SENDER & RECEIVER =====
            doc.rect(50, yPos, 250, 110).fill('#f8f9fa');
            doc.rect(310, yPos, 240, 110).fill('#f8f9fa');
            
            doc.fillColor('#E67E22');
            doc.fontSize(9).font('Helvetica-Bold').text('SENDER', 60, yPos + 10);
            doc.fillColor('#333333');
            doc.fontSize(8).font('Helvetica');
            doc.text(invoice.customerInfo?.name || 'N/A', 60, yPos + 28);
            if (invoice.customerInfo?.companyName) {
                doc.text(invoice.customerInfo.companyName, 60, yPos + 43);
            }
            doc.text(invoice.customerInfo?.email || 'N/A', 60, yPos + 58);
            doc.text(invoice.customerInfo?.phone || 'N/A', 60, yPos + 73);
            if (invoice.customerInfo?.address) {
                doc.text(invoice.customerInfo.address, 60, yPos + 88);
            }
            
            doc.fillColor('#E67E22');
            doc.text('RECEIVER', 320, yPos + 10);
            doc.fillColor('#333333');
            doc.text(invoice.receiverInfo?.name || 'N/A', 320, yPos + 28);
            if (invoice.receiverInfo?.companyName) {
                doc.text(invoice.receiverInfo.companyName, 320, yPos + 43);
            }
            doc.text(invoice.receiverInfo?.email || 'N/A', 320, yPos + 58);
            doc.text(invoice.receiverInfo?.phone || 'N/A', 320, yPos + 73);
            if (invoice.receiverInfo?.address) {
                doc.text(invoice.receiverInfo.address, 320, yPos + 88);
            }
            
            yPos += 130;
            
            // ===== ROUTE =====
            doc.rect(50, yPos, 500, 45).fill('#f0fdf4');
            doc.fillColor('#166534');
            doc.fontSize(8).font('Helvetica');
            doc.text('📍 ROUTE', 60, yPos + 8);
            doc.fontSize(9).font('Helvetica-Bold');
            doc.text(`${shipment?.shipmentDetails?.origin || 'N/A'}`, 60, yPos + 22);
            doc.fontSize(10).text('→', 250, yPos + 20);
            doc.text(`${shipment?.shipmentDetails?.destination || 'N/A'}`, 280, yPos + 22);
            
            yPos += 65;
            
            // ===== ITEMS TABLE =====
            const tableTop = yPos;
            const headers = ['Description', 'Qty', 'Weight', 'Unit Price', 'Total'];
            const widths = [200, 45, 65, 85, 85];
            
            doc.rect(50, tableTop, 500, 28).fill('#E67E22');
            doc.fillColor('#ffffff');
            doc.fontSize(8).font('Helvetica-Bold');
            
            let x = 55;
            headers.forEach((header, i) => {
                doc.text(header, x, tableTop + 8);
                x += widths[i];
            });
            
            doc.fillColor('#333333');
            doc.fontSize(8).font('Helvetica');
            
            let rowY = tableTop + 28;
            let totalAmount = 0;
            
            invoice.items.forEach((item, idx) => {
                if (rowY > doc.page.height - 120) {
                    doc.addPage();
                    rowY = 50;
                }
                
                if (idx % 2 === 0) {
                    doc.rect(50, rowY, 500, 22).fill('#f9fafb');
                }
                
                x = 55;
                doc.text(item.description?.substring(0, 35) || 'N/A', x, rowY + 5);
                x += widths[0];
                doc.text(item.quantity.toString(), x, rowY + 5);
                x += widths[1];
                doc.text(`${item.weight}kg`, x, rowY + 5);
                x += widths[2];
                doc.text(formatCurrency(item.unitPrice, invoice.currency), x, rowY + 5);
                x += widths[3];
                const itemTotal = item.unitPrice * (item.quantity || 1);
                totalAmount += itemTotal;
                doc.text(formatCurrency(itemTotal, invoice.currency), x, rowY + 5);
                
                rowY += 22;
            });
            
            // ===== SUMMARY =====
            const summaryY = rowY + 15;
            doc.rect(350, summaryY, 200, 90).fill('#f8f9fa');
            
            doc.fillColor('#333333');
            doc.fontSize(8);
            doc.text('SUMMARY', 360, summaryY + 8);
            doc.text('─' * 25, 360, summaryY + 16);
            
            doc.text('Subtotal:', 360, summaryY + 32);
            doc.text(formatCurrency(invoice.subtotal, invoice.currency), 520, summaryY + 32, { align: 'right' });
            
            doc.text('Tax (10%):', 360, summaryY + 48);
            doc.text(formatCurrency(invoice.tax, invoice.currency), 520, summaryY + 48, { align: 'right' });
            
            doc.fontSize(9).font('Helvetica-Bold');
            doc.text('TOTAL:', 360, summaryY + 68);
            doc.text(formatCurrency(invoice.totalAmount, invoice.currency), 520, summaryY + 68, { align: 'right' });
            
            // ===== NOTES =====
            if (invoice.notes) {
                const notesY = summaryY + 110;
                if (notesY < doc.page.height - 80) {
                    doc.rect(50, notesY, 500, 50).fill('#fef3c7');
                    doc.fillColor('#92400e');
                    doc.fontSize(8).font('Helvetica-Bold');
                    doc.text('📝 NOTES', 60, notesY + 8);
                    doc.fontSize(7).font('Helvetica');
                    doc.text(invoice.notes, 60, notesY + 22);
                }
            }
            
            // ===== FOOTER =====
            const footerY = doc.page.height - 65;
            doc.rect(0, footerY, doc.page.width, 65).fill('#1a1a2e');
            doc.fillColor('#ffffff');
            doc.fontSize(7).font('Helvetica');
            doc.text('Thank you for choosing Cargo Logistics Group!', 50, footerY + 15, { align: 'center' });
            doc.text('This is a computer generated invoice. No signature required.', 50, footerY + 30, { align: 'center' });
            doc.text(`© ${new Date().getFullYear()} Cargo Logistics Group. All rights reserved.`, 50, footerY + 45, { align: 'center' });
            
            doc.end();
            
            doc.on('end', () => {
                const pdfBuffer = Buffer.concat(chunks);
                
                // Store in memory (for both platforms)
                const pdfId = `${invoice.invoiceNumber}_${Date.now()}`;
                pdfStorage.set(pdfId, pdfBuffer);
                
                // Auto cleanup after 1 hour
                setTimeout(() => pdfStorage.delete(pdfId), 3600000);
                
                resolve({
                    filename,
                    buffer: pdfBuffer,
                    storageId: pdfId
                });
            });
            
            doc.on('error', reject);
            
        } catch (error) {
            reject(error);
        }
    });
};

// ========== MAIN FUNCTION ==========
const generateInvoiceFromShipment = async (shipment) => {
    try {
        console.log(`📄 Generating invoice for: ${shipment.shipmentNumber}`);
        
        const quotedAmount = shipment.quotedPrice?.amount || 0;
        const tax = quotedAmount * 0.10;
        const totalAmount = quotedAmount + tax;

        const items = [{
            description: `${shipment.shipmentClassification?.mainType || 'Freight'} service - ${shipment.shipmentDetails?.origin || 'Origin'} to ${shipment.shipmentDetails?.destination || 'Destination'}`,
            quantity: 1,
            weight: shipment.shipmentDetails?.totalWeight || 0,
            unitPrice: quotedAmount,
            totalPrice: quotedAmount
        }];

        const invoiceNumber = await generateInvoiceNumber();

        const invoice = await Invoice.create({
            invoiceNumber,
            shipmentId: shipment._id,
            shipmentNumber: shipment.shipmentNumber,
            customerId: shipment.customerId || null,
            customerInfo: {
                name: shipment.customerInfo?.name || shipment.sender?.name,
                email: shipment.customerInfo?.email || shipment.sender?.email,
                phone: shipment.customerInfo?.phone || shipment.sender?.phone,
                companyName: shipment.customerInfo?.companyName || shipment.sender?.companyName,
                address: shipment.sender?.address?.addressLine1 || ''
            },
            receiverInfo: {
                name: shipment.receiver?.name || '',
                email: shipment.receiver?.email || '',
                phone: shipment.receiver?.phone || '',
                companyName: shipment.receiver?.companyName || '',
                address: shipment.receiver?.address?.addressLine1 || ''
            },
            items: items,
            subtotal: quotedAmount,
            tax: tax,
            totalAmount: totalAmount,
            currency: shipment.quotedPrice?.currency || 'USD',
            status: 'generated',
            paymentDueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            notes: shipment.shipmentDetails?.specialInstructions || '',
            generatedAt: new Date()
        });

        console.log(`✅ Invoice created: ${invoiceNumber}`);
        
        const pdfInfo = await generateInvoicePDF(invoice, shipment);
        
        await Invoice.findByIdAndUpdate(invoice._id, {
            pdfFilename: pdfInfo.filename,
            pdfStorageId: pdfInfo.storageId  // Store ID for retrieval
        });
        
        console.log(`✅ PDF generated: ${pdfInfo.filename}`);
        
        return {
            invoice,
            pdfBuffer: pdfInfo.buffer,
            pdfFilename: pdfInfo.filename,
            storageId: pdfInfo.storageId
        };
        
    } catch (error) {
        console.error('❌ Error:', error);
        return null;
    }
};

// ========== GET PDF BUFFER ==========
const getPdfBuffer = (storageId) => {
    return pdfStorage.get(storageId);
};

module.exports = { 
    generateInvoiceFromShipment, 
    generateInvoiceNumber,
    getPdfBuffer
};