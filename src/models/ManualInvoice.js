const mongoose = require('mongoose');

const manualInvoiceSchema = new mongoose.Schema({
    // ✅ এই লাইনটি যোগ করুন (পুরনো manualInvoiceNumber এর জন্য)
    manualInvoiceNumber: {
        type: String,
        unique: true,
        sparse: true,  // null ভ্যালু উপেক্ষা করবে
        default: null
    },
    
    // পুরনো invoiceNumber রাখুন (ব্যাকওয়ার্ড কম্প্যাটিবিলিটির জন্য)
    invoiceNumber: {
        type: String,
        unique: true,
        sparse: true
    },
 invoiceDate: {
        type: Date,
        default: Date.now  // জেনারেট হওয়ার সময় অটোমেটিক সেট হবে
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

    status: {
        type: String,
        default: 'generated'
    },

    pdfPath: String,

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

    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    }

}, {
    timestamps: true
});

// ✅ সঠিক ইনডেক্স তৈরি করুন (sparse true সহ)
manualInvoiceSchema.index({ manualInvoiceNumber: 1 }, { unique: true, sparse: true });
manualInvoiceSchema.index({ invoiceNumber: 1 }, { unique: true, sparse: true });

const manualInvoice = mongoose.models.manualInvoice || mongoose.model('manualInvoice', manualInvoiceSchema);

module.exports = manualInvoice;