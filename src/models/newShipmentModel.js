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
    
    // ========== SHIPMENT CLASSIFICATION (ফ্রন্টএন্ডের সাথে মিল রেখে) ==========
    shipmentClassification: {
        mainType: {
            type: String,
            enum: ['sea_freight', 'air_freight', 'inland_trucking', 'multimodal'],
            required: true
        },
        subType: {
            type: String,
            enum: [
                // Sea freight (ফ্রন্টএন্ডের মতো)
                'sea_freight_fcl', 'sea_freight_lcl',
                // Air freight
                'air_freight',
                // Inland trucking
                'inland_transport',
                // Multimodal
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
    // ========== TIMELINE (ফ্রন্টএন্ডের trackingTimeline এর সাথে মিল রেখে) ==========
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
newShipmentSchema.index({ bookingId: 1 });

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