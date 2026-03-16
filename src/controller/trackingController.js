// controllers/trackingController.js - সম্পূর্ণ আপডেটেড ভার্সন

const Shipment = require('../models/shipmentModel');
const Booking = require('../models/bookingModel');
const Consolidation = require('../models/consolidationModel');
const User = require('../models/userModel');
const { sendEmail } = require('../utils/emailService');

// ==================== HELPER FUNCTIONS ====================

const calculateProgress = (status) => {
    const order = [
        'pending',
        'booking_requested',
        'booking_confirmed',
        'picked_up_from_warehouse',
        'received_at_warehouse',
        'consolidated',
        'ready_for_dispatch',
        'loaded',
        'dispatched',
        'departed_port_of_origin',
        'in_transit_sea_freight',
        'arrived_at_destination_port',
        'arrived',
        'customs_cleared',
        'out_for_delivery',
        'delivered',
        'completed'
    ];
    
    const index = order.indexOf(status);
    if (index === -1) return 0;
    return Math.round((index / (order.length - 1)) * 100);
};

const formatStatus = (status) => {
    if (!status) return 'Unknown';
    return status.split('_').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
};

const getStatusDescription = (status) => {
    const descriptions = {
        'pending': 'Shipment created and pending processing',
        'booking_requested': 'Booking request submitted',
        'price_quoted': 'Price quote sent to customer',
        'booking_confirmed': 'Booking confirmed by customer',
        'picked_up_from_warehouse': 'Package picked up from warehouse',
        'received_at_warehouse': 'Package received at warehouse',
        'consolidated': 'Shipment consolidated with other cargo',
        'consolidation_in_progress': 'Consolidation in progress',
        'consolidation_completed': 'Consolidation completed',
        'container_loaded': 'Container loaded and sealed',
        'container_dispatched': 'Container dispatched from warehouse',
        'departed_port_of_origin': 'Vessel/flight departed from origin port',
        'in_transit_sea_freight': 'Shipment in transit',
        'arrived_at_destination_port': 'Arrived at destination port',
        'customs_cleared': 'Customs clearance completed',
        'out_for_delivery': 'Out for delivery',
        'delivered': 'Successfully delivered',
        'on_hold': 'Shipment on hold',
        'cancelled': 'Shipment cancelled',
        'returned': 'Shipment returned to sender'
    };
    return descriptions[status] || `Status updated to ${formatStatus(status)}`;
};

const formatDate = (date) => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

// ==================== 1. GET ALL TRACKINGS (Admin Only) ====================
exports.getAllTrackings = async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 20, 
            status, 
            search,
            customerId,
            startDate,
            endDate,
            sort = '-createdAt' 
        } = req.query;

        console.log('📋 Admin fetching all trackings...');

        // Build filter query for shipments
        let shipmentFilter = {};
        let bookingFilter = {};

        if (status) {
            shipmentFilter.status = status;
            bookingFilter.status = status;
        }

        if (customerId) {
            shipmentFilter.customerId = customerId;
            bookingFilter.customer = customerId;
        }

        if (search) {
            const searchRegex = new RegExp(search, 'i');
            shipmentFilter.$or = [
                { trackingNumber: searchRegex },
                { shipmentNumber: searchRegex },
                { 'customerId.companyName': searchRegex }
            ];
            bookingFilter.$or = [
                { trackingNumber: searchRegex },
                { bookingNumber: searchRegex },
                { 'customer.companyName': searchRegex }
            ];
        }

        if (startDate || endDate) {
            const dateFilter = {};
            if (startDate) dateFilter.$gte = new Date(startDate);
            if (endDate) dateFilter.$lte = new Date(endDate);
            
            shipmentFilter.createdAt = dateFilter;
            bookingFilter.createdAt = dateFilter;
        }

        // Get shipments with pagination
        const shipments = await Shipment.find(shipmentFilter)
            .populate('customerId', 'firstName lastName companyName email phone')
            .populate('bookingId', 'bookingNumber')
            .populate('consolidationId', 'consolidationNumber containerNumber')
            .sort(sort)
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit))
            .lean();

        // Get bookings with pagination
        const bookings = await Booking.find(bookingFilter)
            .populate('customer', 'firstName lastName companyName email phone')
            .populate('shipmentId', 'shipmentNumber trackingNumber')
            .populate('invoiceId', 'invoiceNumber')
            .sort(sort)
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit))
            .lean();

        // Get total counts
        const totalShipments = await Shipment.countDocuments(shipmentFilter);
        const totalBookings = await Booking.countDocuments(bookingFilter);
        const total = totalShipments + totalBookings;

        // Combine and format results
        const trackings = [];

        // Format shipments
        shipments.forEach(s => {
            trackings.push({
                id: s._id,
                type: 'shipment',
                trackingNumber: s.trackingNumber,
                referenceNumber: s.shipmentNumber,
                bookingNumber: s.bookingId?.bookingNumber,
                consolidationNumber: s.consolidationId?.consolidationNumber,
                containerNumber: s.consolidationId?.containerNumber,
                status: s.status,
                statusDisplay: formatStatus(s.status),
                progress: calculateProgress(s.status),
                origin: s.shipmentDetails?.origin || s.origin || 'N/A',
                destination: s.shipmentDetails?.destination || s.destination || 'N/A',
                currentLocation: s.transport?.currentLocation?.location || 'N/A',
                customer: s.customerId ? {
                    id: s.customerId._id,
                    name: s.customerId.companyName || 
                          `${s.customerId.firstName || ''} ${s.customerId.lastName || ''}`.trim(),
                    email: s.customerId.email,
                    phone: s.customerId.phone
                } : null,
                totalPackages: s.shipmentDetails?.totalPackages || s.totalPackages || 0,
                totalWeight: s.shipmentDetails?.totalWeight || s.totalWeight || 0,
                totalVolume: s.shipmentDetails?.totalVolume || s.totalVolume || 0,
                estimatedArrival: s.dates?.estimatedArrival || s.transport?.estimatedArrival,
                actualDelivery: s.dates?.delivered,
                lastUpdate: s.updatedAt,
                createdBy: s.createdBy,
                createdAt: s.createdAt
            });
        });

        // Format bookings
        bookings.forEach(b => {
            trackings.push({
                id: b._id,
                type: 'booking',
                trackingNumber: b.trackingNumber,
                referenceNumber: b.bookingNumber,
                shipmentNumber: b.shipmentId?.shipmentNumber,
                invoiceNumber: b.invoiceId?.invoiceNumber,
                status: b.status,
                statusDisplay: formatStatus(b.status),
                progress: calculateProgress(b.status),
                origin: b.shipmentDetails?.origin || 'N/A',
                destination: b.shipmentDetails?.destination || 'N/A',
                currentLocation: b.currentLocation?.location || 'N/A',
                customer: b.customer ? {
                    id: b.customer._id,
                    name: b.customer.companyName || 
                          `${b.customer.firstName || ''} ${b.customer.lastName || ''}`.trim(),
                    email: b.customer.email,
                    phone: b.customer.phone
                } : null,
                totalPackages: b.shipmentDetails?.totalPackages || 0,
                totalWeight: b.shipmentDetails?.totalWeight || 0,
                totalVolume: b.shipmentDetails?.totalVolume || 0,
                estimatedArrival: b.dates?.estimatedArrival,
                quotedPrice: b.quotedPrice,
                pricingStatus: b.pricingStatus,
                lastUpdate: b.updatedAt,
                createdAt: b.createdAt
            });
        });

        // Sort combined results
        trackings.sort((a, b) => new Date(b.lastUpdate) - new Date(a.lastUpdate));

        // Paginate combined results
        const startIndex = (parseInt(page) - 1) * parseInt(limit);
        const endIndex = startIndex + parseInt(limit);
        const paginatedTrackings = trackings.slice(startIndex, endIndex);

        // Calculate summary statistics
        const summary = {
            totalTrackings: total,
            totalShipments: totalShipments,
            totalBookings: totalBookings,
            
            // Status breakdown
            byStatus: await Shipment.aggregate([
                { $group: { _id: '$status', count: { $sum: 1 } } }
            ]),
            
            // Recent activity
            recentActivity: trackings.slice(0, 10).map(t => ({
                trackingNumber: t.trackingNumber,
                type: t.type,
                status: t.status,
                customer: t.customer?.name,
                time: t.lastUpdate
            })),
            
            // Delivery stats
            deliveredCount: await Shipment.countDocuments({ status: 'delivered' }),
            inTransitCount: await Shipment.countDocuments({ 
                status: { $in: ['in_transit_sea_freight', 'out_for_delivery'] } 
            }),
            pendingCount: await Shipment.countDocuments({ 
                status: { $in: ['pending', 'booking_confirmed'] } 
            })
        };

        res.status(200).json({
            success: true,
            message: 'Trackings fetched successfully',
            data: paginatedTrackings,
            summary,
            pagination: {
                total,
                page: parseInt(page),
                pages: Math.ceil(total / parseInt(limit)),
                limit: parseInt(limit),
                totalShipments,
                totalBookings
            }
        });

    } catch (error) {
        console.error('❌ Get all trackings error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// ==================== 2. GET TRACKING BY ID ====================
exports.getTrackingById = async (req, res) => {
    try {
        const { id } = req.params;
        const { type } = req.query;

        console.log(`🔍 Fetching tracking details for ${type}:`, id);

        let trackingData = null;

        if (type === 'shipment' || !type) {
            trackingData = await Shipment.findById(id)
                .populate('customerId', 'firstName lastName companyName email phone address')
                .populate('bookingId')
                .populate('consolidationId')
                .populate('createdBy', 'firstName lastName email')
                .populate('milestones.updatedBy', 'firstName lastName')
                .lean();

            if (trackingData) {
                trackingData.type = 'shipment';
                
                // Get timeline from milestones
                trackingData.timeline = (trackingData.milestones || []).map(m => ({
                    status: m.status,
                    location: m.location,
                    description: m.description,
                    date: m.timestamp,
                    formattedDate: formatDate(m.timestamp),
                    updatedBy: m.updatedBy,
                    source: 'shipment'
                }));

                // Get package details
                trackingData.packages = (trackingData.packages || []).map((pkg, index) => ({
                    id: index + 1,
                    description: pkg.description,
                    type: pkg.packagingType,
                    quantity: pkg.quantity,
                    weight: pkg.weight,
                    volume: pkg.volume,
                    dimensions: pkg.dimensions,
                    hazardous: pkg.hazardous,
                    temperatureControlled: pkg.temperatureControlled?.required
                }));
            }
        }

        if (type === 'booking' || (!trackingData && type !== 'shipment')) {
            trackingData = await Booking.findById(id)
                .populate('customer', 'firstName lastName companyName email phone address')
                .populate('quotedPrice.quotedBy', 'firstName lastName')
                .populate('shipmentId')
                .populate('invoiceId')
                .populate('timeline.updatedBy', 'firstName lastName')
                .lean();

            if (trackingData) {
                trackingData.type = 'booking';
                
                trackingData.timeline = (trackingData.timeline || []).map(t => ({
                    status: t.status,
                    location: t.location,
                    description: t.description,
                    date: t.timestamp,
                    formattedDate: formatDate(t.timestamp),
                    updatedBy: t.updatedBy,
                    source: 'booking'
                }));

                trackingData.packages = (trackingData.shipmentDetails?.packageDetails || []).map((pkg, index) => ({
                    id: index + 1,
                    description: pkg.description,
                    type: pkg.packagingType,
                    quantity: pkg.quantity,
                    weight: pkg.weight,
                    volume: pkg.volume,
                    dimensions: pkg.dimensions,
                    hazardous: pkg.hazardous,
                    temperatureControlled: pkg.temperatureControlled?.required
                }));
            }
        }

        if (!trackingData) {
            return res.status(404).json({
                success: false,
                message: 'Tracking not found'
            });
        }

        trackingData.progress = calculateProgress(trackingData.status);
        trackingData.statusDisplay = formatStatus(trackingData.status);
        
        if (trackingData.estimatedArrival) {
            const daysRemaining = Math.ceil(
                (new Date(trackingData.estimatedArrival) - new Date()) / (1000 * 60 * 60 * 24)
            );
            trackingData.daysRemaining = daysRemaining > 0 ? daysRemaining : 0;
        }

        res.status(200).json({
            success: true,
            data: trackingData
        });

    } catch (error) {
        console.error('❌ Get tracking by id error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// ==================== 3. UPDATE TRACKING STATUS ====================
exports.updateTrackingStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            type, 
            status, 
            location, 
            description,
            estimatedArrival,
            currentLocation 
        } = req.body;

        console.log(`📝 Updating ${type} status:`, { id, status, location });

        let updatedDoc = null;
        let previousStatus = '';

        if (type === 'shipment') {
            const shipment = await Shipment.findById(id);
            if (!shipment) {
                return res.status(404).json({
                    success: false,
                    message: 'Shipment not found'
                });
            }

            previousStatus = shipment.status;
            
            if (status) shipment.status = status;
            
            if (location || currentLocation) {
                shipment.transport = shipment.transport || {};
                shipment.transport.currentLocation = {
                    location: location || currentLocation,
                    updatedAt: new Date(),
                    updatedBy: req.user._id
                };
            }

            if (estimatedArrival) {
                shipment.dates = shipment.dates || {};
                shipment.dates.estimatedArrival = new Date(estimatedArrival);
            }

            shipment.milestones = shipment.milestones || [];
            shipment.milestones.push({
                status: status || shipment.status,
                location: location || currentLocation || 'Unknown',
                description: description || getStatusDescription(status || shipment.status),
                timestamp: new Date(),
                updatedBy: req.user._id
            });

            await shipment.save();
            updatedDoc = shipment;

        } else if (type === 'booking') {
            const booking = await Booking.findById(id);
            if (!booking) {
                return res.status(404).json({
                    success: false,
                    message: 'Booking not found'
                });
            }

            previousStatus = booking.status;
            
            if (status) {
                booking.status = status;
                
                if (status === 'delivered') {
                    booking.dates = booking.dates || {};
                    booking.dates.delivered = new Date();
                }
            }
            
            if (location || currentLocation) {
                booking.currentLocation = {
                    location: location || currentLocation,
                    updatedAt: new Date()
                };
            }

            if (estimatedArrival) {
                booking.dates = booking.dates || {};
                booking.dates.estimatedArrival = new Date(estimatedArrival);
            }

            booking.addTimelineEntry(
                status || booking.status,
                description || getStatusDescription(status || booking.status),
                req.user._id,
                { location: location || currentLocation }
            );

            await booking.save();
            updatedDoc = booking;

            if (status === 'delivered' && booking.shipmentId) {
                await Shipment.findByIdAndUpdate(booking.shipmentId, {
                    status: 'delivered',
                    $push: {
                        milestones: {
                            status: 'delivered',
                            location: location || 'Destination',
                            description: 'Shipment delivered successfully',
                            timestamp: new Date(),
                            updatedBy: req.user._id
                        }
                    }
                });
            }
        }

        if (!updatedDoc) {
            return res.status(400).json({
                success: false,
                message: 'Invalid tracking type or ID'
            });
        }

        try {
            const customerEmail = updatedDoc.customerId?.email || updatedDoc.customer?.email;
            const customerName = updatedDoc.customerId?.firstName || 
                                updatedDoc.customer?.firstName || 
                                'Customer';

            if (customerEmail) {
                await sendEmail({
                    to: customerEmail,
                    subject: `🚚 Tracking Update: ${updatedDoc.trackingNumber}`,
                    template: 'tracking-update',
                    data: {
                        customerName,
                        trackingNumber: updatedDoc.trackingNumber,
                        oldStatus: previousStatus,
                        newStatus: status || updatedDoc.status,
                        location: location || currentLocation,
                        description: description || getStatusDescription(status || updatedDoc.status),
                        trackingUrl: `${process.env.FRONTEND_URL}/tracking/${updatedDoc.trackingNumber}`,
                        estimatedArrival: estimatedArrival || updatedDoc.estimatedArrival
                    }
                });
            }
        } catch (emailError) {
            console.error('Email notification error:', emailError);
        }

        res.status(200).json({
            success: true,
            message: 'Tracking status updated successfully',
            data: {
                id: updatedDoc._id,
                type,
                trackingNumber: updatedDoc.trackingNumber,
                status: updatedDoc.status,
                location: location || currentLocation,
                estimatedArrival: estimatedArrival || updatedDoc.estimatedArrival,
                updatedAt: new Date()
            }
        });

    } catch (error) {
        console.error('❌ Update tracking status error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// ==================== 4. BULK UPDATE TRACKINGS ====================
exports.bulkUpdateTrackings = async (req, res) => {
    try {
        const { trackingIds, updateData } = req.body;

        if (!trackingIds || !Array.isArray(trackingIds) || trackingIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Please provide tracking IDs array'
            });
        }

        console.log(`📦 Bulk updating ${trackingIds.length} trackings`);

        const results = {
            shipments: [],
            bookings: [],
            failed: []
        };

        for (const item of trackingIds) {
            try {
                if (item.type === 'shipment') {
                    const shipment = await Shipment.findByIdAndUpdate(
                        item.id,
                        {
                            $set: {
                                status: updateData.status,
                                'transport.currentLocation': {
                                    location: updateData.location,
                                    updatedAt: new Date(),
                                    updatedBy: req.user._id
                                }
                            },
                            $push: {
                                milestones: {
                                    status: updateData.status,
                                    location: updateData.location,
                                    description: updateData.description || 
                                               getStatusDescription(updateData.status),
                                    timestamp: new Date(),
                                    updatedBy: req.user._id
                                }
                            }
                        },
                        { new: true }
                    );
                    
                    if (shipment) {
                        results.shipments.push({
                            id: shipment._id,
                            trackingNumber: shipment.trackingNumber,
                            status: shipment.status
                        });
                    }
                } 
                else if (item.type === 'booking') {
                    const booking = await Booking.findById(item.id);
                    
                    if (booking) {
                        booking.status = updateData.status;
                        booking.currentLocation = {
                            location: updateData.location,
                            updatedAt: new Date()
                        };
                        
                        booking.addTimelineEntry(
                            updateData.status,
                            updateData.description || getStatusDescription(updateData.status),
                            req.user._id,
                            { location: updateData.location }
                        );
                        
                        await booking.save();
                        
                        results.bookings.push({
                            id: booking._id,
                            trackingNumber: booking.trackingNumber,
                            status: booking.status
                        });
                    }
                }
            } catch (err) {
                results.failed.push({
                    id: item.id,
                    type: item.type,
                    error: err.message
                });
            }
        }

        res.status(200).json({
            success: true,
            message: `Updated ${results.shipments.length + results.bookings.length} trackings`,
            data: results
        });

    } catch (error) {
        console.error('❌ Bulk update error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// ==================== 5. DELETE TRACKING ====================
exports.deleteTracking = async (req, res) => {
    try {
        const { id } = req.params;
        const { type } = req.query;

        console.log(`🗑️ Deleting ${type} tracking:`, id);

        if (type === 'shipment') {
            const shipment = await Shipment.findById(id);
            
            if (!shipment) {
                return res.status(404).json({
                    success: false,
                    message: 'Shipment not found'
                });
            }

            if (!['pending', 'cancelled'].includes(shipment.status)) {
                return res.status(400).json({
                    success: false,
                    message: 'Only pending or cancelled shipments can be deleted'
                });
            }

            if (shipment.bookingId) {
                await Booking.findByIdAndUpdate(shipment.bookingId, {
                    $unset: { shipmentId: 1 }
                });
            }

            await Shipment.findByIdAndDelete(id);

        } else if (type === 'booking') {
            const booking = await Booking.findById(id);
            
            if (!booking) {
                return res.status(404).json({
                    success: false,
                    message: 'Booking not found'
                });
            }

            if (!['booking_requested', 'cancelled'].includes(booking.status)) {
                return res.status(400).json({
                    success: false,
                    message: 'Only requested or cancelled bookings can be deleted'
                });
            }

            if (booking.shipmentId) {
                await Shipment.findByIdAndDelete(booking.shipmentId);
            }

            await Booking.findByIdAndDelete(id);

        } else {
            return res.status(400).json({
                success: false,
                message: 'Invalid tracking type'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Tracking deleted successfully'
        });

    } catch (error) {
        console.error('❌ Delete tracking error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// ==================== 6. BULK DELETE TRACKINGS ====================
exports.bulkDeleteTrackings = async (req, res) => {
    try {
        const { trackingIds } = req.body;

        if (!trackingIds || !Array.isArray(trackingIds) || trackingIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Please provide tracking IDs array'
            });
        }

        console.log(`🗑️ Bulk deleting ${trackingIds.length} trackings`);

        const results = {
            deleted: [],
            failed: []
        };

        for (const item of trackingIds) {
            try {
                if (item.type === 'shipment') {
                    const shipment = await Shipment.findById(item.id);
                    
                    if (shipment && ['pending', 'cancelled'].includes(shipment.status)) {
                        if (shipment.bookingId) {
                            await Booking.findByIdAndUpdate(shipment.bookingId, {
                                $unset: { shipmentId: 1 }
                            });
                        }
                        
                        await Shipment.findByIdAndDelete(item.id);
                        results.deleted.push(item);
                    } else {
                        results.failed.push({
                            ...item,
                            reason: 'Shipment cannot be deleted in current status'
                        });
                    }
                } 
                else if (item.type === 'booking') {
                    const booking = await Booking.findById(item.id);
                    
                    if (booking && ['booking_requested', 'cancelled'].includes(booking.status)) {
                        if (booking.shipmentId) {
                            await Shipment.findByIdAndDelete(booking.shipmentId);
                        }
                        await Booking.findByIdAndDelete(item.id);
                        results.deleted.push(item);
                    } else {
                        results.failed.push({
                            ...item,
                            reason: 'Booking cannot be deleted in current status'
                        });
                    }
                }
            } catch (err) {
                results.failed.push({
                    ...item,
                    error: err.message
                });
            }
        }

        res.status(200).json({
            success: true,
            message: `Deleted ${results.deleted.length} trackings`,
            data: results
        });

    } catch (error) {
        console.error('❌ Bulk delete error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// ==================== 7. GET TRACKING STATS ====================
exports.getTrackingStats = async (req, res) => {
    try {
        console.log('📊 Generating tracking statistics...');

        const shipmentStats = await Shipment.aggregate([
            {
                $facet: {
                    byStatus: [
                        { $group: { _id: '$status', count: { $sum: 1 } } }
                    ],
                    byMonth: [
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
                        { $limit: 12 }
                    ],
                    deliveryPerformance: [
                        {
                            $match: { status: 'delivered' }
                        },
                        {
                            $project: {
                                deliveryTime: {
                                    $divide: [
                                        { $subtract: ['$dates.delivered', '$createdAt'] },
                                        1000 * 60 * 60 * 24
                                    ]
                                }
                            }
                        },
                        {
                            $group: {
                                _id: null,
                                avgDeliveryTime: { $avg: '$deliveryTime' },
                                minDeliveryTime: { $min: '$deliveryTime' },
                                maxDeliveryTime: { $max: '$deliveryTime' }
                            }
                        }
                    ],
                    totals: [
                        {
                            $group: {
                                _id: null,
                                totalShipments: { $sum: 1 },
                                totalWeight: { $sum: '$shipmentDetails.totalWeight' },
                                totalVolume: { $sum: '$shipmentDetails.totalVolume' }
                            }
                        }
                    ]
                }
            }
        ]);

        const bookingStats = await Booking.aggregate([
            {
                $facet: {
                    byStatus: [
                        { $group: { _id: '$status', count: { $sum: 1 } } }
                    ],
                    byPricingStatus: [
                        { $group: { _id: '$pricingStatus', count: { $sum: 1 } } }
                    ],
                    totals: [
                        { $group: { _id: null, totalBookings: { $sum: 1 } } }
                    ]
                }
            }
        ]);

        const recentActivity = await Shipment.find()
            .sort('-updatedAt')
            .limit(10)
            .populate('customerId', 'companyName firstName lastName')
            .select('trackingNumber status updatedAt customerId')
            .lean();

        const formattedActivity = recentActivity.map(a => ({
            trackingNumber: a.trackingNumber,
            status: a.status,
            customer: a.customerId?.companyName || 
                      `${a.customerId?.firstName || ''} ${a.customerId?.lastName || ''}`.trim(),
            time: a.updatedAt
        }));

        res.status(200).json({
            success: true,
            data: {
                shipments: shipmentStats[0] || {
                    byStatus: [],
                    byMonth: [],
                    deliveryPerformance: {},
                    totals: { totalShipments: 0, totalWeight: 0, totalVolume: 0 }
                },
                bookings: bookingStats[0] || {
                    byStatus: [],
                    byPricingStatus: [],
                    totals: { totalBookings: 0 }
                },
                recentActivity: formattedActivity,
                summary: {
                    totalActive: await Shipment.countDocuments({ 
                        status: { $nin: ['delivered', 'cancelled'] } 
                    }),
                    totalDelivered: await Shipment.countDocuments({ status: 'delivered' }),
                    totalInTransit: await Shipment.countDocuments({ 
                        status: { $in: ['in_transit_sea_freight', 'out_for_delivery'] } 
                    }),
                    totalPending: await Shipment.countDocuments({ 
                        status: { $in: ['pending', 'booking_confirmed'] } 
                    })
                }
            }
        });

    } catch (error) {
        console.error('❌ Get tracking stats error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// ==================== 8. SEARCH TRACKINGS ====================
exports.searchTrackings = async (req, res) => {
    try {
        const { q, type, status, customerId, startDate, endDate } = req.query;

        console.log('🔍 Searching trackings with query:', q);

        const searchRegex = new RegExp(q, 'i');
        let results = [];

        if (type === 'shipment' || !type) {
            const shipmentQuery = {
                $or: [
                    { trackingNumber: searchRegex },
                    { shipmentNumber: searchRegex },
                    { 'sender.name': searchRegex },
                    { 'sender.companyName': searchRegex },
                    { 'receiver.name': searchRegex },
                    { 'receiver.companyName': searchRegex }
                ]
            };

            if (status) shipmentQuery.status = status;
            if (customerId) shipmentQuery.customerId = customerId;
            if (startDate || endDate) {
                shipmentQuery.createdAt = {};
                if (startDate) shipmentQuery.createdAt.$gte = new Date(startDate);
                if (endDate) shipmentQuery.createdAt.$lte = new Date(endDate);
            }

            const shipments = await Shipment.find(shipmentQuery)
                .populate('customerId', 'companyName firstName lastName email')
                .limit(20)
                .lean();

            shipments.forEach(s => {
                results.push({
                    id: s._id,
                    type: 'shipment',
                    trackingNumber: s.trackingNumber,
                    referenceNumber: s.shipmentNumber,
                    status: s.status,
                    customer: s.customerId?.companyName || 
                              `${s.customerId?.firstName || ''} ${s.customerId?.lastName || ''}`.trim(),
                    origin: s.shipmentDetails?.origin,
                    destination: s.shipmentDetails?.destination,
                    lastUpdate: s.updatedAt
                });
            });
        }

        if (type === 'booking' || !type) {
            const bookingQuery = {
                $or: [
                    { trackingNumber: searchRegex },
                    { bookingNumber: searchRegex },
                    { 'sender.name': searchRegex },
                    { 'sender.companyName': searchRegex },
                    { 'receiver.name': searchRegex },
                    { 'receiver.companyName': searchRegex }
                ]
            };

            if (status) bookingQuery.status = status;
            if (customerId) bookingQuery.customer = customerId;
            if (startDate || endDate) {
                bookingQuery.createdAt = {};
                if (startDate) bookingQuery.createdAt.$gte = new Date(startDate);
                if (endDate) bookingQuery.createdAt.$lte = new Date(endDate);
            }

            const bookings = await Booking.find(bookingQuery)
                .populate('customer', 'companyName firstName lastName email')
                .limit(20)
                .lean();

            bookings.forEach(b => {
                results.push({
                    id: b._id,
                    type: 'booking',
                    trackingNumber: b.trackingNumber,
                    referenceNumber: b.bookingNumber,
                    status: b.status,
                    customer: b.customer?.companyName || 
                              `${b.customer?.firstName || ''} ${b.customer?.lastName || ''}`.trim(),
                    origin: b.shipmentDetails?.origin,
                    destination: b.shipmentDetails?.destination,
                    lastUpdate: b.updatedAt
                });
            });
        }

        results.sort((a, b) => new Date(b.lastUpdate) - new Date(a.lastUpdate));

        res.status(200).json({
            success: true,
            data: results,
            total: results.length
        });

    } catch (error) {
        console.error('❌ Search trackings error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// ==================== 9. EXPORT TRACKINGS ====================
exports.exportTrackings = async (req, res) => {
    try {
        const { format = 'csv', type, status, startDate, endDate } = req.query;

        console.log(`📤 Exporting trackings in ${format} format...`);

        let shipmentQuery = {};
        let bookingQuery = {};

        if (status) {
            shipmentQuery.status = status;
            bookingQuery.status = status;
        }

        if (startDate || endDate) {
            const dateFilter = {};
            if (startDate) dateFilter.$gte = new Date(startDate);
            if (endDate) dateFilter.$lte = new Date(endDate);
            
            shipmentQuery.createdAt = dateFilter;
            bookingQuery.createdAt = dateFilter;
        }

        let allTrackings = [];

        if (type === 'shipment' || !type) {
            const shipments = await Shipment.find(shipmentQuery)
                .populate('customerId', 'companyName firstName lastName email phone')
                .lean();

            shipments.forEach(s => {
                allTrackings.push({
                    'Tracking Number': s.trackingNumber,
                    'Type': 'Shipment',
                    'Reference': s.shipmentNumber,
                    'Status': s.status,
                    'Customer': s.customerId?.companyName || 
                                `${s.customerId?.firstName || ''} ${s.customerId?.lastName || ''}`.trim(),
                    'Customer Email': s.customerId?.email || '',
                    'Customer Phone': s.customerId?.phone || '',
                    'Origin': s.shipmentDetails?.origin || s.origin,
                    'Destination': s.shipmentDetails?.destination || s.destination,
                    'Packages': s.shipmentDetails?.totalPackages || s.totalPackages || 0,
                    'Weight (kg)': s.shipmentDetails?.totalWeight || s.totalWeight || 0,
                    'Volume (m³)': s.shipmentDetails?.totalVolume || s.totalVolume || 0,
                    'Created Date': new Date(s.createdAt).toLocaleDateString(),
                    'Last Update': new Date(s.updatedAt).toLocaleDateString(),
                    'Estimated Arrival': s.dates?.estimatedArrival ? 
                        new Date(s.dates.estimatedArrival).toLocaleDateString() : 'N/A',
                    'Actual Delivery': s.dates?.delivered ? 
                        new Date(s.dates.delivered).toLocaleDateString() : 'N/A'
                });
            });
        }

        if (type === 'booking' || !type) {
            const bookings = await Booking.find(bookingQuery)
                .populate('customer', 'companyName firstName lastName email phone')
                .lean();

            bookings.forEach(b => {
                allTrackings.push({
                    'Tracking Number': b.trackingNumber,
                    'Type': 'Booking',
                    'Reference': b.bookingNumber,
                    'Status': b.status,
                    'Customer': b.customer?.companyName || 
                                `${b.customer?.firstName || ''} ${b.customer?.lastName || ''}`.trim(),
                    'Customer Email': b.customer?.email || '',
                    'Customer Phone': b.customer?.phone || '',
                    'Origin': b.shipmentDetails?.origin,
                    'Destination': b.shipmentDetails?.destination,
                    'Packages': b.shipmentDetails?.totalPackages || 0,
                    'Weight (kg)': b.shipmentDetails?.totalWeight || 0,
                    'Volume (m³)': b.shipmentDetails?.totalVolume || 0,
                    'Created Date': new Date(b.createdAt).toLocaleDateString(),
                    'Last Update': new Date(b.updatedAt).toLocaleDateString(),
                    'Estimated Arrival': b.dates?.estimatedArrival ? 
                        new Date(b.dates.estimatedArrival).toLocaleDateString() : 'N/A'
                });
            });
        }

        if (format === 'csv') {
            const headers = Object.keys(allTrackings[0] || {}).join(',');
            const rows = allTrackings.map(row => 
                Object.values(row).map(val => 
                    typeof val === 'string' && val.includes(',') ? `"${val}"` : val
                ).join(',')
            ).join('\n');
            
            const csv = `${headers}\n${rows}`;
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=trackings-${Date.now()}.csv`);
            
            return res.status(200).send(csv);
        }

        res.status(200).json({
            success: true,
            data: allTrackings,
            total: allTrackings.length
        });

    } catch (error) {
        console.error('❌ Export trackings error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// ==================== 10. TRACK BY NUMBER (Public) - সম্পূর্ণ ফিক্সড ভার্সন ====================
exports.trackByNumber = async (req, res) => {
    try {
        const { trackingNumber } = req.params;

        console.log('🔍 Public tracking search:', trackingNumber);

        // প্রথমে Shipment-এ খুঁজুন
        let shipment = await Shipment.findOne({ trackingNumber })
            .populate({
                path: 'bookingId',
                select: 'bookingNumber sender receiver dates shipmentClassification courier'
            })
            .populate('customerId', 'companyName firstName lastName')
            .populate({
                path: 'consolidationId',
                select: 'consolidationNumber containerNumber containerType sealNumber status timeline originWarehouse destinationPort'
            })
            .lean();

        // Shipment না পেলে Booking-এ খুঁজুন
        if (!shipment) {
            const booking = await Booking.findOne({ trackingNumber })
                .populate('customer', 'companyName firstName lastName')
                .populate('shipmentId')
                .lean();

            if (booking) {
                shipment = {
                    ...booking,
                    type: 'booking',
                    trackingNumber: booking.trackingNumber,
                    referenceNumber: booking.bookingNumber,
                    customer: booking.customer,
                    packages: booking.shipmentDetails?.packageDetails || [],
                    milestones: booking.timeline || []
                };
            }
        }

        if (!shipment) {
            return res.status(404).json({
                success: false,
                message: 'Tracking number not found'
            });
        }

        console.log('✅ Shipment found:', {
            trackingNumber: shipment.trackingNumber,
            status: shipment.status,
            hasMilestones: !!(shipment.milestones?.length),
            hasConsolidation: !!shipment.consolidationId
        });

        // ===== টাইমলাইন তৈরি করুন - শুধুমাত্র প্রাসঙ্গিক ইভেন্ট =====
        let timeline = [];

        // 1. শিপমেন্ট মাইলস্টোন যোগ করুন (প্রাথমিক ইভেন্ট)
        if (shipment.milestones && shipment.milestones.length > 0) {
            console.log(`📋 Found ${shipment.milestones.length} shipment milestones`);
            
            const shipmentEvents = shipment.milestones
                .filter(m => m.status && m.timestamp) // শুধুমাত্র বৈধ ইভেন্ট
                .map(m => ({
                    status: m.status,
                    location: m.location || shipment.shipmentDetails?.origin || 'Unknown',
                    description: m.description || getStatusDescription(m.status),
                    date: m.timestamp,
                    formattedDate: formatDate(m.timestamp),
                    source: 'shipment',
                    isPrimary: true // শিপমেন্ট ইভেন্টকে প্রাথমিক হিসেবে চিহ্নিত করুন
                }));
            
            timeline = [...timeline, ...shipmentEvents];
        }

        // 2. কনসলিডেশন টাইমলাইন যোগ করুন (সেকেন্ডারি ইভেন্ট)
        if (shipment.consolidationId && shipment.consolidationId.timeline) {
            console.log(`📦 Found ${shipment.consolidationId.timeline.length} consolidation events`);
            
            // কনসলিডেশনের জন্য আলাদা স্ট্যাটাস ম্যাপিং
            const consolidationStatusMap = {
                'draft': 'consolidation_pending',
                'pending_consolidation': 'consolidation_pending',
                'in_progress': 'consolidation_in_progress',
                'consolidating': 'consolidation_in_progress',
                'consolidated': 'consolidation_completed',
                'ready_for_dispatch': 'ready_for_dispatch',
                'loaded': 'container_loaded',
                'loaded_in_container': 'container_loaded',
                'dispatched': 'container_dispatched',
                'in_transit': 'container_in_transit',
                'departed': 'container_departed',
                'departed_port_of_origin': 'container_departed',
                'arrived': 'container_arrived',
                'arrived_at_destination_port': 'container_arrived',
                'customs_cleared': 'customs_cleared',
                'out_for_delivery': 'out_for_delivery',
                'delivered': 'delivered',
                'completed': 'consolidation_completed'
            };
            
            const consolidationEvents = shipment.consolidationId.timeline
                .filter(event => {
                    // শুধুমাত্র গুরুত্বপূর্ণ ইভেন্ট দেখান
                    const excludedStatuses = ['draft', 'pending_consolidation', 'completed'];
                    return event.status && 
                           event.timestamp && 
                           !excludedStatuses.includes(event.status);
                })
                .map(event => {
                    const mappedStatus = consolidationStatusMap[event.status] || `consolidation_${event.status}`;
                    
                    // লোকেশন নির্ধারণ করুন
                    let location = event.location;
                    if (!location) {
                        if (['loaded', 'dispatched', 'departed'].includes(event.status)) {
                            location = shipment.consolidationId.originWarehouse || 'Origin Warehouse';
                        } else if (['arrived', 'customs_cleared'].includes(event.status)) {
                            location = shipment.consolidationId.destinationPort || 'Destination Port';
                        } else {
                            location = 'Warehouse';
                        }
                    }
                    
                    return {
                        status: mappedStatus,
                        location: location,
                        description: event.description || `Consolidation: ${event.status.replace(/_/g, ' ')}`,
                        date: event.timestamp,
                        formattedDate: formatDate(event.timestamp),
                        source: 'consolidation',
                        isPrimary: false // কনসলিডেশন ইভেন্ট সেকেন্ডারি
                    };
                });
            
            timeline = [...timeline, ...consolidationEvents];
        }

        // 3. ট্র্যাকিং আপডেট যোগ করুন (যদি থাকে)
        if (shipment.trackingUpdates && shipment.trackingUpdates.length > 0) {
            console.log(`📍 Found ${shipment.trackingUpdates.length} tracking updates`);
            
            const trackingEvents = shipment.trackingUpdates
                .filter(t => t.status && t.timestamp)
                .map(t => ({
                    status: t.status,
                    location: t.location || 'Unknown',
                    description: t.description || 'Tracking update',
                    date: t.timestamp,
                    formattedDate: formatDate(t.timestamp),
                    source: 'tracking',
                    isPrimary: false
                }));
            
            timeline = [...timeline, ...trackingEvents];
        }

        // 4. বুকিং টাইমলাইন যোগ করুন (যদি booking থেকে আসে)
        if (shipment.timeline && shipment.timeline.length > 0 && shipment.type === 'booking') {
            console.log(`📅 Found ${shipment.timeline.length} booking timeline events`);
            
            const bookingEvents = shipment.timeline
                .filter(t => t.status && t.timestamp)
                .map(t => ({
                    status: t.status,
                    location: t.location || 'Unknown',
                    description: t.description || 'Booking update',
                    date: t.timestamp,
                    formattedDate: formatDate(t.timestamp),
                    source: 'booking',
                    isPrimary: true
                }));
            
            timeline = [...timeline, ...bookingEvents];
        }

        // 5. টাইমলাইন সাজান - প্রথমে প্রাথমিক ইভেন্ট, তারপর তারিখ অনুযায়ী
        timeline.sort((a, b) => {
            // আগে প্রাথমিক ইভেন্ট দেখান
            if (a.isPrimary && !b.isPrimary) return -1;
            if (!a.isPrimary && b.isPrimary) return 1;
            // তারপর তারিখ অনুযায়ী (নতুন প্রথমে)
            return new Date(b.date) - new Date(a.date);
        });

        console.log(`⏰ Final timeline has ${timeline.length} events`);
        if (timeline.length > 0) {
            console.log('📊 Latest event:', {
                status: timeline[0].status,
                location: timeline[0].location,
                date: timeline[0].formattedDate,
                source: timeline[0].source
            });
        }

        // 6. প্যাকেজ ডিটেইলস তৈরি করুন
        let packageDetails = [];
        let totalPackages = 0;
        let totalWeight = 0;

        if (shipment.packages && shipment.packages.length > 0) {
            shipment.packages.forEach((pkg, index) => {
                const quantity = pkg.quantity || 1;
                totalPackages += quantity;
                totalWeight += (pkg.weight || 0) * quantity;
                
                packageDetails.push({
                    id: index + 1,
                    description: pkg.description || 'N/A',
                    type: pkg.packagingType || 'Carton',
                    quantity: quantity,
                    weight: pkg.weight || 0,
                    volume: pkg.volume || 0,
                    dimensions: pkg.dimensions ? 
                        `${pkg.dimensions.length} × ${pkg.dimensions.width} × ${pkg.dimensions.height} ${pkg.dimensions.unit || 'cm'}` : 
                        'N/A'
                });
            });
        } else if (shipment.shipmentDetails?.packageDetails) {
            shipment.shipmentDetails.packageDetails.forEach((pkg, index) => {
                const quantity = pkg.quantity || 1;
                totalPackages += quantity;
                totalWeight += (pkg.weight || 0) * quantity;
                
                packageDetails.push({
                    id: index + 1,
                    description: pkg.description || 'N/A',
                    type: pkg.packagingType || 'Carton',
                    quantity: quantity,
                    weight: pkg.weight || 0,
                    volume: pkg.volume || 0,
                    dimensions: pkg.dimensions ? 
                        `${pkg.dimensions.length} × ${pkg.dimensions.width} × ${pkg.dimensions.height} ${pkg.dimensions.unit || 'cm'}` : 
                        'N/A'
                });
            });
        }

        // 7. কনসলিডেশন তথ্য তৈরি করুন
        let consolidationInfo = null;
        if (shipment.consolidationId) {
            const cons = shipment.consolidationId;
            consolidationInfo = {
                number: cons.consolidationNumber,
                containerNumber: cons.containerNumber,
                containerType: cons.containerType,
                sealNumber: cons.sealNumber,
                originWarehouse: cons.originWarehouse,
                destinationPort: cons.destinationPort,
                status: cons.status
            };
        }

        // 8. ETA এবং অন্যান্য তারিখ নির্ধারণ করুন
        const estimatedArrival = shipment.bookingId?.dates?.estimatedArrival || 
                                 shipment.dates?.estimatedArrival ||
                                 shipment.estimatedArrival;

        const estimatedDeparture = shipment.bookingId?.dates?.estimatedDeparture ||
                                   shipment.dates?.estimatedDeparture;

        const actualDelivery = shipment.dates?.delivered ||
                               shipment.actualDeliveryDate;

        // 9. ফাইনাল ট্র্যাকিং ডেটা
        const publicTrackingInfo = {
            trackingNumber: shipment.trackingNumber,
            bookingNumber: shipment.bookingId?.bookingNumber || shipment.bookingNumber,
            shipmentNumber: shipment.shipmentNumber,
            
            status: shipment.status,
            statusDisplay: formatStatus(shipment.status),
            progress: calculateProgress(shipment.status),
            
            origin: shipment.shipmentDetails?.origin || 
                    shipment.origin || 
                    'China',
            destination: shipment.shipmentDetails?.destination || 
                        shipment.destination || 
                        'USA',
            currentLocation: timeline.find(e => e.isPrimary)?.location || 
                            timeline[0]?.location || 
                            'Unknown',
            
            lastUpdate: timeline[0]?.date || shipment.updatedAt,
            lastUpdateFormatted: timeline[0]?.formattedDate || formatDate(shipment.updatedAt),
            
            estimatedDeparture: estimatedDeparture,
            estimatedDepartureFormatted: estimatedDeparture ? formatDate(estimatedDeparture) : 'N/A',
            
            estimatedArrival: estimatedArrival,
            estimatedArrivalFormatted: estimatedArrival ? formatDate(estimatedArrival) : 'N/A',
            
            actualDelivery: actualDelivery,
            actualDeliveryFormatted: actualDelivery ? formatDate(actualDelivery) : 'N/A',
            
            // শিপমেন্ট ডিটেইলস
            shipmentDetails: {
                totalPackages: totalPackages || shipment.shipmentDetails?.totalPackages || 0,
                totalWeight: totalWeight || shipment.shipmentDetails?.totalWeight || 0,
                totalVolume: shipment.shipmentDetails?.totalVolume || 0,
                shippingMode: shipment.shipmentDetails?.shippingMode || 'DDP',
                serviceType: shipment.courier?.serviceType || 'standard'
            },
            
            // প্যাকেজ ডিটেইলস
            packages: packageDetails,
            
            // কনসলিডেশন তথ্য
            consolidation: consolidationInfo,
            
            // সেন্ডার/রিসিভার
            sender: shipment.sender || shipment.bookingId?.sender || null,
            receiver: shipment.receiver || shipment.bookingId?.receiver || null,
            
            // কাস্টমার
            customer: shipment.customerId ? {
                name: shipment.customerId.companyName || 
                      `${shipment.customerId.firstName || ''} ${shipment.customerId.lastName || ''}`.trim(),
                email: shipment.customerId.email
            } : null,
            
            // টাইমলাইন (সব ইভেন্ট)
            timeline: timeline.slice(0, 30), // সর্বোচ্চ ৩০টি ইভেন্ট
            
            // ট্রান্সপোর্ট তথ্য
            transport: shipment.transport ? {
                carrier: shipment.transport.carrierName,
                vessel: shipment.transport.vesselName,
                flight: shipment.transport.flightNumber,
                voyage: shipment.transport.voyageNumber
            } : null
        };

        // ডিবাগ লগ
        console.log('📊 Final tracking data:', {
            trackingNumber: publicTrackingInfo.trackingNumber,
            status: publicTrackingInfo.status,
            progress: publicTrackingInfo.progress,
            timelineCount: publicTrackingInfo.timeline.length,
            currentLocation: publicTrackingInfo.currentLocation,
            estimatedArrival: publicTrackingInfo.estimatedArrivalFormatted
        });

        res.status(200).json({
            success: true,
            data: publicTrackingInfo
        });

    } catch (error) {
        console.error('❌ Public track by number error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

module.exports = exports;