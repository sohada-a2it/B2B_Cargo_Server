// service/pdfGenerator.js
const PDFDocument = require('pdfkit');

async function generateInvoicePDFBuffer(invoice, companyInfo) {
    return new Promise((resolve, reject) => {
        try {
            console.log('📄 Starting PDF generation for invoice:', invoice.invoiceNumber);
            
            const doc = new PDFDocument({ 
                margin: 50,
                size: 'A4',
                layout: 'portrait'
            });
            
            const buffers = [];
            
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => {
                const pdfBuffer = Buffer.concat(buffers);
                console.log('✅ PDF generated, size:', pdfBuffer.length);
                resolve(pdfBuffer);
            });
            doc.on('error', reject);
            
            // ========== COLOR DEFINITIONS ==========
            const colors = {
                primary: '#2563eb',      // Blue
                secondary: '#1e40af',     // Dark Blue
                accent: '#f59e0b',        // Orange
                success: '#10b981',       // Green
                danger: '#ef4444',        // Red
                text: '#1f2937',          // Dark Gray
                textLight: '#6b7280',     // Light Gray
                border: '#e5e7eb',        // Border Gray
                background: '#f8fafc'     // Light Background
            };
            
            // ========== HEADER SECTION ==========
            // Top bar
            doc.rect(0, 0, doc.page.width, 120)
               .fill(colors.primary);
            
            // Company Logo Area
            doc.fillColor('white')
               .fontSize(24)
               .font('Helvetica-Bold')
               .text(companyInfo?.name || 'Cargo Logistics', 50, 40);
            
            doc.fontSize(10)
               .font('Helvetica')
               .text(companyInfo?.address || '123 Business Avenue, Commercial Area', 50, 70)
               .text(companyInfo?.city || 'Dhaka, Bangladesh 1212', 50, 85)
               .text(`Phone: ${companyInfo?.phone || '+880 1234-567890'}`, 50, 100)
               .text(`Email: ${companyInfo?.email || 'info@cargologistics.com'}`, 50, 115);
            
            // INVOICE Badge
            doc.fillColor(colors.accent)
               .rect(doc.page.width - 180, 40, 130, 50)
               .fill();
            
            doc.fillColor('white')
               .fontSize(18)
               .font('Helvetica-Bold')
               .text('INVOICE', doc.page.width - 175, 55);
            
            // ========== INVOICE INFO SECTION ==========
            let y = 150;
            
            // Info boxes background
            doc.fillColor(colors.background)
               .rect(50, y, 200, 80)
               .fill();
            
            doc.fillColor(colors.secondary)
               .rect(270, y, 270, 80)
               .fill();
            
            // Left Box
            doc.fillColor(colors.text)
               .fontSize(9)
               .font('Helvetica-Bold')
               .text('INVOICE NUMBER', 60, y + 15);
            doc.fillColor(colors.primary)
               .fontSize(12)
               .font('Helvetica-Bold')
               .text(invoice.invoiceNumber || 'N/A', 60, y + 35);
            
            doc.fillColor(colors.text)
               .fontSize(9)
               .font('Helvetica-Bold')
               .text('INVOICE DATE', 60, y + 55);
            doc.fillColor(colors.text)
               .fontSize(10)
               .font('Helvetica')
               .text(new Date(invoice.invoiceDate).toLocaleDateString('en-US', {
                   year: 'numeric',
                   month: 'long',
                   day: 'numeric'
               }), 60, y + 72);
            
            // Right Box
            doc.fillColor('white')
               .fontSize(9)
               .font('Helvetica-Bold')
               .text('DUE DATE', 285, y + 15);
            doc.fillColor('white')
               .fontSize(12)
               .font('Helvetica-Bold')
               .text(new Date(invoice.dueDate).toLocaleDateString('en-US', {
                   year: 'numeric',
                   month: 'long',
                   day: 'numeric'
               }), 285, y + 35);
            
            doc.fillColor('white')
               .fontSize(9)
               .font('Helvetica-Bold')
               .text('PAYMENT STATUS', 285, y + 55);
            
            // Payment Status Badge
            const statusColor = invoice.paymentStatus === 'paid' ? colors.success : 
                               invoice.paymentStatus === 'overdue' ? colors.danger : colors.accent;
            
            doc.fillColor(statusColor)
               .roundedRect(285, y + 70, 80, 18, 5)
               .fill();
            
            doc.fillColor('white')
               .fontSize(9)
               .font('Helvetica-Bold')
               .text((invoice.paymentStatus || 'pending').toUpperCase(), 325, y + 73, { align: 'center' });
            
            y += 110;
            
            // ========== BILL TO SECTION ==========
            doc.fillColor(colors.secondary)
               .fontSize(12)
               .font('Helvetica-Bold')
               .text('BILL TO', 50, y);
            
            doc.moveTo(50, y + 5)
               .lineTo(doc.page.width - 50, y + 5)
               .stroke(colors.border);
            
            y += 20;
            
            // Customer Info Box
            doc.fillColor(colors.background)
               .roundedRect(50, y, 495, 80, 8)
               .fill();
            
            doc.fillColor(colors.text)
               .fontSize(11)
               .font('Helvetica-Bold')
               .text(invoice.customerInfo?.contactPerson || 'Customer Name', 65, y + 15);
            
            doc.fontSize(9)
               .font('Helvetica')
               .text(invoice.customerInfo?.companyName || '', 65, y + 35)
               .text(invoice.customerInfo?.email || '', 65, y + 50)
               .text(invoice.customerInfo?.phone || '', 65, y + 65);
            
            y += 110;
            
            // ========== CHARGES TABLE ==========
            doc.fillColor(colors.secondary)
               .fontSize(12)
               .font('Helvetica-Bold')
               .text('CHARGES BREAKDOWN', 50, y);
            
            doc.moveTo(50, y + 5)
               .lineTo(doc.page.width - 50, y + 5)
               .stroke(colors.border);
            
            y += 20;
            
            // Table Header
            doc.fillColor(colors.primary)
               .rect(50, y, 495, 25)
               .fill();
            
            doc.fillColor('white')
               .fontSize(9)
               .font('Helvetica-Bold')
               .text('DESCRIPTION', 60, y + 8)
               .text('TYPE', 260, y + 8)
               .text('AMOUNT', doc.page.width - 100, y + 8, { align: 'right' });
            
            y += 25;
            
            // Table Rows
            let totalAmount = 0;
            let rowColor = true;
            
            if (invoice.charges && invoice.charges.length > 0) {
                for (const charge of invoice.charges) {
                    const amount = charge.amount || 0;
                    totalAmount += amount;
                    
                    // Alternate row colors
                    if (rowColor) {
                        doc.fillColor(colors.background)
                           .rect(50, y, 495, 22)
                           .fill();
                    }
                    
                    doc.fillColor(colors.text)
                       .fontSize(9)
                       .font('Helvetica')
                       .text(charge.description || '-', 60, y + 6)
                       .text(charge.type || '-', 260, y + 6)
                       .text(`${amount.toLocaleString()} ${charge.currency || invoice.currency || 'USD'}`, 
                             doc.page.width - 100, y + 6, { align: 'right' });
                    
                    y += 22;
                    rowColor = !rowColor;
                    
                    // Page break if needed
                    if (y > 650) {
                        doc.addPage();
                        y = 50;
                    }
                }
            } else {
                doc.fillColor(colors.textLight)
                   .fontSize(9)
                   .text('No charges available', 60, y + 6);
                y += 22;
            }
            
            // ========== SUMMARY SECTION ==========
            y += 10;
            
            // Summary Box
            doc.fillColor(colors.background)
               .roundedRect(doc.page.width - 220, y, 170, 100, 8)
               .fill();
            
            let summaryY = y + 15;
            
            doc.fillColor(colors.text)
               .fontSize(9)
               .font('Helvetica-Bold')
               .text('SUBTOTAL', doc.page.width - 210, summaryY);
            doc.fillColor(colors.text)
               .fontSize(10)
               .font('Helvetica-Bold')
               .text(`${(invoice.subtotal || totalAmount).toLocaleString()} ${invoice.currency || 'USD'}`, 
                     doc.page.width - 80, summaryY, { align: 'right' });
            
            summaryY += 22;
            
            if (invoice.discountAmount > 0) {
                doc.fillColor(colors.text)
                   .fontSize(9)
                   .font('Helvetica')
                   .text('DISCOUNT', doc.page.width - 210, summaryY);
                doc.fillColor(colors.success)
                   .fontSize(10)
                   .font('Helvetica-Bold')
                   .text(`-${invoice.discountAmount.toLocaleString()} ${invoice.currency || 'USD'}`, 
                         doc.page.width - 80, summaryY, { align: 'right' });
                summaryY += 22;
            }
            
            if (invoice.taxAmount > 0) {
                doc.fillColor(colors.text)
                   .fontSize(9)
                   .font('Helvetica')
                   .text('TAX', doc.page.width - 210, summaryY);
                doc.fillColor(colors.text)
                   .fontSize(10)
                   .font('Helvetica')
                   .text(`${invoice.taxAmount.toLocaleString()} ${invoice.currency || 'USD'}`, 
                         doc.page.width - 80, summaryY, { align: 'right' });
                summaryY += 22;
            }
            
            // Divider
            doc.moveTo(doc.page.width - 220, summaryY)
               .lineTo(doc.page.width - 50, summaryY)
               .stroke(colors.border);
            
            summaryY += 15;
            
            // Total Amount
            doc.fillColor(colors.secondary)
               .fontSize(12)
               .font('Helvetica-Bold')
               .text('TOTAL', doc.page.width - 210, summaryY);
            doc.fillColor(colors.primary)
               .fontSize(16)
               .font('Helvetica-Bold')
               .text(`${(invoice.totalAmount || totalAmount).toLocaleString()} ${invoice.currency || 'USD'}`, 
                     doc.page.width - 80, summaryY, { align: 'right' });
            
            // ========== FOOTER SECTION ==========
            const footerY = doc.page.height - 100;
            
            // Footer border
            doc.moveTo(50, footerY)
               .lineTo(doc.page.width - 50, footerY)
               .stroke(colors.border);
            
            // Payment Terms
            doc.fillColor(colors.textLight)
               .fontSize(8)
               .font('Helvetica')
               .text(invoice.paymentTerms || 'Due within 30 days', 50, footerY + 10);
            
            // Terms & Conditions
            if (invoice.termsAndConditions) {
                doc.text(invoice.termsAndConditions, 50, footerY + 25, {
                    width: 400,
                    align: 'left'
                });
            }
            
            // Thank you message
            doc.fillColor(colors.primary)
               .fontSize(10)
               .font('Helvetica-Bold')
               .text('Thank you for your business!', 50, footerY + 55);
            
            // Page number
            doc.fillColor(colors.textLight)
               .fontSize(8)
               .font('Helvetica')
               .text(`Page 1 of 1`, doc.page.width - 100, footerY + 55, { align: 'right' });
            
            doc.end();
            
        } catch (error) {
            console.error('❌ PDF generation error:', error);
            reject(error);
        }
    });
}

module.exports = { generateInvoicePDFBuffer };