// models/shipmentModel.js - সম্পূর্ণ আপডেটেড ভার্সন (Return Request সহ)

const mongoose = require('mongoose');

// ==================== ENUMS (Booking থেকে নেওয়া) ====================

// Shipment Types (Main Category) - Booking-এর সাথে মিল রেখে
const shipmentTypes = ['sea_freight', 'air_freight', 'inland_trucking', 'multimodal'];

// Shipment Sub Types - Booking-এর সাথে মিল রেখে
const shipmentSubTypes = [
    'sea_freight_fcl',      // Full Container Load
    'sea_freight_lcl',      // Less than Container Load
    'air_freight',          // Air Freight
    'rail_freight',         // Rail Freight
    'express_delivery',     // Express Delivery
    'inland_transport',     // Inland Transport
    'door_to_door'          // Door to Door
];

// Shipment Status
const shipmentStatuses = [
    'pending',
    'in_progress', 
    'picked_up_from_warehouse',
    'departed_port_of_origin',
    'in_transit_sea_freight',
    'in_transit',
    'arrived_at_destination_port',
    'customs_cleared',
    'out_for_delivery',
    'inspected',                   
    'damage_reported',
    'consolidating',
    'consolidated',
    'ready_for_dispatch',
    'loaded_in_container',
    'dispatched',
    'completed', 
    'delivered',
    'on_hold',
    'shipment_on_hold', 
    'shipment_cancelled',
    'cancelled',
    'returned',
    'return_initiated',
    'return_requested',        // ✅ যোগ করুন
    'return_approved',         // ✅ যোগ করুন
    'return_rejected',         // ✅ যোগ করুন
    'return_completed', 
    'return_initiated',        // ✅ নতুন (return started)
    'received_at_warehouse'
];

// Shipping Modes (Incoterms) - Booking-এর সাথে মিল রেখে
const shippingModes = ['DDP', 'DDU', 'FOB', 'CIF'];

// Currencies - Booking-এর সাথে মিল রেখে
const currencies = ['USD', 'GBP', 'CAD'];

// Courier Service Types - Booking-এর সাথে মিল রেখে
const courierServiceTypes = ['standard', 'express', 'overnight', 'economy'];

// Origins - Booking-এর সাথে মিল রেখে
const origins = ['China Warehouse', 'Thailand Warehouse'];

// Destinations - Booking-এর সাথে মিল রেখে
const destinations = ['USA', 'UK', 'Canada'];

// ==================== PACKAGE SCHEMA ====================
const packageSchema = new mongoose.Schema({
    description: {
        type: String,
        required: [true, 'Package description is required']
    },
    packagingType: {
        type: String,
        enum: [
            'pallet', 'carton', 'crate', 'wooden_box', 'container',
            'envelope', 'loose_cargo', 'loose_tires', '20ft_container', '40ft_container'
        ],
        default: 'carton'
    },
    quantity: {
        type: Number,
        required: true,
        min: [1, 'Minimum 1 item required']
    },
    weight: {
        type: Number,
        required: true,
        min: [0, 'Weight cannot be negative']
    },
    volume: {
        type: Number,
        required: true,
        min: [0, 'Volume cannot be negative']
    },
    dimensions: {
        length: { type: Number, required: true },
        width: { type: Number, required: true },
        height: { type: Number, required: true },
        unit: { type: String, enum: ['cm', 'in'], default: 'cm' }
    },
    productCategory: {
        type: String,
        enum: [
            'Electronics', 'Furniture', 'Clothing', 'Machinery', 
            'Automotive', 'Pharmaceuticals', 'Food', 'Documents', 
            'Tires', 'Chemicals', 'Others'
        ]
    },
    hsCode: String,
    value: {
        amount: {
            type: Number,
            default: 0
        },
        currency: {
            type: String,
            enum: currencies,
            default: 'USD'
        }
    },
    hazardous: {
        type: Boolean,
        default: false
    },
    temperatureControlled: {
        required: { type: Boolean, default: false },
        minTemp: Number,
        maxTemp: Number
    },
    condition: {
        type: String,
        enum: ['Excellent', 'Good', 'Fair', 'Damaged'],
        default: 'Good'
    },
    warehouseLocation: String,
    inspectionNotes: String
});

// ==================== MILESTONE SCHEMA ====================
const milestoneSchema = new mongoose.Schema({
    status: {
        type: String,
        enum: shipmentStatuses,
        required: true
    },
    location: String,
    description: String,
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

// ==================== RETURN REQUEST SCHEMA (NEW) ====================
// models/shipmentModel.js - returnRequestSchema সম্পূর্ণভাবে replace করুন

const returnRequestSchema = new mongoose.Schema({
    requestedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false
    },
    requestedAt: {
        type: Date,
        default: Date.now
    },
    status: {
        type: String,
        enum: ['none', 'pending', 'approved', 'rejected', 'completed', 'customer_confirmed', 'rejected_by_admin', 'rejected_by_customer'],
        default: 'none'
    },
    reason: {
        type: String,
        enum: [
            'damaged_product',
            'wrong_product',
            'missing_items',
            'delayed_delivery',
            'customer_cancellation',
            'other'
        ]
    },
    reasonText: String,
    description: String,
    items: [{ type: Number }],
    images: [{
        url: String,
        uploadedAt: Date
    }],
    
    // Admin approval fields
    approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    approvedAt: Date,
    rejectionReason: String,
    returnTrackingNumber: String,
    returnNotes: String,
    
    // Customer confirmation fields
    customerConfirmedAt: Date,
    customerRejectedAt: Date,
    customerRejectionReason: String,
    customerNotes: String,
    
    // Return cost fields
    returnCost: { type: Number, default: 0 },
    returnCostCurrency: { type: String, default: 'USD' },
    returnCostBreakdown: {
        shippingCost: Number,
        handlingFee: Number,
        restockingFee: Number,
        total: Number,
        note: String
    },
    isFreeReturn: { type: Boolean, default: false },
    costAccepted: { type: Boolean, default: false },
    returnCostAdjustedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    returnCostAdjustedAt: Date,
    returnCostAdjustmentReason: String,
    
    // Completion fields
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    completedAt: Date,
    refundAmount: { type: Number, default: 0 },
    refundCurrency: { type: String, enum: currencies, default: 'USD' },
    refundProcessedAt: Date,
    refundReference: String
}, { timestamps: true });

// ==================== MAIN SHIPMENT SCHEMA ====================
const shipmentSchema = new mongoose.Schema({
    // ===== Identification =====
    shipmentNumber: {
        type: String,
        required: true,
        unique: true
    },
    trackingNumber: {
        type: String,
        required: true,
        unique: true
    },
    bookingId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Booking',
        required: true
    },
    
    // ===== Relationships =====
    customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    
    // ===== Shipment Classification =====
    shipmentClassification: {
        mainType: {
            type: String,
            enum: shipmentTypes,
            required: true
        },
        subType: {
            type: String,
            enum: shipmentSubTypes,
            required: true
        }
    },
    
    // ===== Shipment Details =====
    shipmentDetails: {
        origin: {
            type: String,
            enum: origins,
            required: true
        },
        destination: {
            type: String,
            enum: destinations,
            required: true
        },
        shippingMode: {
            type: String,
            enum: shippingModes,
            default: 'DDU'
        },
        totalPackages: {
            type: Number,
            default: 0
        },
        totalWeight: {
            type: Number,
            default: 0
        },
        totalVolume: {
            type: Number,
            default: 0
        }
    },
    
    // ===== Packages =====
    packages: [packageSchema],
    
    // ===== Sender Information =====
    sender: {
        name: String,
        companyName: String,
        email: String,
        phone: String,
        address: {
            addressLine1: String,
            addressLine2: String,
            city: String,
            state: String,
            country: String,
            postalCode: String
        }
    },
    
    // ===== Receiver Information =====
    receiver: {
        name: String,
        companyName: String,
        email: String,
        phone: String,
        address: {
            addressLine1: String,
            addressLine2: String,
            city: String,
            state: String,
            country: String,
            postalCode: String
        },
        isResidential: Boolean
    },
    
    // ===== Courier Information =====
    courier: {
        company: {
            type: String,
            enum: ['Cargo Logistics Group', 'DHL', 'FedEx', 'UPS', 'USPS', 'Other'],
            default: 'Cargo Logistics Group'
        },
        serviceType: {
            type: String,
            enum: courierServiceTypes,
            default: 'standard'
        },
        accountNumber: String,
        trackingUrl: String,
        estimatedPickupDate: Date,
        actualPickupDate: Date,
        estimatedDeliveryDate: Date,
        actualDeliveryDate: Date,
        deliveryConfirmation: String,
        signedBy: String,
        courierNotes: String
    },
    
    // ===== Status =====
    status: {
        type: String,
        enum: shipmentStatuses,
        default: 'pending'
    },
    currentMilestone: {
        type: String,
        enum: shipmentStatuses
    },
    
    // ===== Milestones =====
    milestones: [milestoneSchema],
    
    // ===== Container Information =====
    containerInfo: {
        containerNumber: String,
        containerType: {
            type: String,
            enum: ['20FT', '40FT', '40FT HC']
        },
        sealNumber: String,
        stuffedAt: Date
    },
    
    // ===== Transport Details =====
    transport: {
        carrierName: String,
        vesselName: String,
        flightNumber: String,
        voyageNumber: String,
        bookingNumber: String,
        estimatedDeparture: Date,
        estimatedArrival: Date,
        actualDeparture: Date,
        actualArrival: Date,
        currentLocation: {
            location: String,
            status: String,
            timestamp: Date
        }
    },
    
    // ===== Warehouse Information =====
    warehouseInfo: {
        expectedAt: Date,
        receivedAt: Date,
        receivedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        location: String,
        receiptNumber: String,
        notes: String
    },
    
    // ===== Dates =====
    dates: {
        estimatedDeparture: Date,
        estimatedArrival: Date,
        actualDeparture: Date,
        actualArrival: Date,
        delivered: Date
    },
    
    // ===== Cancellation =====
    cancelledAt: Date,
    cancellationReason: String,
    
    // ===== Consolidation =====
    consolidationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Consolidation'
    },
    
    // ===== Return Request (NEW) =====
    returnRequest: {
        type: returnRequestSchema,
        default: () => ({ status: 'none' })
    },
    
    // ===== Notes =====
    internalNotes: [{
        note: String,
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        createdAt: Date
    }],
    
    customerNotes: [{
        note: String,
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        createdAt: Date
    }],
    
    // ===== Costs =====
    costs: [{
        type: {
            type: String,
            enum: ['freight', 'handling', 'warehouse', 'customs', 'insurance', 'other']
        },
        amount: Number,
        currency: { type: String, enum: currencies, default: 'USD' },
        description: String,
        vendor: String,
        incurredBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        incurredAt: Date
    }],
    
    // ===== Documents =====
    documents: [{
        type: {
            type: String,
            enum: ['label', 'invoice', 'customs_form', 'packing_list', 'bill_of_lading', 'airway_bill', 'proof_of_delivery']
        },
        url: String,
        uploadedAt: Date,
        uploadedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }
    }],
    
    // ===== Assignment =====
    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    
    // ===== Audit =====
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

// ==================== PRE-SAVE MIDDLEWARE ====================
shipmentSchema.pre('save', function(next) {
    // Calculate totals from packages
    if (this.packages && this.packages.length > 0) {
        this.shipmentDetails.totalPackages = this.packages.reduce((sum, pkg) => sum + pkg.quantity, 0);
        this.shipmentDetails.totalWeight = this.packages.reduce((sum, pkg) => sum + (pkg.weight * pkg.quantity), 0);
        this.shipmentDetails.totalVolume = this.packages.reduce((sum, pkg) => sum + (pkg.volume * pkg.quantity), 0);
    }
    
    // Set current milestone from latest milestone
    if (this.milestones && this.milestones.length > 0) {
        const latest = this.milestones[this.milestones.length - 1];
        this.currentMilestone = latest.status;
    }
    
    // Update transport current location if exists
    if (this.transport?.currentLocation) {
        this.transport.currentLocation.timestamp = new Date();
    }
    
    this.updatedAt = Date.now();
    next();
});

// ==================== METHODS ====================
shipmentSchema.methods.addMilestone = function(status, location, description, userId) {
    this.milestones.push({
        status,
        location,
        description,
        updatedBy: userId,
        timestamp: new Date()
    });
    this.status = status;
    this.currentMilestone = status;
    
    if (location) {
        if (!this.transport) this.transport = {};
        this.transport.currentLocation = {
            location,
            status,
            timestamp: new Date()
        };
    }
};

shipmentSchema.methods.getProgress = function() {
    const order = [
        'pending',
        'picked_up_from_warehouse',
        'departed_port_of_origin',
        'in_transit_sea_freight',
        'arrived_at_destination_port',
        'customs_cleared',
        'out_for_delivery',
        'delivered'
    ];
    
    const currentIndex = order.indexOf(this.status);
    if (currentIndex === -1) return 0;
    return Math.round((currentIndex / (order.length - 1)) * 100);
};

shipmentSchema.methods.updateDeliveryStatus = function(status, location, userId) {
    this.status = status;
    this.addMilestone(status, location, `Shipment status updated to ${status}`, userId);
    
    if (status === 'delivered') {
        this.dates.delivered = new Date();
        this.courier.actualDeliveryDate = new Date();
    }
};

// ==================== RETURN REQUEST METHODS (NEW) ====================
shipmentSchema.methods.canRequestReturn = function() {
    // Check if shipment is delivered or completed
    const eligibleStatuses = ['delivered', 'completed'];
    if (!eligibleStatuses.includes(this.status)) {
        return { allowed: false, reason: `Shipment status is ${this.status}. Only delivered/completed shipments can be returned.` };
    }
    
    // Check if return already requested
    if (this.returnRequest && this.returnRequest.status !== 'none' && this.returnRequest.status !== 'rejected') {
        return { allowed: false, reason: `Return already ${this.returnRequest.status}.` };
    }
    
    // Check delivery date (within 14 days)
    const deliveryDate = this.dates?.delivered || this.courier?.actualDeliveryDate;
    if (deliveryDate) {
        const daysSinceDelivery = Math.floor((Date.now() - new Date(deliveryDate)) / (1000 * 60 * 60 * 24));
        if (daysSinceDelivery > 14) {
            return { allowed: false, reason: `Return period expired (${daysSinceDelivery} days ago). Maximum 14 days allowed.` };
        }
    }
    
    return { allowed: true };
};

shipmentSchema.methods.requestReturn = function(userId, returnData) {
    this.returnRequest = {
        requestedBy: userId,
        requestedAt: new Date(),
        status: 'pending',
        reason: returnData.reason,
        reasonText: returnData.reasonText,
        description: returnData.description,
        images: returnData.images || []
    };
    
    this.addMilestone(
        'return_requested',
        this.shipmentDetails?.destination || 'Customer Location',
        `Return requested. Reason: ${returnData.reason}${returnData.reasonText ? ' - ' + returnData.reasonText : ''}`,
        userId
    );
};

shipmentSchema.methods.approveReturn = function(userId, approvalData) {
    this.returnRequest.status = 'approved';
    this.returnRequest.approvedBy = userId;
    this.returnRequest.approvedAt = new Date();
    this.returnRequest.returnTrackingNumber = approvalData.returnTrackingNumber;
    this.returnRequest.returnNotes = approvalData.notes;
    
    this.status = 'return_initiated';
    
    this.addMilestone(
        'return_approved',
        'System',
        `Return approved. Return tracking: ${approvalData.returnTrackingNumber || 'To be provided'}. ${approvalData.notes || ''}`,
        userId
    );
};

shipmentSchema.methods.rejectReturn = function(userId, rejectionReason) {
    this.returnRequest.status = 'rejected';
    this.returnRequest.rejectionReason = rejectionReason;
    this.returnRequest.approvedBy = userId;
    this.returnRequest.approvedAt = new Date();
    
    this.addMilestone(
        'return_rejected',
        'System',
        `Return rejected. Reason: ${rejectionReason}`,
        userId
    );
};

shipmentSchema.methods.completeReturn = function(userId, completeData) {
    this.returnRequest.status = 'completed';
    this.returnRequest.returnNotes = completeData.notes;
    this.returnRequest.refundAmount = completeData.refundAmount;
    this.returnRequest.refundCurrency = completeData.refundCurrency;
    this.returnRequest.refundProcessedAt = new Date();
    this.returnRequest.refundReference = completeData.refundReference;
    
    this.status = 'returned';
    
    this.addMilestone(
        'return_completed',
        'System',
        `Return completed. Refund: ${completeData.refundAmount || 0} ${completeData.refundCurrency || 'USD'}. ${completeData.notes || ''}`,
        userId
    );
};

// ==================== INDEXES ====================
shipmentSchema.index({ shipmentNumber: 1 });
shipmentSchema.index({ trackingNumber: 1 });
shipmentSchema.index({ bookingId: 1 });
shipmentSchema.index({ customerId: 1, status: 1 });
shipmentSchema.index({ 'shipmentDetails.origin': 1, 'shipmentDetails.destination': 1 });
shipmentSchema.index({ 'containerInfo.containerNumber': 1 });
shipmentSchema.index({ status: 1, createdAt: -1 });
shipmentSchema.index({ 'returnRequest.status': 1 });  // ✅ নতুন index
shipmentSchema.index({ 'returnRequest.requestedAt': -1 });  // ✅ নতুন index

module.exports = mongoose.model('Shipment', shipmentSchema);