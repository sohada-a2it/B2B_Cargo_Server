const mongoose = require('mongoose');

const manualInvoiceSchema = new mongoose.Schema({
    invoiceNumber: {
        type: String,
        required: true,
        unique: true
    },

    shipmentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'NewShipment'
    },

    shipmentNumber: {
        type: String
    },  

    customerInfo: {
        name: String,
        email: String,
        phone: String,
        companyName: String,
        address: String
    },

    receiverInfo: {
        name: String,
        email: String,
        phone: String,
        address: String
    },

    items: [{
        description: String,
        quantity: Number,
        weight: Number,
        unitPrice: Number,
        totalPrice: Number
    }],

    // ❌ required removed
    subtotal: {
        type: Number,
        default: 0
    },

    tax: {
        type: Number,
        default: 0
    },

    totalAmount: {
        type: Number,
        default: 0
    },

    currency: {
        type: String,
        default: 'USD'
    },

    // ❌ enum restriction removed
    status: {
        type: String,
        default: 'generated'
    },

    pdfPath: String,

    // ❌ required removed
    dueDate: {
        type: Date,
        default: null
    },

    paymentDueDate: Date,
    paymentDate: Date,
    paymentMethod: String,

    notes: String,

    generatedAt: {
        type: Date,
        default: Date.now
    },

    sentAt: Date,
    paidAt: Date,

    // ❌ required removed
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    }

}, {
    timestamps: true
});

// ✅ Overwrite safe
const manualInvoice = mongoose.models.manualInvoice || mongoose.model('manualInvoice', manualInvoiceSchema);

module.exports = manualInvoice;