// models/ManualShipment.js
const mongoose = require('mongoose');

const manualShipmentSchema = new mongoose.Schema({
    trackingNumber: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    bookingNumber: {
        type: String,
        sparse: true
    },
    
    // Basic Information
    origin: {
        type: String,
        required: true
    },
    destination: {
        type: String,
        required: true
    },
    
    // Shipment Details
    shipmentDetails: {
        goodsDescription: String,
        totalPackages: Number,
        totalWeight: Number,
        totalVolume: Number,
        packageType: String,
        shippingMode: {
            type: String,
            enum: ['DDP', 'DDU', 'FOB', 'CIF'],
            default: 'DDU'
        }
    },
    
    // Package Details (Manual Entry)
    packageDetails: [{
        packageNumber: String,
        description: String,
        quantity: Number,
        weight: Number,
        volume: Number,
        dimensions: {
            length: Number,
            width: Number,
            height: Number,
            unit: { type: String, default: 'cm' }
        },
        type: String,
        productCategory: String,
        hsCode: String
    }],
    
    // Status
    status: {
        type: String,
        enum: ['pending', 'picked_up', 'in_transit', 'customs_clearance', 
                'arrived', 'out_for_delivery', 'delivered', 'cancelled'],
        default: 'pending'
    },
    
    // Timeline
    timeline: [{
        status: String,
        description: String,
        location: String,
        timestamp: {
            type: Date,
            default: Date.now
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }
    }],
    
    // Tracking Updates
    trackingUpdates: [{
        status: String,
        location: String,
        description: String,
        timestamp: {
            type: Date,
            default: Date.now
        }
    }],
    
    // Dates
    dates: {
        estimatedDeparture: Date,
        estimatedArrival: Date,
        actualDeparture: Date,
        actualArrival: Date,
        delivered: Date
    },
    
    // Sender & Receiver
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
        deliveryInstructions: String
    },
    
    // Metadata
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    notes: String,
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Index for faster search
manualShipmentSchema.index({ trackingNumber: 1 });
manualShipmentSchema.index({ status: 1 });
manualShipmentSchema.index({ 'dates.estimatedArrival': 1 });

module.exports = mongoose.model('ManualShipment', manualShipmentSchema);