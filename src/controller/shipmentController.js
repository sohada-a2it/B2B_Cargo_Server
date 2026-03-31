// controllers/shipmentController.js (সম্পূর্ণ ভার্সন)

const Shipment = require('../models/shipmentModel');
const Booking = require('../models/bookingModel');
const Invoice = require('../models/invoiceModel');
const User = require('../models/userModel');
const { sendEmail } = require('../utils/emailService');

// ========== 1. GET ALL SHIPMENTS (Admin/Operat 

// GET ALL SHIPMENTS - বুকিং কন্ট্রোলারের মতো করে
exports.getAllShipments = async (req, res) => {
  try {
    console.log('📥 getAllShipments called with query:', req.query);
    
    const { page = 1, limit = 20, status, mode, search } = req.query;
    
    // Build filter - বুকিংয়ের মতো
    let filter = {};
    if (status) filter.status = status;
    if (mode) filter['shipmentDetails.shipmentType'] = mode;
    
    if (search) {
      filter.$or = [
        { shipmentNumber: new RegExp(search, 'i') },
        { trackingNumber: new RegExp(search, 'i') }
      ];
    }
    
    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const limitNum = parseInt(limit);
    
    // Get shipments with population - বুকিংয়ের মতো
    const shipments = await Shipment.find(filter)
      .populate('customerId', 'firstName lastName email companyName phone')
      .populate('bookingId', 'bookingNumber')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);
    
    // Get total count
    const total = await Shipment.countDocuments(filter);
    
    // Calculate summary stats - বুকিংয়ের মতো
    const summary = {
      total: shipments.length,
      active: shipments.filter(s => !['delivered', 'cancelled'].includes(s.status)).length,
      delivered: shipments.filter(s => s.status === 'delivered').length,
      cancelled: shipments.filter(s => s.status === 'cancelled').length,
      pending: shipments.filter(s => s.status === 'pending').length,
      inTransit: shipments.filter(s => s.status === 'in_transit').length
    };
    
    // Response format - বুকিংয়ের মতো
    res.status(200).json({
      success: true,
      data: shipments,
      summary: summary,
      pagination: {
        total,
        page: parseInt(page),
        limit: limitNum,
        pages: Math.ceil(total / limitNum)
      },
      message: 'Shipments fetched successfully'
    });
    
  } catch (error) {
    console.error('❌ Error in getAllShipments:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}; 

// UPDATE SHIPMENT STATUS - বুকিং স্টেটাস আপডেটের মতো
exports.updateShipmentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, location, description } = req.body;
    
    const shipment = await Shipment.findById(id);
    
    if (!shipment) {
      return res.status(404).json({
        success: false,
        error: 'Shipment not found'
      });
    }
    
    // Add milestone
    shipment.milestones = shipment.milestones || [];
    shipment.milestones.push({
      status,
      location,
      description,
      updatedBy: req.user._id,
      timestamp: new Date()
    });
    
    shipment.status = status;
    shipment.updatedBy = req.user._id;
    
    await shipment.save();
    
    res.status(200).json({
      success: true,
      data: shipment,
      message: 'Shipment status updated successfully'
    });
    
  } catch (error) {
    console.error('Error in updateShipmentStatus:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// ========== 1.1 GET MY SHIPMENTS (Customer) ==========
exports.getMyShipments = async (req, res) => {
    try {
        const { 
            status, 
            page = 1, 
            limit = 10,
            sort = '-createdAt'
        } = req.query;

        let query = { customerId: req.user._id };
        if (status) query.status = status;

        const shipments = await Shipment.find(query)
            .populate('bookingId', 'bookingNumber')
            .sort(sort)
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit));

        const total = await Shipment.countDocuments(query);

        res.status(200).json({
            success: true,
            data: shipments,
            pagination: {
                total,
                page: parseInt(page),
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 1.2 GET MY SHIPMENT BY ID (Customer) ==========
exports.getMyShipmentById = async (req, res) => {
    try {
        const { id } = req.params;

        const shipment = await Shipment.findOne({
            _id: id,
            customerId: req.user._id
        })
        .populate('bookingId', 'bookingNumber quotedPrice')
        .populate('milestones.updatedBy', 'firstName lastName role');

        if (!shipment) {
            return res.status(404).json({ 
                success: false, 
                message: 'Shipment not found' 
            });
        }

        res.status(200).json({
            success: true,
            data: shipment
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 1.3 GET MY SHIPMENT TIMELINE (Customer) ==========
exports.getMyShipmentTimeline = async (req, res) => {
    try {
        const { id } = req.params;

        const shipment = await Shipment.findOne({
            _id: id,
            customerId: req.user._id
        }).select('trackingNumber milestones trackingUpdates status');

        if (!shipment) {
            return res.status(404).json({ 
                success: false, 
                message: 'Shipment not found' 
            });
        }

        // Combine milestones and tracking updates
        const timeline = [
            ...shipment.milestones.map(m => ({
                type: 'milestone',
                status: m.status,
                location: m.location,
                description: m.description,
                timestamp: m.timestamp
            })),
            ...shipment.trackingUpdates.map(t => ({
                type: 'tracking',
                status: t.status,
                location: t.location,
                description: t.description,
                timestamp: t.timestamp
            }))
        ].sort((a, b) => b.timestamp - a.timestamp);

        res.status(200).json({
            success: true,
            data: {
                trackingNumber: shipment.trackingNumber,
                currentStatus: shipment.status,
                timeline
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 2. GET SINGLE SHIPMENT ==========
exports.getShipmentById = async (req, res) => {
    try {
        const { id } = req.params;

        const shipment = await Shipment.findById(id)
            .populate('customerId', 'firstName lastName companyName email phone address')
            .populate('assignedTo', 'firstName lastName email role')
            .populate('createdBy', 'firstName lastName')
            .populate('updatedBy', 'firstName lastName')
            .populate('bookingId', 'bookingNumber quotedPrice')
            .populate('milestones.updatedBy', 'firstName lastName role');

        if (!shipment) {
            return res.status(404).json({ 
                success: false, 
                message: 'Shipment not found' 
            });
        }

        // Check permission (customer can only see their own)
        if (req.user.role === 'customer' && 
            shipment.customerId._id.toString() !== req.user._id.toString()) {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied' 
            });
        }

        // Get invoice if exists
        const invoice = await Invoice.findOne({ 
            shipmentId: shipment._id 
        });

        res.status(200).json({
            success: true,
            data: {
                shipment,
                invoice: invoice || null
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 3. CREATE SHIPMENT (from Booking) ========== 
exports.createShipment = async (req, res) => {
    try {
        const { bookingId } = req.body;

        // Find booking with new schema fields
        const booking = await Booking.findById(bookingId)
            .populate('customer', 'firstName lastName companyName email phone address');

        if (!booking) {
            return res.status(404).json({ 
                success: false, 
                message: 'Booking not found' 
            });
        }

        // Check if shipment already exists
        const existingShipment = await Shipment.findOne({ bookingId });
        if (existingShipment) {
            return res.status(400).json({ 
                success: false, 
                message: 'Shipment already exists for this booking' 
            });
        }

        // Generate tracking number if not exists
        let trackingNumber = booking.trackingNumber;
        if (!trackingNumber) {
            trackingNumber = await generateTrackingNumber();
        }

        // Create shipment with new schema fields
        const shipmentData = {
            shipmentNumber: await generateShipmentNumber(),
            trackingNumber: trackingNumber,
            bookingId: booking._id,
            customerId: booking.customer._id,
            shipmentDetails: {
                shipmentType: booking.shipmentDetails?.shipmentType,
                origin: booking.shipmentDetails?.origin,
                destination: booking.shipmentDetails?.destination,
                shippingMode: booking.shipmentDetails?.shippingMode
            },
            // নতুন fields
            sender: booking.sender,
            receiver: booking.receiver,
            courier: booking.courier,
            estimatedDepartureDate: booking.estimatedDepartureDate,
            estimatedArrivalDate: booking.estimatedArrivalDate,
            
            // Packages - cargoDetails থেকে packageDetails
            packages: (booking.shipmentDetails?.packageDetails || []).map(item => ({
                description: item.description,
                packageType: 'Carton',
                quantity: item.quantity || 1,
                weight: item.weight || 0,
                volume: item.volume || 0,
                dimensions: item.dimensions || {
                    length: 0, width: 0, height: 0, unit: 'cm'
                },
                productCategory: item.productCategory,
                hsCode: item.hsCode,
                value: item.value || { amount: 0, currency: 'USD' },
                condition: 'Good'
            })),
            
            status: 'pending',
            createdBy: req.user._id,
            milestones: [{
                status: 'pending',
                location: booking.sender?.address?.country || booking.shipmentDetails?.origin || 'Unknown',
                description: 'Shipment created from confirmed booking',
                updatedBy: req.user._id,
                timestamp: new Date()
            }]
        };

        const shipment = await Shipment.create(shipmentData);

        // Update booking with shipment reference
        booking.shipmentId = shipment._id;
        await booking.save();

        // Notify warehouse team
        const warehouseStaff = await User.find({ 
            role: 'warehouse', 
            isActive: true
        });

        if (warehouseStaff.length > 0) {
            sendEmail({
                to: warehouseStaff.map(w => w.email),
                subject: '📦 New Shipment Ready for Warehouse',
                template: 'new-shipment-warehouse',
                data: {
                    trackingNumber: shipment.trackingNumber,
                    customerName: booking.sender?.name || booking.customer?.companyName || 'Customer',
                    origin: booking.shipmentDetails?.origin,
                    destination: booking.shipmentDetails?.destination,
                    packages: shipment.packages.length,
                    shipmentUrl: `${process.env.FRONTEND_URL}/warehouse/shipments/${shipment._id}`
                }
            }).catch(err => console.log('Warehouse email error:', err.message));
        }

        res.status(201).json({
            success: true,
            message: 'Shipment created successfully',
            data: shipment
        });

    } catch (error) {
        console.error('Create shipment error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 4. UPDATE SHIPMENT ==========
exports.updateShipment = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        const shipment = await Shipment.findById(id);
        if (!shipment) {
            return res.status(404).json({ 
                success: false, 
                message: 'Shipment not found' 
            });
        }

        // Remove fields that shouldn't be updated directly
        delete updateData._id;
        delete updateData.shipmentNumber;
        delete updateData.trackingNumber;
        delete updateData.createdBy;
        delete updateData.createdAt;

        Object.assign(shipment, updateData);
        shipment.updatedBy = req.user._id;

        await shipment.save();

        res.status(200).json({
            success: true,
            message: 'Shipment updated successfully',
            data: shipment
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 5. DELETE SHIPMENT ==========
exports.deleteShipment = async (req, res) => {
    try {
        const { id } = req.params;

        const shipment = await Shipment.findById(id);
        if (!shipment) {
            return res.status(404).json({ 
                success: false, 
                message: 'Shipment not found' 
            });
        }

        // Check if shipment can be deleted (only if in draft/pending)
        if (!['pending', 'draft'].includes(shipment.status)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete shipment in current status' 
            });
        }

        await shipment.deleteOne();

        res.status(200).json({
            success: true,
            message: 'Shipment deleted successfully'
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 6. UPDATE SHIPMENT STATUS ==========
// controllers/shipmentController.js - updateShipmentStatus ফাংশন আপডেট করুন

exports.updateShipmentStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, location, description, notifyCustomer } = req.body;

        const shipment = await Shipment.findById(id)
            .populate('customerId', 'email firstName lastName');

        if (!shipment) {
            return res.status(404).json({ 
                success: false, 
                message: 'Shipment not found' 
            });
        }

        // ✅ Status validation
        const validStatuses = [
            'pending', 'picked_up_from_warehouse', 'departed_port_of_origin',
            'in_transit', 'arrived_at_destination_port', 'customs_cleared',
            'out_for_delivery', 'delivered', 'completed', 'cancelled'
        ];

        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: `Invalid status: ${status}`
            });
        }

        // ✅ Add milestone with proper logging
        shipment.milestones.push({
            status,
            location: location || shipment.currentLocation,
            description: description || `Status updated to ${status}`,
            updatedBy: req.user._id,
            timestamp: new Date()
        });
        
        // ✅ Update status
        shipment.status = status;
        shipment.currentMilestone = status;
        shipment.updatedBy = req.user._id;

        // ✅ Update specific fields based on status
        switch(status) {
            case 'arrived_at_destination_port':
                shipment.transport = {
                    ...shipment.transport,
                    actualArrival: new Date(),
                    currentLocation: {
                        location: location || shipment.shipmentDetails?.destination,
                        status: status,
                        timestamp: new Date()
                    }
                };
                console.log('✅ Shipment arrived at destination port:', shipment.trackingNumber);
                break;
                
            case 'customs_cleared':
                console.log('✅ Customs cleared for:', shipment.trackingNumber);
                break;
                
            case 'out_for_delivery':
                console.log('✅ Shipment out for delivery:', shipment.trackingNumber);
                break;
                
            case 'delivered':
            case 'completed':
                shipment.dates = {
                    ...shipment.dates,
                    delivered: new Date()
                };
                shipment.courier = {
                    ...shipment.courier,
                    actualDeliveryDate: new Date()
                };
                console.log('✅ Shipment delivered:', shipment.trackingNumber);
                break;
        }

        await shipment.save();
        
        // ✅ Log for debugging
        console.log(`✅ Status updated: ${shipment.trackingNumber} -> ${status}`);

        // Notify customer if requested
        if (notifyCustomer && shipment.customerId?.email) {
            sendEmail({
                to: shipment.customerId.email,
                subject: `🚚 Shipment Update: ${status.replace(/_/g, ' ')}`,
                template: 'shipment-status-update',
                data: {
                    customerName: shipment.customerId.firstName || 'Customer',
                    trackingNumber: shipment.trackingNumber,
                    status: status.replace(/_/g, ' '),
                    location: location || 'Unknown',
                    description: description || '',
                    trackingUrl: `${process.env.FRONTEND_URL}/tracking/${shipment.trackingNumber}`
                }
            }).catch(err => console.log('Status update email error:', err.message));
        }

        res.status(200).json({
            success: true,
            message: 'Shipment status updated',
            data: {
                status: shipment.status,
                currentMilestone: shipment.currentMilestone,
                milestones: shipment.milestones
            }
        });

    } catch (error) {
        console.error('Error in updateShipmentStatus:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 7. ASSIGN SHIPMENT TO STAFF ==========
exports.assignShipment = async (req, res) => {
    try {
        const { id } = req.params;
        const { staffId } = req.body;

        const shipment = await Shipment.findById(id);
        if (!shipment) {
            return res.status(404).json({ 
                success: false, 
                message: 'Shipment not found' 
            });
        }

        const staff = await User.findById(staffId);
        if (!staff) {
            return res.status(404).json({ 
                success: false, 
                message: 'Staff not found' 
            });
        }

        shipment.assignedTo = staffId;
        shipment.updatedBy = req.user._id;

        shipment.addMilestone(
            shipment.status,
            'System',
            `Assigned to ${staff.firstName} ${staff.lastName}`,
            req.user._id
        );

        await shipment.save();

        // Notify staff
        sendEmail({
            to: staff.email,
            subject: '📋 New Shipment Assigned to You',
            template: 'shipment-assigned',
            data: {
                staffName: staff.firstName,
                trackingNumber: shipment.trackingNumber,
                customerName: shipment.customerId?.companyName || 'Customer',
                shipmentUrl: `${process.env.FRONTEND_URL}/operations/shipments/${shipment._id}`
            }
        }).catch(err => console.log('Assignment email error:', err.message));

        res.status(200).json({
            success: true,
            message: 'Shipment assigned successfully',
            data: {
                assignedTo: {
                    _id: staff._id,
                    name: `${staff.firstName} ${staff.lastName}`
                }
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 8. ADD TRACKING UPDATE ==========
exports.addTrackingUpdate = async (req, res) => {
    try {
        const { id } = req.params;
        const { location, status, description } = req.body;

        const shipment = await Shipment.findById(id);
        if (!shipment) {
            return res.status(404).json({ 
                success: false, 
                message: 'Shipment not found' 
            });
        }

        shipment.addTrackingUpdate(location, status, description, req.user._id);

        // Update current location
        if (shipment.transport) {
            shipment.transport.currentLocation = {
                address: location,
                lastUpdated: new Date()
            };
        }

        await shipment.save();

        // Get the latest update
        const latestUpdate = shipment.trackingUpdates[shipment.trackingUpdates.length - 1];

        res.status(200).json({
            success: true,
            message: 'Tracking update added',
            data: latestUpdate
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 9. GET SHIPMENT TIMELINE ==========
exports.getShipmentTimeline = async (req, res) => {
    try {
        const { id } = req.params;

        const shipment = await Shipment.findById(id)
            .select('trackingNumber milestones trackingUpdates status');

        if (!shipment) {
            return res.status(404).json({ 
                success: false, 
                message: 'Shipment not found' 
            });
        }

        // Combine milestones and tracking updates
        const timeline = [
            ...shipment.milestones.map(m => ({
                type: 'milestone',
                status: m.status,
                location: m.location,
                description: m.description,
                timestamp: m.timestamp,
                updatedBy: m.updatedBy
            })),
            ...shipment.trackingUpdates.map(t => ({
                type: 'tracking',
                status: t.status,
                location: t.location,
                description: t.description,
                timestamp: t.timestamp,
                updatedBy: t.createdBy
            }))
        ].sort((a, b) => b.timestamp - a.timestamp);

        res.status(200).json({
            success: true,
            data: {
                trackingNumber: shipment.trackingNumber,
                currentStatus: shipment.status,
                timeline
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 10. UPDATE TRANSPORT DETAILS ==========
exports.updateTransportDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const transportData = req.body;

        const shipment = await Shipment.findById(id);
        if (!shipment) {
            return res.status(404).json({ 
                success: false, 
                message: 'Shipment not found' 
            });
        }

        shipment.transport = {
            ...shipment.transport,
            ...transportData
        };

        shipment.updatedBy = req.user._id;

        // If estimated arrival is set, add to milestones
        if (transportData.estimatedArrival) {
            shipment.addMilestone(
                'in_transit',
                transportData.currentLocation?.address || 'Unknown',
                `Estimated arrival: ${new Date(transportData.estimatedArrival).toLocaleDateString()}`,
                req.user._id
            );
        }

        await shipment.save();

        res.status(200).json({
            success: true,
            message: 'Transport details updated',
            data: shipment.transport
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 11. ADD DOCUMENT TO SHIPMENT ==========
exports.addDocument = async (req, res) => {
    try {
        const { id } = req.params;
        const { documentId, documentType } = req.body;

        const shipment = await Shipment.findById(id);
        if (!shipment) {
            return res.status(404).json({ 
                success: false, 
                message: 'Shipment not found' 
            });
        }

        if (!shipment.documents) {
            shipment.documents = [];
        }

        shipment.documents.push(documentId);
        shipment.updatedBy = req.user._id;

        await shipment.save();

        res.status(200).json({
            success: true,
            message: 'Document added to shipment',
            data: {
                documents: shipment.documents
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 12. ADD INTERNAL NOTE ==========
exports.addInternalNote = async (req, res) => {
    try {
        const { id } = req.params;
        const { note } = req.body;

        const shipment = await Shipment.findById(id);
        if (!shipment) {
            return res.status(404).json({ 
                success: false, 
                message: 'Shipment not found' 
            });
        }

        if (!shipment.internalNotes) {
            shipment.internalNotes = [];
        }

        shipment.internalNotes.push({
            note,
            createdBy: req.user._id,
            createdAt: new Date()
        });

        shipment.updatedBy = req.user._id;
        await shipment.save();

        res.status(200).json({
            success: true,
            message: 'Internal note added',
            data: shipment.internalNotes
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 13. ADD CUSTOMER NOTE ==========
exports.addCustomerNote = async (req, res) => {
    try {
        const { id } = req.params;
        const { note } = req.body;

        const shipment = await Shipment.findById(id);
        if (!shipment) {
            return res.status(404).json({ 
                success: false, 
                message: 'Shipment not found' 
            });
        }

        if (!shipment.customerNotes) {
            shipment.customerNotes = [];
        }

        shipment.customerNotes.push({
            note,
            createdBy: req.user._id,
            createdAt: new Date()
        });

        shipment.updatedBy = req.user._id;
        await shipment.save();

        res.status(200).json({
            success: true,
            message: 'Customer note added',
            data: shipment.customerNotes
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 14. CANCEL SHIPMENT ==========
exports.cancelShipment = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const shipment = await Shipment.findById(id)
            .populate('customerId', 'email firstName lastName');

        if (!shipment) {
            return res.status(404).json({ 
                success: false, 
                message: 'Shipment not found' 
            });
        }

        // Check if shipment can be cancelled
        if (['delivered', 'cancelled'].includes(shipment.status)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot cancel shipment in current status' 
            });
        }

        shipment.status = 'cancelled';
        shipment.cancelledAt = new Date();
        shipment.cancellationReason = reason;
        shipment.updatedBy = req.user._id;

        shipment.addMilestone(
            'cancelled',
            'System',
            `Shipment cancelled. Reason: ${reason || 'Not specified'}`,
            req.user._id
        );

        await shipment.save();

        // Notify customer
        if (shipment.customerId) {
            sendEmail({
                to: shipment.customerId.email,
                subject: '❌ Shipment Cancelled',
                template: 'shipment-cancelled',
                data: {
                    customerName: shipment.customerId.firstName,
                    trackingNumber: shipment.trackingNumber,
                    reason: reason || 'No reason provided',
                    dashboardUrl: `${process.env.FRONTEND_URL}/customer/dashboard`
                }
            }).catch(err => console.log('Cancellation email error:', err.message));
        }

        res.status(200).json({
            success: true,
            message: 'Shipment cancelled successfully',
            data: shipment
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 15. ADD COST TO SHIPMENT ==========
exports.addCost = async (req, res) => {
    try {
        const { id } = req.params;
        const { type, amount, currency, description, vendor } = req.body;

        const shipment = await Shipment.findById(id);
        if (!shipment) {
            return res.status(404).json({ 
                success: false, 
                message: 'Shipment not found' 
            });
        }

        if (!shipment.costs) {
            shipment.costs = [];
        }

        shipment.costs.push({
            type,
            amount,
            currency: currency || 'USD',
            description,
            vendor,
            incurredBy: req.user._id,
            incurredAt: new Date()
        });

        shipment.updatedBy = req.user._id;
        await shipment.save();

        res.status(200).json({
            success: true,
            message: 'Cost added to shipment',
            data: shipment.costs
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 16. GET SHIPMENT COSTS ==========
exports.getShipmentCosts = async (req, res) => {
    try {
        const { id } = req.params;

        const shipment = await Shipment.findById(id)
            .select('costs trackingNumber');

        if (!shipment) {
            return res.status(404).json({ 
                success: false, 
                message: 'Shipment not found' 
            });
        }

        // Calculate totals
        const totalCost = (shipment.costs || []).reduce((sum, cost) => sum + (cost.amount || 0), 0);

        res.status(200).json({
            success: true,
            data: {
                trackingNumber: shipment.trackingNumber,
                costs: shipment.costs || [],
                totalCost
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 17. UPDATE COST ==========
exports.updateCost = async (req, res) => {
    try {
        const { id, costId } = req.params;
        const updateData = req.body;

        const shipment = await Shipment.findById(id);
        if (!shipment) {
            return res.status(404).json({ 
                success: false, 
                message: 'Shipment not found' 
            });
        }

        const costIndex = shipment.costs.findIndex(c => c._id.toString() === costId);
        if (costIndex === -1) {
            return res.status(404).json({ 
                success: false, 
                message: 'Cost not found' 
            });
        }

        // Update cost
        Object.assign(shipment.costs[costIndex], updateData);
        shipment.updatedBy = req.user._id;
        await shipment.save();

        res.status(200).json({
            success: true,
            message: 'Cost updated successfully',
            data: shipment.costs[costIndex]
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 18. DELETE COST ==========
exports.deleteCost = async (req, res) => {
    try {
        const { id, costId } = req.params;

        const shipment = await Shipment.findById(id);
        if (!shipment) {
            return res.status(404).json({ 
                success: false, 
                message: 'Shipment not found' 
            });
        }

        shipment.costs = shipment.costs.filter(c => c._id.toString() !== costId);
        shipment.updatedBy = req.user._id;
        await shipment.save();

        res.status(200).json({
            success: true,
            message: 'Cost deleted successfully'
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 19. GET PENDING WAREHOUSE SHIPMENTS ==========
exports.getPendingWarehouseShipments = async (req, res) => {
    try {
        const shipments = await Shipment.find({
            status: { $in: ['pending', 'received_at_warehouse'] }
        })
        .populate('customerId', 'companyName firstName lastName')
        .populate('bookingId', 'bookingNumber')
        .sort('-createdAt');

        res.status(200).json({
            success: true,
            data: shipments
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 20. RECEIVE AT WAREHOUSE ==========
exports.receiveAtWarehouse = async (req, res) => {
    try {
        const { id } = req.params;
        const { location, notes } = req.body;

        const shipment = await Shipment.findById(id);
        if (!shipment) {
            return res.status(404).json({ 
                success: false, 
                message: 'Shipment not found' 
            });
        }

        shipment.status = 'received_at_warehouse';
        shipment.warehouseInfo = {
            ...shipment.warehouseInfo,
            receivedDate: new Date(),
            receivedBy: req.user._id,
            location,
            notes
        };

        shipment.addMilestone(
            'received_at_warehouse',
            location,
            `Shipment received at warehouse. ${notes || ''}`,
            req.user._id
        );

        shipment.updatedBy = req.user._id;
        await shipment.save();

        res.status(200).json({
            success: true,
            message: 'Shipment received at warehouse',
            data: shipment
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 21. PROCESS WAREHOUSE ==========
exports.processWarehouse = async (req, res) => {
    try {
        const { id } = req.params;
        const { action, notes } = req.body; // action: 'consolidate', 'pack', 'label'

        const shipment = await Shipment.findById(id);
        if (!shipment) {
            return res.status(404).json({ 
                success: false, 
                message: 'Shipment not found' 
            });
        }

        let status = shipment.status;
        let description = '';

        switch(action) {
            case 'consolidate':
                status = 'consolidation_in_progress';
                description = 'Consolidation in progress';
                break;
            case 'pack':
                status = 'ready_for_shipping';
                description = 'Packaging complete, ready for shipping';
                break;
            default:
                return res.status(400).json({ 
                    success: false, 
                    message: 'Invalid action' 
                });
        }

        shipment.status = status;
        shipment.addMilestone(
            status,
            shipment.warehouseInfo?.location || 'Warehouse',
            description + (notes ? ` - ${notes}` : ''),
            req.user._id
        );

        shipment.updatedBy = req.user._id;
        await shipment.save();

        res.status(200).json({
            success: true,
            message: 'Warehouse processing updated',
            data: shipment
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 22. GET SHIPMENT STATISTICS (Dashboard) ==========
exports.getShipmentStatistics = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        let dateFilter = {};
        if (startDate && endDate) {
            dateFilter = {
                createdAt: {
                    $gte: new Date(startDate),
                    $lte: new Date(endDate)
                }
            };
        }

        const statistics = await Shipment.aggregate([
            { $match: dateFilter },
            {
                $facet: {
                    totalStats: [
                        {
                            $group: {
                                _id: null,
                                totalShipments: { $sum: 1 },
                                totalDelivered: {
                                    $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
                                },
                                totalInTransit: {
                                    $sum: { $cond: [{ $eq: ['$status', 'in_transit'] }, 1, 0] }
                                },
                                totalPending: {
                                    $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
                                }
                            }
                        }
                    ],
                    byMode: [
                        {
                            $group: {
                                _id: '$shipmentDetails.shipmentType',
                                count: { $sum: 1 }
                            }
                        }
                    ],
                    byRoute: [
                        {
                            $group: {
                                _id: {
                                    origin: '$shipmentDetails.origin',
                                    destination: '$shipmentDetails.destination'
                                },
                                count: { $sum: 1 }
                            }
                        }
                    ],
                    monthlyTrend: [
                        {
                            $group: {
                                _id: {
                                    year: { $year: '$createdAt' },
                                    month: { $month: '$createdAt' }
                                },
                                count: { $sum: 1 }
                            }
                        },
                        { $sort: { '_id.year': -1, '_id.month': -1 } },
                        { $limit: 6 }
                    ]
                }
            }
        ]);

        res.status(200).json({
            success: true,
            data: statistics[0] || {
                totalStats: [],
                byMode: [],
                byRoute: [],
                monthlyTrend: []
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 23. TRACK BY NUMBER (Public) ========== 

exports.trackByNumber = async (req, res) => {
    try {
        const { trackingNumber } = req.params;

        const shipment = await Shipment.findOne({ trackingNumber })
            .populate('customerId', 'companyName firstName lastName')
            .select('trackingNumber status milestones trackingUpdates currentMilestone transport packages shipmentDetails actualDeliveryDate sender receiver estimatedDepartureDate estimatedArrivalDate');

        if (!shipment) {
            return res.status(404).json({ 
                success: false, 
                message: 'Shipment not found' 
            });
        }

        // ✅ Check if shipment has arrived at destination
        const hasArrivedAtDestination = shipment.milestones?.some(m => 
            m.status === 'arrived_at_destination_port' || 
            m.status === 'arrived'
        ) || shipment.status === 'arrived_at_destination_port';

        // ✅ Check if customs cleared
        const customsCleared = shipment.milestones?.some(m => 
            m.status === 'customs_cleared'
        ) || shipment.status === 'customs_cleared';

        // ✅ Check if out for delivery
        const outForDelivery = shipment.milestones?.some(m => 
            m.status === 'out_for_delivery'
        ) || shipment.status === 'out_for_delivery';

        // ✅ Check if delivered
        const isDelivered = shipment.milestones?.some(m => 
            m.status === 'delivered' || m.status === 'completed'
        ) || shipment.status === 'delivered' || shipment.status === 'completed';

        const destination = shipment.shipmentDetails?.destination || 
                           shipment.receiver?.address?.country || 
                           'UK';

        // ✅ Get all milestones sorted
        const sortedMilestones = [...(shipment.milestones || [])]
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        // ✅ Determine current location based on latest milestone
        let currentLocation = 'In Transit';
        let currentStatus = shipment.status;

        if (isDelivered) {
            currentLocation = destination;
            currentStatus = 'delivered';
        } 
        else if (outForDelivery) {
            currentLocation = destination;
            currentStatus = 'out_for_delivery';
        }
        else if (customsCleared && hasArrivedAtDestination) {
            currentLocation = destination;
            currentStatus = 'customs_cleared';
        }
        else if (hasArrivedAtDestination) {
            currentLocation = destination;
            currentStatus = 'arrived_at_destination_port';
        }
        else if (sortedMilestones.length > 0) {
            currentLocation = sortedMilestones[0].location || 'In Transit';
            currentStatus = sortedMilestones[0].status;
        }

        // ✅ Format timeline
        const timeline = sortedMilestones.map(m => {
            let location = m.location;
            
            if (m.status === 'delivered' || m.status === 'completed') {
                location = destination;
            }
            else if (m.status === 'out_for_delivery') {
                location = destination;
            }
            else if (m.status === 'customs_cleared' && hasArrivedAtDestination) {
                location = destination;
            }
            else if (m.status === 'arrived_at_destination_port') {
                location = destination;
            }
            
            return {
                type: 'milestone',
                status: m.status,
                location: location,
                description: m.description,
                timestamp: m.timestamp,
                formattedDate: m.timestamp ? new Date(m.timestamp).toLocaleString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                }) : null
            };
        });

        // ✅ Calculate accurate progress
        const calculateProgress = (status, milestones) => {
            const progressMap = {
                'pending': 10,
                'picked_up_from_warehouse': 20,
                'departed_port_of_origin': 40,
                'in_transit': 50,
                'arrived_at_destination_port': 70,
                'customs_cleared': 80,
                'out_for_delivery': 90,
                'delivered': 100,
                'completed': 100
            };
            
            // Get highest progress from milestones
            let maxProgress = 0;
            for (const m of milestones) {
                const progress = progressMap[m.status] || 0;
                if (progress > maxProgress) {
                    maxProgress = progress;
                }
            }
            
            // Return highest progress, default to status-based if none found
            return maxProgress > 0 ? maxProgress : (progressMap[status] || 0);
        };

        const progress = calculateProgress(shipment.status, shipment.milestones || []);

        res.status(200).json({
            success: true,
            data: {
                trackingNumber: shipment.trackingNumber,
                status: currentStatus,
                currentLocation: currentLocation,
                origin: shipment.shipmentDetails?.origin || shipment.sender?.address?.country || 'China Warehouse',
                destination: destination,
                estimatedDeparture: shipment.estimatedDepartureDate,
                estimatedArrival: shipment.transport?.estimatedArrival || shipment.estimatedArrivalDate,
                actualDelivery: shipment.actualDeliveryDate,
                timeline: timeline,
                progress: progress,
                sender: {
                    name: shipment.sender?.name,
                    country: shipment.sender?.address?.country
                },
                receiver: {
                    name: shipment.receiver?.name,
                    country: shipment.receiver?.address?.country
                },
                packages: (shipment.packages || []).map(pkg => ({
                    id: pkg._id,
                    description: pkg.description,
                    type: pkg.packagingType || pkg.packageType,
                    quantity: pkg.quantity,
                    weight: pkg.weight,
                    volume: pkg.volume,
                    dimensions: pkg.dimensions,
                    hazardous: pkg.hazardous
                }))
            }
        });

    } catch (error) {
        console.error('Track by number error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== HELPER FUNCTIONS ==========

// Generate shipment number
const generateShipmentNumber = async () => {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    
    const count = await Shipment.countDocuments({
        shipmentNumber: new RegExp(`^SHP-${year}${month}`)
    });
    
    return `SHP-${year}${month}-${(count + 1).toString().padStart(5, '0')}`;
};

// Generate tracking number (random version - recommended)
const generateTrackingNumber = async () => {
    const prefix = 'CLC';
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const numbers = '23456789';
    
    let trackingNumber;
    let exists = true;
    let attempts = 0;
    
    while (exists && attempts < 10) {
        trackingNumber = prefix;
        
        // 2 letters
        for (let i = 0; i < 2; i++) {
            trackingNumber += letters[Math.floor(Math.random() * letters.length)];
        }
        
        // 4 numbers
        for (let i = 0; i < 4; i++) {
            trackingNumber += numbers[Math.floor(Math.random() * numbers.length)];
        }
        
        // 2 letters
        for (let i = 0; i < 2; i++) {
            trackingNumber += letters[Math.floor(Math.random() * letters.length)];
        }
        
        const existing = await Shipment.findOne({ trackingNumber });
        exists = !!existing;
        attempts++;
    }
    
    return trackingNumber || `CLC${Date.now().toString().slice(-8)}`;
};

// Tracking number generator (serial version - if you prefer)
const generateSerialTrackingNumber = async () => {
    const latestShipment = await Shipment.findOne({
        trackingNumber: { $regex: '^CLC' }
    }).sort({ trackingNumber: -1 });
    
    let nextNumber = 1;
    let nextChar = 'A';
    
    if (latestShipment && latestShipment.trackingNumber) {
        const lastNumber = parseInt(latestShipment.trackingNumber.substring(3, 7));
        const lastChar = latestShipment.trackingNumber.substring(7, 8);
        
        if (lastChar === 'Z') {
            nextNumber = lastNumber + 1;
            nextChar = 'A';
        } else {
            nextNumber = lastNumber;
            nextChar = String.fromCharCode(lastChar.charCodeAt(0) + 1);
        }
    }
    
    const formattedNumber = nextNumber.toString().padStart(4, '0');
    return `CLC${formattedNumber}${nextChar}`;
};
// controllers/shipmentController.js - নতুন ফাংশন যোগ করুন

exports.updateShipmentTrackingNumber = async (req, res) => {
    try {
        const { id } = req.params;
        const { trackingNumber } = req.body;

        if (!trackingNumber) {
            return res.status(400).json({
                success: false,
                message: 'Tracking number is required'
            });
        }

        const shipment = await Shipment.findByIdAndUpdate(
            id,
            { 
                trackingNumber: trackingNumber,
                updatedBy: req.user._id 
            },
            { new: true }
        );

        if (!shipment) {
            return res.status(404).json({ 
                success: false, 
                message: 'Shipment not found' 
            });
        }

        res.status(200).json({
            success: true,
            message: 'Tracking number updated successfully',
            data: shipment
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
// new
// ========== 24. REQUEST RETURN (Customer) ==========
exports.requestReturn = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason, description, images } = req.body;

        // Find shipment
        const shipment = await Shipment.findOne({
            _id: id,
            customerId: req.user._id
        });

        if (!shipment) {
            return res.status(404).json({
                success: false,
                message: 'Shipment not found or access denied'
            });
        }

        // Check if shipment is eligible for return
        const eligibleStatuses = ['delivered', 'completed'];
        if (!eligibleStatuses.includes(shipment.status)) {
            return res.status(400).json({
                success: false,
                message: `Shipment cannot be returned. Current status: ${shipment.status}. Only delivered/completed shipments can be returned.`
            });
        }

        // Check if return already requested
        if (shipment.returnRequest && shipment.returnRequest.status !== 'none') {
            return res.status(400).json({
                success: false,
                message: `Return already ${shipment.returnRequest.status}. Please wait for admin response.`
            });
        }

        // Check delivery date (within 14 days)
        const deliveryDate = shipment.dates?.delivered || shipment.actualDeliveryDate;
        if (deliveryDate) {
            const daysSinceDelivery = Math.floor((Date.now() - new Date(deliveryDate)) / (1000 * 60 * 60 * 24));
            if (daysSinceDelivery > 14) {
                return res.status(400).json({
                    success: false,
                    message: `Return period expired. You can only request return within 14 days of delivery. Days passed: ${daysSinceDelivery}`
                });
            }
        }

        // Create return request
        shipment.returnRequest = {
            requestedBy: req.user._id,
            requestedAt: new Date(),
            status: 'pending',
            reason: reason,
            description: description,
            images: images || []
        };

        // Add milestone
        shipment.milestones = shipment.milestones || [];
        shipment.milestones.push({
            status: 'return_requested',
            location: shipment.shipmentDetails?.destination || 'Customer Location',
            description: `Return requested by customer. Reason: ${reason}`,
            updatedBy: req.user._id,
            timestamp: new Date()
        });

        await shipment.save();

        // Notify admins
        const admins = await User.find({ role: 'admin', isActive: true });
        const adminEmails = admins.map(a => a.email);
        
        if (adminEmails.length > 0) {
            await sendEmail({
                to: adminEmails,
                subject: `🔄 Return Request - ${shipment.trackingNumber}`,
                template: 'return-request-admin',
                data: {
                    trackingNumber: shipment.trackingNumber,
                    customerName: req.user.firstName || 'Customer',
                    reason: reason,
                    description: description,
                    requestDate: new Date().toLocaleString(),
                    shipmentUrl: `${process.env.FRONTEND_URL}/admin/shipments/${shipment._id}`,
                    daysSinceDelivery: deliveryDate ? Math.floor((Date.now() - new Date(deliveryDate)) / (1000 * 60 * 60 * 24)) : 'Unknown'
                }
            }).catch(err => console.log('Admin notification error:', err.message));
        }

        res.status(200).json({
            success: true,
            message: 'Return request submitted successfully. Admin will review and notify you.',
            data: {
                returnRequest: shipment.returnRequest,
                trackingNumber: shipment.trackingNumber
            }
        });

    } catch (error) {
        console.error('Request return error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 25. GET RETURN REQUEST STATUS (Customer) ==========
exports.getReturnRequestStatus = async (req, res) => {
    try {
        const { id } = req.params;

        const shipment = await Shipment.findOne({
            _id: id,
            customerId: req.user._id
        }).select('trackingNumber returnRequest status');

        if (!shipment) {
            return res.status(404).json({
                success: false,
                message: 'Shipment not found'
            });
        }

        res.status(200).json({
            success: true,
            data: {
                trackingNumber: shipment.trackingNumber,
                shipmentStatus: shipment.status,
                returnRequest: shipment.returnRequest || { status: 'none' }
            }
        });

    } catch (error) {
        console.error('Get return status error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 26. GET ALL RETURN REQUESTS (Admin) ==========
exports.getAllReturnRequests = async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;

        let query = { 'returnRequest.status': { $ne: 'none' } };
        if (status) query['returnRequest.status'] = status;

        const shipments = await Shipment.find(query)
            .populate('customerId', 'firstName lastName email phone')
            .populate('returnRequest.requestedBy', 'firstName lastName email')
            .populate('returnRequest.approvedBy', 'firstName lastName email')
            .sort({ 'returnRequest.requestedAt': -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit));

        const total = await Shipment.countDocuments(query);

        // Summary
        const summary = await Shipment.aggregate([
            { $match: { 'returnRequest.status': { $ne: 'none' } } },
            { $group: {
                _id: '$returnRequest.status',
                count: { $sum: 1 }
            }}
        ]);

        res.status(200).json({
            success: true,
            data: shipments,
            summary,
            pagination: {
                total,
                page: parseInt(page),
                pages: Math.ceil(total / parseInt(limit))
            }
        });

    } catch (error) {
        console.error('Get return requests error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 27. APPROVE RETURN REQUEST (Admin) ==========
exports.approveReturnRequest = async (req, res) => {
    try {
        const { id } = req.params;
        const { returnTrackingNumber, notes } = req.body;

        const shipment = await Shipment.findById(id)
            .populate('customerId', 'email firstName lastName');

        if (!shipment) {
            return res.status(404).json({
                success: false,
                message: 'Shipment not found'
            });
        }

        if (!shipment.returnRequest || shipment.returnRequest.status !== 'pending') {
            return res.status(400).json({
                success: false,
                message: 'No pending return request found'
            });
        }

        // Update return request
        shipment.returnRequest.status = 'approved';
        shipment.returnRequest.approvedBy = req.user._id;
        shipment.returnRequest.approvedAt = new Date();
        shipment.returnRequest.returnTrackingNumber = returnTrackingNumber;
        shipment.returnRequest.returnNotes = notes;

        // Update shipment status
        shipment.status = 'return_initiated';

        // Add milestone
        shipment.milestones.push({
            status: 'return_approved',
            location: 'System',
            description: `Return request approved. Return tracking: ${returnTrackingNumber || 'To be provided'}. ${notes || ''}`,
            updatedBy: req.user._id,
            timestamp: new Date()
        });

        await shipment.save();

        // Notify customer
        if (shipment.customerId?.email) {
            await sendEmail({
                to: shipment.customerId.email,
                subject: `✅ Return Request Approved - ${shipment.trackingNumber}`,
                template: 'return-approved-customer',
                data: {
                    customerName: shipment.customerId.firstName || 'Customer',
                    trackingNumber: shipment.trackingNumber,
                    returnTrackingNumber: returnTrackingNumber || 'Will be provided soon',
                    notes: notes || '',
                    returnInstructions: 'Please pack the items securely and wait for pickup. You will receive a return shipping label via email.',
                    dashboardUrl: `${process.env.FRONTEND_URL}/customer/shipments/${shipment._id}`
                }
            }).catch(err => console.log('Customer notification error:', err.message));
        }

        res.status(200).json({
            success: true,
            message: 'Return request approved successfully',
            data: shipment.returnRequest
        });

    } catch (error) {
        console.error('Approve return error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 28. REJECT RETURN REQUEST (Admin) ==========
exports.rejectReturnRequest = async (req, res) => {
    try {
        const { id } = req.params;
        const { rejectionReason } = req.body;

        if (!rejectionReason) {
            return res.status(400).json({
                success: false,
                message: 'Rejection reason is required'
            });
        }

        const shipment = await Shipment.findById(id)
            .populate('customerId', 'email firstName lastName');

        if (!shipment) {
            return res.status(404).json({
                success: false,
                message: 'Shipment not found'
            });
        }

        if (!shipment.returnRequest || shipment.returnRequest.status !== 'pending') {
            return res.status(400).json({
                success: false,
                message: 'No pending return request found'
            });
        }

        // Update return request
        shipment.returnRequest.status = 'rejected';
        shipment.returnRequest.rejectionReason = rejectionReason;
        shipment.returnRequest.approvedBy = req.user._id;
        shipment.returnRequest.approvedAt = new Date();

        // Add milestone
        shipment.milestones.push({
            status: 'return_rejected',
            location: 'System',
            description: `Return request rejected. Reason: ${rejectionReason}`,
            updatedBy: req.user._id,
            timestamp: new Date()
        });

        await shipment.save();

        // Notify customer
        if (shipment.customerId?.email) {
            await sendEmail({
                to: shipment.customerId.email,
                subject: `❌ Return Request Rejected - ${shipment.trackingNumber}`,
                template: 'return-rejected-customer',
                data: {
                    customerName: shipment.customerId.firstName || 'Customer',
                    trackingNumber: shipment.trackingNumber,
                    rejectionReason: rejectionReason,
                    supportEmail: process.env.SUPPORT_EMAIL || 'support@cargologistics.com'
                }
            }).catch(err => console.log('Customer notification error:', err.message));
        }

        res.status(200).json({
            success: true,
            message: 'Return request rejected',
            data: shipment.returnRequest
        });

    } catch (error) {
        console.error('Reject return error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 29. MARK RETURN AS COMPLETED (Admin) ==========
exports.completeReturn = async (req, res) => {
    try {
        const { id } = req.params;
        const { notes } = req.body;

        const shipment = await Shipment.findById(id)
            .populate('customerId', 'email firstName lastName');

        if (!shipment) {
            return res.status(404).json({
                success: false,
                message: 'Shipment not found'
            });
        }

        if (!shipment.returnRequest || shipment.returnRequest.status !== 'approved') {
            return res.status(400).json({
                success: false,
                message: 'Return request not in approved state'
            });
        }

        // Update return request
        shipment.returnRequest.status = 'completed';
        shipment.returnRequest.returnNotes = notes;

        // Update shipment status
        shipment.status = 'returned';

        // Add milestone
        shipment.milestones.push({
            status: 'return_completed',
            location: 'System',
            description: `Return process completed. ${notes || ''}`,
            updatedBy: req.user._id,
            timestamp: new Date()
        });

        await shipment.save();

        // Notify customer
        if (shipment.customerId?.email) {
            await sendEmail({
                to: shipment.customerId.email,
                subject: `✅ Return Completed - ${shipment.trackingNumber}`,
                template: 'return-completed-customer',
                data: {
                    customerName: shipment.customerId.firstName || 'Customer',
                    trackingNumber: shipment.trackingNumber,
                    notes: notes || 'Return process completed successfully.',
                    dashboardUrl: `${process.env.FRONTEND_URL}/customer/shipments/${shipment._id}`
                }
            }).catch(err => console.log('Customer notification error:', err.message));
        }

        res.status(200).json({
            success: true,
            message: 'Return completed successfully',
            data: shipment.returnRequest
        });

    } catch (error) {
        console.error('Complete return error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};