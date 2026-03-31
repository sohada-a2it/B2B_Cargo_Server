// models/invoiceModel.js - সম্পূর্ণ আপডেটেড ভার্সন (সব সমস্যা সমাধান সহ)

const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema({ 
    
    // Invoice Number - Auto generated (কখনো ডুপ্লিকেট হবে না)
    invoiceNumber: {
    type: String,
    unique: true,
    required: true,
    trim: true,
    default: function() {
        const date = new Date();
        const year = date.getFullYear().toString().slice(-2);
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const timestamp = Date.now().toString().slice(-8);
        const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        const invoiceNum = `INV-${year}${month}-${timestamp}${random}`;
        console.log('📝 Auto-generated invoice number:', invoiceNum);
        return invoiceNum;
    }
},
    
    // References
    bookingId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Booking',
        required: true
    },
    shipmentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Shipment'
    },
    customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    
    // Customer Info (snapshot)
    customerInfo: {
        companyName: String,
        contactPerson: String,
        email: String,
        phone: String,
        address: String,
        vatNumber: String
    },
    
    // Invoice Details
    invoiceDate: {
        type: Date,
        default: Date.now
    },
    dueDate: {
        type: Date,
        required: true
    },
    
    // Charges Breakdown - ✅ সব এনাম ভ্যালু যোগ করা হয়েছে
    charges: [{
        description: {
            type: String,
            required: true
        },
        type: {
            type: String,
            enum: [
                'Freight Cost',
                'Handling Fee',
                'Warehouse Fee',
                'Customs Processing',
                'Documentation Fee',
                'Insurance',
                'Fuel Surcharge',
                'Pickup Fee',
                'Delivery Fee',
                'Weight Charge',           // ✅ যোগ করা হয়েছে
                'Residential Surcharge',   // ✅ যোগ করা হয়েছে
                'Tax',                     // ✅ যোগ করা হয়েছে
                'Base Rate',               // ✅ যোগ করা হয়েছে
                'Other'
            ],
            required: true
        },
        amount: {
            type: Number,
            required: true,
            min: 0
        },
        currency: {
            type: String,
            enum: ['USD', 'GBP', 'CAD', 'THB', 'CNY'],
            default: 'USD'
        },
        notes: String
    }],
    
    // Totals
    subtotal: {
        type: Number,
        required: true,
        default: 0
    },
    taxAmount: {
        type: Number,
        default: 0
    },
    taxRate: {
        type: Number,
        default: 0
    },
    discountAmount: {
        type: Number,
        default: 0
    },
    totalAmount: {
        type: Number,
        required: true,
        default: 0
    },
    currency: {
        type: String,
        enum: ['USD', 'GBP', 'CAD', 'THB', 'CNY'],
        default: 'USD'
    },
    
    // Payment
    paymentStatus: {
        type: String,
        enum: ['pending', 'paid', 'overdue', 'cancelled'],
        default: 'pending'
    },
    paymentMethod: {
        type: String,
        enum: ['Bank Transfer', 'Credit Card', 'Cash', 'Cheque']
    },
    paymentDate: Date,
    paymentReference: String,
    
    // PDF
    pdfUrl: {
        type: String,
        default: ''
    },
    pdfGeneratedAt: {
        type: Date
    },
    pdfSize: {
        type: Number
    },
    
    // Terms
    paymentTerms: {
        type: String,
        default: 'Due within 30 days'
    },
    notes: String,
    termsAndConditions: String,
    
    // Status
    status: {
        type: String,
        enum: ['draft', 'sent', 'paid', 'overdue', 'cancelled'],
        default: 'draft'
    },
    
    // Email tracking
    emailSent: {
        type: Boolean,
        default: false
    },
    emailSentAt: Date,
    emailedTo: [String],
    
    // Audit
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

// ==============================================
// 🔥 সিকোয়েন্স কাউন্টার মডেল (ইউনিক ইনভয়েস নম্বরের জন্য)
// ==============================================
const counterSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 }
});

// কাউন্টার মডেল - একবারই তৈরি হবে
const Counter = mongoose.models.Counter || mongoose.model('Counter', counterSchema);

// ==============================================
// 🔥 ইনভয়েস নম্বর জেনারেট করার ফাংশন
// ==============================================
async function getNextInvoiceNumber() {
    try {
        const date = new Date();
        const year = date.getFullYear().toString().slice(-2);
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const prefix = `INV-${year}${month}`;
        
        // এটমিক অপারেশন - কখনো ডুপ্লিকেট হবে না
        const counter = await Counter.findByIdAndUpdate(
            `invoice_${year}${month}`,
            { $inc: { seq: 1 } },
            { upsert: true, new: true }
        );
        
        // 5 ডিজিটের নাম্বার তৈরি করুন (00001, 00002, ইত্যাদি)
        const sequence = counter.seq.toString().padStart(5, '0');
        const invoiceNumber = `${prefix}-${sequence}`;
        
        console.log(`📝 Generated invoice number: ${invoiceNumber} (Sequence: ${counter.seq})`);
        return invoiceNumber;
    } catch (error) {
        console.error('❌ Invoice number generation error:', error);
        // Fallback
        return `INV-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    }
}

// ==============================================
// 🔥 প্রি-সেভ মিডলওয়্যার (সঠিকভাবে কাজ করবে)
// ==============================================
invoiceSchema.pre('save', async function(next) {
    try {
        console.log('🔧 Pre-save middleware called for invoice');
        console.log('   - isNew:', this.isNew);
        console.log('   - has invoiceNumber:', !!this.invoiceNumber);
        
        // ✅ শুধুমাত্র নতুন ডকুমেন্টের জন্য invoiceNumber জেনারেট করবে
        if (this.isNew && !this.invoiceNumber) {
            this.invoiceNumber = await getNextInvoiceNumber();
            console.log('✅ Invoice number generated:', this.invoiceNumber);
        }
        
        // ✅ চার্জ থাকলে টোটাল ক্যালকুলেট করবে
        if (this.charges && this.charges.length > 0) {
            this.subtotal = this.charges.reduce((sum, charge) => sum + (charge.amount || 0), 0);
            this.totalAmount = this.subtotal - (this.discountAmount || 0) + (this.taxAmount || 0);
            console.log('📊 Totals calculated - Subtotal:', this.subtotal, 'Total:', this.totalAmount);
        }
        
        next();
    } catch (error) {
        console.error('❌ Pre-save middleware error:', error);
        
        // Fallback: timestamp based invoice number
        try {
            this.invoiceNumber = `INV-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
            console.log('🔄 Fallback invoice number generated:', this.invoiceNumber);
            next();
        } catch (fallbackError) {
            next(error);
        }
    }
});

// ==============================================
// 🔥 মেথডস
// ==============================================

// মার্ক অ্যাজ পেইড
invoiceSchema.methods.markAsPaid = function(paymentMethod, paymentReference, userId) {
    this.paymentStatus = 'paid';
    this.status = 'paid';
    this.paymentMethod = paymentMethod;
    this.paymentReference = paymentReference;
    this.paymentDate = new Date();
    this.updatedBy = userId;
    console.log(`✅ Invoice ${this.invoiceNumber} marked as paid`);
};

// মার্ক অ্যাজ সেন্ট
invoiceSchema.methods.markAsSent = function(emailedTo) {
    this.status = 'sent';
    this.emailSent = true;
    this.emailSentAt = new Date();
    if (emailedTo) {
        this.emailedTo = emailedTo;
    }
    console.log(`✅ Invoice ${this.invoiceNumber} marked as sent to ${emailedTo}`);
};

// ইজ ওভারডিউ চেক
invoiceSchema.methods.isOverdue = function() {
    return this.paymentStatus === 'pending' && new Date() > this.dueDate;
};

// আপডেট ওভারডিউ স্ট্যাটাস
invoiceSchema.methods.updateOverdueStatus = async function() {
    if (this.isOverdue() && this.paymentStatus !== 'overdue') {
        this.paymentStatus = 'overdue';
        this.status = 'overdue';
        await this.save();
        console.log(`⚠️ Invoice ${this.invoiceNumber} marked as overdue`);
        return true;
    }
    return false;
};

// ==============================================
// 🔥 স্ট্যাটিক মেথডস
// ==============================================

// কাস্টমারের সকল ইনভয়েস পাওয়া
invoiceSchema.statics.findByCustomer = function(customerId) {
    return this.find({ customerId }).sort('-createdAt');
};

// পেন্ডিং ইনভয়েস পাওয়া
invoiceSchema.statics.findPendingInvoices = function() {
    return this.find({ paymentStatus: 'pending' }).sort('dueDate');
};

// ওভারডিউ ইনভয়েস আপডেট করা
invoiceSchema.statics.updateAllOverdueStatus = async function() {
    const overdueInvoices = await this.find({
        paymentStatus: 'pending',
        dueDate: { $lt: new Date() }
    });
    
    let updatedCount = 0;
    for (const invoice of overdueInvoices) {
        invoice.paymentStatus = 'overdue';
        invoice.status = 'overdue';
        await invoice.save();
        updatedCount++;
    }
    
    console.log(`✅ Updated ${updatedCount} overdue invoices`);
    return updatedCount;
};

// ==============================================
// 🔥 ইনডেক্স
// ==============================================
invoiceSchema.index({ invoiceNumber: 1 }, { unique: true });
invoiceSchema.index({ bookingId: 1 });
invoiceSchema.index({ customerId: 1, createdAt: -1 });
invoiceSchema.index({ paymentStatus: 1, dueDate: 1 });
invoiceSchema.index({ createdAt: -1 });

// ==============================================
// 🔥 মডেল এক্সপোর্ট (একবারই তৈরি হবে)
// ==============================================
const Invoice = mongoose.models.Invoice || mongoose.model('Invoice', invoiceSchema);

module.exports = Invoice;