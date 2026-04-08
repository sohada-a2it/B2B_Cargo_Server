// models/newShipmentModel.js

const mongoose = require('mongoose');

const newShipmentSchema = new mongoose.Schema({
    // ========== BASIC IDENTIFIERS ==========
    shipmentNumber: {
        type: String,
        unique: true,
        required: true
    },
    trackingNumber: {
        type: String,
        unique: true,
        required: true,
        index: true
    },
    
    // ========== CUSTOMER INFO ==========
    customerInfo: {
        name: String,
        email: String,
        phone: String,
        companyName: String,
        address: {
            street: String,
            city: String,
            state: String,
            country: String,
            postalCode: String
        }
    },
    
    // ========== RELATIONSHIPS ==========
    customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    
    // ========== SHIPMENT CLASSIFICATION ==========
    shipmentClassification: {
        mainType: {
            type: String,
            enum: ['sea_freight', 'air_freight', 'inland_trucking', 'multimodal'],
            required: true
        },
        subType: {
            type: String,
            enum: [
                'sea_freight_fcl', 'sea_freight_lcl',
                'air_freight',
                'inland_transport',
                'door_to_door'
            ],
            required: true
        },
        isHazardous: {
            type: Boolean,
            default: false
        },
        isTemperatureControlled: {
            type: Boolean,
            default: false
        },
        temperatureRange: {
            min: Number,
            max: Number,
            unit: {
                type: String,
                default: '°C'
            }
        }
    },
    
    // ========== SERVICE TYPE ==========
    serviceType: {
        type: String,
        enum: ['standard', 'express', 'overnight', 'economy'],
        default: 'standard'
    },
    
    // ========== SHIPMENT DETAILS ==========
    shipmentDetails: {
        origin: {
            type: String,
            required: true
        },
        destination: {
            type: String,
            required: true
        },
        shippingMode: {
            type: String,
            enum: ['DDP', 'DDU', 'FOB', 'CIF'],
            default: 'DDU'
        },
        packageDetails: [{
            description: String,
            packagingType: {
                type: String,
                enum: ['pallet', 'carton', 'crate', 'wooden_box', 'container', 'envelope', 'loose_cargo', 'loose_tires', '20ft_container', '40ft_container'],
                default: 'carton'
            },
            quantity: {
                type: Number,
                default: 1
            },
            weight: {
                type: Number,
                default: 0
            },
            volume: {
                type: Number,
                default: 0
            },
            dimensions: {
                length: { type: Number, default: 0 },
                width: { type: Number, default: 0 },
                height: { type: Number, default: 0 },
                unit: { type: String, default: 'cm' }
            },
            productCategory: {
                type: String,
                default: 'Others'
            },
            hsCode: String,
            value: {
                amount: { type: Number, default: 0 },
                currency: { type: String, default: 'USD' }
            },
            hazardous: {
                type: Boolean,
                default: false
            },
            temperatureControlled: {
                required: { type: Boolean, default: false },
                minTemp: Number,
                maxTemp: Number
            }
        }],
        specialInstructions: String,
        referenceNumber: String,
        totalPackages: { type: Number, default: 0 },
        totalWeight: { type: Number, default: 0 },
        totalVolume: { type: Number, default: 0 }
    },
    
    // ========== DATES ==========
    dates: {
        estimatedDeparture: Date,
        estimatedArrival: Date,
        actualDeparture: Date,
        actualArrival: Date,
        actualDelivery: Date
    },
    
    // ========== QUOTED PRICE ==========
    quotedPrice: {
        amount: {
            type: Number,
            default: 0
        },
        currency: {
            type: String,
            enum: ['USD', 'GBP', 'CAD', 'EUR', 'BDT'],
            default: 'USD'
        },
        breakdown: {
            baseRate: { type: Number, default: 0 },
            weightCharge: { type: Number, default: 0 },
            fuelSurcharge: { type: Number, default: 0 },
            residentialSurcharge: { type: Number, default: 0 },
            insurance: { type: Number, default: 0 },
            tax: { type: Number, default: 0 },
            otherCharges: { type: Number, default: 0 }
        },
        notes: String,
        quotedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        quotedAt: {
            type: Date,
            default: Date.now
        },
        validUntil: Date
    },
    
    // ========== PRICING STATUS ==========
    pricingStatus: {
        type: String,
        enum: ['draft', 'quoted', 'negotiating', 'accepted', 'expired'],
        default: 'quoted'
    },
    
    // ========== PAYMENT ==========
    payment: {
        mode: {
            type: String,
            enum: ['bank_transfer', 'credit_card', 'cash', 'wire_transfer'],
            default: 'bank_transfer'
        },
        currency: {
            type: String,
            default: 'USD'
        },
        amount: Number,
        status: {
            type: String,
            enum: ['pending', 'paid', 'partial', 'overdue'],
            default: 'pending'
        },
        transactionId: String,
        paidAt: Date
    },
    
    // ========== SENDER & RECEIVER ==========
    sender: {
        name: {
            type: String,
            required: true
        },
        companyName: String,
        email: {
            type: String,
            required: true,
            lowercase: true
        },
        phone: {
            type: String,
            required: true
        },
        address: {
            addressLine1: String,
            addressLine2: String,
            city: String,
            state: String,
            country: String,
            postalCode: String
        },
        pickupDate: Date,
        pickupInstructions: String
    },
    
    receiver: {
        name: {
            type: String,
            required: true
        },
        companyName: String,
        email: {
            type: String,
            required: true,
            lowercase: true
        },
        phone: {
            type: String,
            required: true
        },
        address: {
            addressLine1: {
                type: String,
                required: true
            },
            addressLine2: String,
            city: {
                type: String,
                required: true
            },
            state: {
                type: String,
                required: true
            },
            country: {
                type: String,
                required: true
            },
            postalCode: String
        },
        deliveryInstructions: String,
        isResidential: {
            type: Boolean,
            default: false
        }
    },
    
    // ========== COURIER INFO ==========
    courier: {
        company: {
            type: String,
            default: 'Cargo Logistics Group'
        },
        serviceType: {
            type: String,
            enum: ['standard', 'express', 'overnight', 'economy'],
            default: 'standard'
        },
        trackingUrl: String,
        accountNumber: String,
        actualPickupDate: Date,
        actualDeliveryDate: Date
    },
    
    // ========== STATUS & TRACKING ==========
    status: {
        type: String,
        enum: [
            'booking_requested',
            'price_quoted',
            'booking_confirmed',
            'pending',
            'picked_up_from_warehouse',
            'departed_port_of_origin',
            'in_transit_sea_freight',
            'in_transit',
            'arrived_at_destination_port',
            'under_customs_cleared',  
            'customs_cleared',
            'under_customs_cleared',    // ← যোগ করুন
  'customs_clearance',         // ← যোগ করুন (এটা আপনি ব্যবহার করছেন)
  'customs_cleared',
            'out_for_delivery',
            'delivered',
            'on_hold',
            'cancelled',
            'rejected',
            'returned'
        ],
        default: 'booking_requested'
    },
    
    shipmentStatus: {
        type: String,
        enum: [
            'pending',
            'picked_up_from_warehouse',
            'departed_port_of_origin',
            'in_transit_sea_freight',
            'in_transit',
            'arrived_at_destination_port',
            'under_customs_cleared',
            'customs_cleared',
            'under_customs_cleared',    // ← যোগ করুন
  'customs_clearance',         // ← যোগ করুন (এটা আপনি ব্যবহার করছেন)
  'customs_cleared',
            'out_for_delivery',
            'delivered', 
            'on_hold',
            'cancelled',
            'returned'
        ],
        default: 'pending'
    },
    
    currentMilestone: {
        type: String,
        default: 'booking_requested'
    },
    
    currentLocation: {
        address: String,
        coordinates: {
            lat: Number,
            lng: Number
        },
        lastUpdated: Date
    },
    
    lastActiveStatus: {
        type: String,
        default: null
    },
    
    // ========== TIMELINE ==========
    timeline: [{
        status: {
            type: String,
            required: true
        },
        description: String,
        location: String,
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        timestamp: {
            type: Date,
            default: Date.now
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        }
    }],
    
    // ========== RETURN REQUEST (যোগ করুন) ==========
    returnRequest: {
        requestedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        requestedAt: Date,
        status: {
            type: String,
            enum: ['none', 'pending', 'approved', 'rejected_by_admin', 'rejected_by_customer', 'completed'],
            default: 'none'
        },
        reason: {
            type: String,
            enum: ['damaged_product', 'wrong_product', 'missing_items', 'delayed_delivery', 'customer_cancellation', 'other']
        },
        description: String,
        items: [{
            packageId: mongoose.Schema.Types.ObjectId,
            quantity: Number,
            reason: String
        }],
        images: [String],
        
        // Return cost
        returnCost: {
            type: Number,
            default: 0
        },
        returnCostCurrency: {
            type: String,
            default: 'USD'
        },
        returnCostBreakdown: {
            shippingCost: Number,
            handlingFee: Number,
            restockingFee: Number,
            total: Number,
            note: String
        },
        isFreeReturn: {
            type: Boolean,
            default: false
        },
        
        // Admin fields
        approvedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        approvedAt: Date,
        rejectionReason: String,
        returnTrackingNumber: String,
        returnNotes: String,
        
        // Cost adjustment by admin
        returnCostAdjustedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        returnCostAdjustedAt: Date,
        returnCostAdjustmentReason: String,
        
        // Customer confirmation
        customerConfirmedAt: Date,
        customerRejectedAt: Date,
        customerRejectionReason: String,
        customerNotes: String,
        costAccepted: {
            type: Boolean,
            default: false
        },
        
        // Completion
        completedAt: Date,
        completedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }
    },
    
    // ========== DOCUMENTS ==========
    documents: [{
        type: {
            type: String,
            enum: ['invoice', 'packing_list', 'bill_of_lading', 'airway_bill', 'commercial_invoice', 'certificate', 'other']
        },
        documentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Document'
        },
        uploadedAt: {
            type: Date,
            default: Date.now
        }
    }],
    
    // ========== NOTES ==========
    internalNotes: [{
        note: String,
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        createdAt: {
            type: Date,
            default: Date.now
        }
    }],
    
    customerNotes: [{
        note: String,
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        createdAt: {
            type: Date,
            default: Date.now
        }
    }],
    
    // Invoice reference
    invoiceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Invoice'
    },
    invoiceNumber: {
        type: String
    },
    
    // ========== AUDIT ==========
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    cancelledBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    cancelledAt: Date,
    cancellationReason: String
    
}, {
    timestamps: true
});

// ========== INDEXES ==========
newShipmentSchema.index({ trackingNumber: 1 });
newShipmentSchema.index({ shipmentNumber: 1 });
newShipmentSchema.index({ status: 1 });
newShipmentSchema.index({ shipmentStatus: 1 });
newShipmentSchema.index({ 'sender.email': 1 });
newShipmentSchema.index({ 'receiver.email': 1 });
newShipmentSchema.index({ customerId: 1 });
newShipmentSchema.index({ 'returnRequest.status': 1 }); // Return status এর জন্য index

// ========== VIRTUAL FIELDS ==========
newShipmentSchema.virtual('isDelivered').get(function() {
    return this.shipmentStatus === 'delivered' || this.status === 'delivered';
});

newShipmentSchema.virtual('isCancelled').get(function() {
    return this.status === 'cancelled';
});

newShipmentSchema.virtual('isBookingConfirmed').get(function() {
    return this.status === 'booking_confirmed';
});

newShipmentSchema.virtual('hasReturnRequest').get(function() {
    return this.returnRequest && this.returnRequest.status !== 'none';
});

newShipmentSchema.virtual('isReturnPending').get(function() {
    return this.returnRequest?.status === 'pending';
});

newShipmentSchema.virtual('isReturnApproved').get(function() {
    return this.returnRequest?.status === 'approved';
});

newShipmentSchema.virtual('isReturnCompleted').get(function() {
    return this.returnRequest?.status === 'completed';
});

// ========== METHODS ==========
newShipmentSchema.methods.addTimelineEntry = function(status, description, location, userId, metadata = {}) {
    this.timeline.push({
        status,
        description,
        location,
        updatedBy: userId,
        timestamp: new Date(),
        metadata
    });
    
    // Update current milestone
    this.currentMilestone = status;
    
    // Update current location if provided
    if (location) {
        this.currentLocation = {
            address: location,
            lastUpdated: new Date()
        };
    }
    
    return this;
};

newShipmentSchema.methods.updateShipmentStatus = function(status, location, description, userId) {
    this.shipmentStatus = status;
    this.addTimelineEntry(status, description, location, userId);
    return this;
};

newShipmentSchema.methods.updateBookingStatus = function(status, description, location, userId) {
    this.status = status;
    this.addTimelineEntry(status, description, location, userId);
    return this;
};

// Return request methods
newShipmentSchema.methods.requestReturn = function(userId, returnData) {
    this.returnRequest = {
        requestedBy: userId,
        requestedAt: new Date(),
        status: 'pending',
        reason: returnData.reason,
        description: returnData.description,
        items: returnData.items || [],
        images: returnData.images || [],
        returnCost: returnData.returnCost || 0,
        returnCostCurrency: returnData.returnCostCurrency || 'USD',
        returnCostBreakdown: returnData.returnCostBreakdown || {},
        isFreeReturn: returnData.isFreeReturn || false
    };
    
    this.addTimelineEntry('return_requested', `Return requested: ${returnData.reason}`, null, userId);
    return this;
};

newShipmentSchema.methods.approveReturn = function(userId, approveData) {
    if (this.returnRequest && this.returnRequest.status === 'pending') {
        this.returnRequest.status = 'approved';
        this.returnRequest.approvedBy = userId;
        this.returnRequest.approvedAt = new Date();
        this.returnRequest.returnTrackingNumber = approveData.returnTrackingNumber;
        this.returnRequest.returnNotes = approveData.notes;
        
        // Update cost if adjusted
        if (approveData.adjustCost) {
            this.returnRequest.returnCost = approveData.adjustCost.amount;
            this.returnRequest.returnCostAdjustedBy = userId;
            this.returnRequest.returnCostAdjustedAt = new Date();
            this.returnRequest.returnCostAdjustmentReason = approveData.adjustCost.reason;
        }
        
        this.addTimelineEntry('return_approved', `Return approved. Tracking: ${approveData.returnTrackingNumber || 'N/A'}`, null, userId);
    }
    return this;
};

newShipmentSchema.methods.completeReturn = function(userId, notes, acceptCost) {
    if (this.returnRequest && this.returnRequest.status === 'approved') {
        this.returnRequest.status = 'completed';
        this.returnRequest.customerConfirmedAt = new Date();
        this.returnRequest.customerNotes = notes;
        this.returnRequest.completedAt = new Date();
        this.returnRequest.completedBy = userId;
        this.returnRequest.costAccepted = acceptCost;
        
        // Update shipment status
        this.shipmentStatus = 'returned';
        this.status = 'returned';
        
        this.addTimelineEntry('return_completed', `Return completed by customer. Cost accepted: ${acceptCost}`, null, userId);
    }
    return this;
};

// ========== PRE-SAVE HOOKS ==========
newShipmentSchema.pre('save', function(next) {
    // Calculate totals from packageDetails
    if (this.shipmentDetails && this.shipmentDetails.packageDetails) {
        let totalPackages = 0;
        let totalWeight = 0;
        let totalVolume = 0;
        
        this.shipmentDetails.packageDetails.forEach(pkg => {
            const qty = pkg.quantity || 1;
            totalPackages += qty;
            totalWeight += (pkg.weight || 0) * qty;
            totalVolume += (pkg.volume || 0) * qty;
        });
        
        this.shipmentDetails.totalPackages = totalPackages;
        this.shipmentDetails.totalWeight = parseFloat(totalWeight.toFixed(2));
        this.shipmentDetails.totalVolume = parseFloat(totalVolume.toFixed(3));
    }
    
    next();
});

module.exports = mongoose.model('NewShipment', newShipmentSchema);