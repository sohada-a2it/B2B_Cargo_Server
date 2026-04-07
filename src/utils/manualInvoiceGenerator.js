// utils/invoiceGenerator.js
const Invoice = require('../models/ManualInvoice');

const generateInvoiceNumber = async () => {
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const count = await Invoice.countDocuments();
    const sequence = String(count + 1).padStart(6, '0');
    return `INV-${year}${month}-${sequence}`;
};

const generateInvoiceFromShipment = async (shipment) => {
    try {
        // Calculate invoice amounts
        const quotedAmount = shipment.quotedPrice?.amount || 0;
        const tax = quotedAmount * 0.10; // 10% tax example
        const totalAmount = quotedAmount + tax;

        // Prepare invoice items
        const items = [];
        
        // Add main freight charge
        items.push({
            description: `Freight charges for ${shipment.shipmentClassification?.mainType || 'shipment'} service`,
            quantity: 1,
            weight: shipment.shipmentDetails?.totalWeight || 0,
            unitPrice: quotedAmount,
            totalPrice: quotedAmount
        });

        // Add package items if available
        if (shipment.shipmentDetails?.packageDetails && shipment.shipmentDetails.packageDetails.length > 0) {
            shipment.shipmentDetails.packageDetails.forEach((pkg, index) => {
                items.push({
                    description: pkg.description || `Package ${index + 1}`,
                    quantity: pkg.quantity || 1,
                    weight: pkg.weight || 0,
                    unitPrice: 0,
                    totalPrice: 0
                });
            });
        }

        // Generate invoice number
        const invoiceNumber = await generateInvoiceNumber();

        // Create invoice
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
                address: shipment.sender?.address || ''
            },
            receiverInfo: {
                name: shipment.receiver?.name || '',
                email: shipment.receiver?.email || '',
                phone: shipment.receiver?.phone || '',
                address: shipment.receiver?.address || ''
            },
            items: items,
            subtotal: quotedAmount,
            tax: tax,
            totalAmount: totalAmount,
            currency: shipment.quotedPrice?.currency || 'USD',
            status: 'generated',
            paymentDueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days due
            notes: shipment.shipmentDetails?.specialInstructions || '',
            generatedAt: new Date()
        });

        console.log(`📄 Invoice generated: ${invoiceNumber} for shipment ${shipment.shipmentNumber}`);
        
        return invoice;
    } catch (error) {
        console.error('❌ Invoice generation error:', error);
        return null;
    }
};

module.exports = { generateInvoiceFromShipment, generateInvoiceNumber };