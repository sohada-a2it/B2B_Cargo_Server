const ConsolidationQueue = require('../models/consolidationQueueModel');
const Consolidation = require('../models/consolidationModel');
const Shipment = require('../models/shipmentModel');
const Warehouse = require('../models/warehouseModel');
const User = require('../models/userModel');
const { sendEmail } = require('../utils/emailService');

// ========== HELPER FUNCTIONS ==========
// controllers/consolidationController.js - হেল্পার ফাংশন

/**
 * Get on hold shipments in a consolidation
 */
// ফাংশনের শুরুতে এই হেল্পার ফাংশন যোগ করুন
function generateSealNumber() {
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const day = String(new Date().getDate()).padStart(2, '0');
    const random = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    return `SEL-${year}${month}${day}-${random}`;
}
exports.getOnHoldShipments = async (req, res) => {
  try {
    const { id } = req.params;
    
    const consolidation = await Consolidation.findById(id).populate({
      path: 'shipments',
      match: { status: 'on_hold' },
      select: 'trackingNumber status holdReason heldAt shipmentDetails'
    });
    
    if (!consolidation) {
      return res.status(404).json({
        success: false,
        message: 'Consolidation not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: {
        consolidationNumber: consolidation.consolidationNumber,
        onHoldShipments: consolidation.shipments.filter(s => s.status === 'on_hold'),
        count: consolidation.shipments.filter(s => s.status === 'on_hold').length
      }
    });
    
  } catch (error) {
    console.error('Get on hold shipments error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Resume all on hold shipments in consolidation
 */
exports.resumeAllOnHoldShipments = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    
    const consolidation = await Consolidation.findById(id).populate('shipments');
    
    if (!consolidation) {
      return res.status(404).json({
        success: false,
        message: 'Consolidation not found'
      });
    }
    
    const onHoldShipments = consolidation.shipments.filter(s => s.status === 'on_hold');
    
    if (onHoldShipments.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No shipments on hold in this consolidation'
      });
    }
    
    // Resume each shipment
    for (const shipment of onHoldShipments) {
      shipment.status = 'in_progress';
      shipment.resumedAt = new Date();
      shipment.previousStatus = 'on_hold';
      shipment.holdReason = null;
      shipment.heldAt = null;
      shipment.milestones.push({
        status: 'in_progress',
        location: consolidation.originWarehouse,
        description: `Resumed from hold: ${notes || 'Resumed by admin'}`,
        timestamp: new Date(),
        updatedBy: req.user._id
      });
      await shipment.save();
    }
    
    // Update consolidation status
    consolidation.status = 'in_progress';
    consolidation.timeline.push({
      status: 'in_progress',
      timestamp: new Date(),
      description: `Resumed ${onHoldShipments.length} shipment(s) from hold. ${notes || ''}`,
      updatedBy: req.user._id
    });
    
    await consolidation.save();
    
    res.status(200).json({
      success: true,
      message: `${onHoldShipments.length} shipment(s) resumed successfully`,
      data: {
        consolidationNumber: consolidation.consolidationNumber,
        resumedCount: onHoldShipments.length,
        status: consolidation.status
      }
    });
    
  } catch (error) {
    console.error('Resume all shipments error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get cancelled shipments from consolidation
 */
exports.getCancelledShipments = async (req, res) => {
  try {
    const { id } = req.params;
    
    const consolidation = await Consolidation.findById(id);
    
    if (!consolidation) {
      return res.status(404).json({
        success: false,
        message: 'Consolidation not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: {
        consolidationNumber: consolidation.consolidationNumber,
        cancelledShipments: consolidation.cancelledShipments || [],
        count: (consolidation.cancelledShipments || []).length
      }
    });
    
  } catch (error) {
    console.error('Get cancelled shipments error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
function getMainTypeName(type) {
    const names = {
        'sea_freight': 'Sea Freight',
        'air_freight': 'Air Freight',
        'inland_trucking': 'Inland Trucking',
        'multimodal': 'Multi-modal'
    };
    return names[type] || type;
}

function getSubTypeName(type) {
    const names = {
        'sea_freight_fcl': 'FCL',
        'sea_freight_lcl': 'LCL',
        'air_freight': 'Air Freight',
        'rail_freight': 'Rail',
        'express_delivery': 'Express',
        'inland_transport': 'Inland',
        'door_to_door': 'Door to Door'
    };
    return names[type] || type;
}

function estimateContainerType(totalVolume) {
    if (totalVolume <= 28) return '20ft';
    if (totalVolume <= 58) return '40ft';
    if (totalVolume <= 68) return '40ft HC';
    return '40ft HC';
}

function generateConsolidationNumber(mainType, destination) {
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const random = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    
    const destCode = destination.substring(0, 3).toUpperCase();
    const typeCode = mainType === 'sea_freight' ? 'SEA' : 
                    mainType === 'air_freight' ? 'AIR' : 'INL';
    
    return `CN-${year}${month}-${typeCode}-${destCode}-${random}`;
}

// ========== 1. ADD TO QUEUE ==========
exports.addToQueue = async (req, res) => {
    try {
        const { shipmentId } = req.body;
        
        // Shipment ডাটা নিয়ে আসি
        const shipment = await Shipment.findById(shipmentId);
        if (!shipment) {
            return res.status(404).json({
                success: false,
                message: 'Shipment not found'
            });
        }
        
        // Check if shipment is already in queue or consolidated
        if (shipment.warehouseStatus === 'in_queue' || shipment.warehouseStatus === 'consolidated') {
            return res.status(400).json({
                success: false,
                message: `Shipment is already ${shipment.warehouseStatus}`
            });
        }
        
        // গ্রুপিং কী তৈরি করি
        const groupKey = `${shipment.shipmentClassification.mainType}_${shipment.shipmentClassification.subType}_${shipment.shipmentDetails.origin}_${shipment.shipmentDetails.destination}`;
        
        // চেক করি ইতিমধ্যে queue তে আছে কিনা
        const existing = await ConsolidationQueue.findOne({
            shipmentId: shipment._id,
            status: 'pending'
        });
        
        if (existing) {
            return res.status(400).json({
                success: false,
                message: 'Shipment already in queue'
            });
        }
        
        // Queue তে যোগ করি
        const queueItem = await ConsolidationQueue.create({
            shipmentId: shipment._id,
            trackingNumber: shipment.trackingNumber,
            customerId: shipment.customerId,
            
            // Grouping fields
            groupKey,
            mainType: shipment.shipmentClassification.mainType,
            subType: shipment.shipmentClassification.subType,
            origin: shipment.shipmentDetails.origin,
            destination: shipment.shipmentDetails.destination,
            destinationCountry: shipment.receiver?.address?.country || shipment.shipmentDetails.destination,
            
            // Shipment details
            totalPackages: shipment.shipmentDetails.totalPackages,
            totalWeight: shipment.shipmentDetails.totalWeight,
            totalVolume: shipment.shipmentDetails.totalVolume,
            
            addedBy: req.user._id
        });
        
        // Shipment আপডেট করি
        await Shipment.findByIdAndUpdate(shipmentId, {
            $set: { warehouseStatus: 'in_queue' }
        });
        
        res.status(201).json({
            success: true,
            message: 'Shipment added to consolidation queue',
            data: queueItem
        });
        
    } catch (error) {
        console.error('Add to queue error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ========== 2. ADD MULTIPLE SHIPMENTS TO QUEUE ==========
exports.addMultipleToQueue = async (req, res) => {
    try {
        const { shipmentIds } = req.body;
        
        if (!shipmentIds || !Array.isArray(shipmentIds) || shipmentIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Please provide shipment IDs array'
            });
        }
        
        const results = {
            added: [],
            failed: [],
            skipped: []
        };
        
        for (const shipmentId of shipmentIds) {
            try {
                const shipment = await Shipment.findById(shipmentId);
                
                if (!shipment) {
                    results.failed.push({ id: shipmentId, reason: 'Shipment not found' });
                    continue;
                }
                
                if (shipment.warehouseStatus === 'in_queue' || shipment.warehouseStatus === 'consolidated') {
                    results.skipped.push({ 
                        id: shipmentId, 
                        trackingNumber: shipment.trackingNumber,
                        reason: `Already ${shipment.warehouseStatus}` 
                    });
                    continue;
                }
                
                const groupKey = `${shipment.shipmentClassification.mainType}_${shipment.shipmentClassification.subType}_${shipment.shipmentDetails.origin}_${shipment.shipmentDetails.destination}`;
                
                const existing = await ConsolidationQueue.findOne({
                    shipmentId: shipment._id,
                    status: 'pending'
                });
                
                if (existing) {
                    results.skipped.push({ 
                        id: shipmentId, 
                        trackingNumber: shipment.trackingNumber,
                        reason: 'Already in queue' 
                    });
                    continue;
                }
                
                const queueItem = await ConsolidationQueue.create({
                    shipmentId: shipment._id,
                    trackingNumber: shipment.trackingNumber,
                    customerId: shipment.customerId,
                    groupKey,
                    mainType: shipment.shipmentClassification.mainType,
                    subType: shipment.shipmentClassification.subType,
                    origin: shipment.shipmentDetails.origin,
                    destination: shipment.shipmentDetails.destination,
                    destinationCountry: shipment.receiver?.address?.country || shipment.shipmentDetails.destination,
                    totalPackages: shipment.shipmentDetails.totalPackages,
                    totalWeight: shipment.shipmentDetails.totalWeight,
                    totalVolume: shipment.shipmentDetails.totalVolume,
                    addedBy: req.user._id
                });
                
                await Shipment.findByIdAndUpdate(shipmentId, {
                    $set: { warehouseStatus: 'in_queue' }
                });
                
                results.added.push({
                    id: shipmentId,
                    trackingNumber: shipment.trackingNumber,
                    queueId: queueItem._id
                });
                
            } catch (err) {
                results.failed.push({ id: shipmentId, reason: err.message });
            }
        }
        
        res.status(200).json({
            success: true,
            message: `Added ${results.added.length} shipments to queue`,
            data: results
        });
        
    } catch (error) {
        console.error('Add multiple to queue error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ========== 3. GET CONSOLIDATION QUEUE ==========
exports.getConsolidationQueue = async (req, res) => {
    try {
        const { groupBy = 'group', origin, destination, mainType, subType } = req.query;
        
        // Build query
        let query = { status: 'pending' };
        if (origin) query.origin = origin;
        if (destination) query.destination = destination;
        if (mainType) query.mainType = mainType;
        if (subType) query.subType = subType;
        
        const queue = await ConsolidationQueue.find(query)
            .populate({
                path: 'shipmentId',
                select: 'trackingNumber shipmentDetails status'
            })
            .populate('customerId', 'companyName firstName lastName email phone')
            .populate('addedBy', 'firstName lastName')
            .sort({ addedAt: 1 });

        if (groupBy === 'group') {
            // Group by mainType, subType, origin, destination
            const grouped = queue.reduce((acc, item) => {
                const key = item.groupKey;
                
                if (!acc[key]) {
                    acc[key] = {
                        groupKey: key,
                        mainType: item.mainType,
                        mainTypeName: getMainTypeName(item.mainType),
                        subType: item.subType,
                        subTypeName: getSubTypeName(item.subType),
                        origin: item.origin,
                        destination: item.destination,
                        destinationCountry: item.destinationCountry,
                        displayName: `${getMainTypeName(item.mainType)} (${getSubTypeName(item.subType)}) - ${item.origin} → ${item.destination}`,
                        shipments: [],
                        totalWeight: 0,
                        totalVolume: 0,
                        totalPackages: 0,
                        count: 0,
                        oldestAdded: item.addedAt,
                        newestAdded: item.addedAt
                    };
                }
                
                acc[key].shipments.push({
                    _id: item._id,
                    shipmentId: item.shipmentId,
                    trackingNumber: item.trackingNumber,
                    customer: item.customerId,
                    packages: item.totalPackages,
                    weight: item.totalWeight,
                    volume: item.totalVolume,
                    addedAt: item.addedAt,
                    addedBy: item.addedBy
                });
                
                acc[key].totalWeight += item.totalWeight || 0;
                acc[key].totalVolume += item.totalVolume || 0;
                acc[key].totalPackages += item.totalPackages || 0;
                acc[key].count++;
                
                // Update oldest/newest dates
                if (item.addedAt < acc[key].oldestAdded) acc[key].oldestAdded = item.addedAt;
                if (item.addedAt > acc[key].newestAdded) acc[key].newestAdded = item.addedAt;
                
                return acc;
            }, {});

            // Convert to array and sort by oldestAdded
            const groups = Object.values(grouped).sort((a, b) => 
                new Date(a.oldestAdded) - new Date(b.oldestAdded)
            );

            res.status(200).json({
                success: true,
                data: {
                    groups: groups,
                    totalGroups: groups.length,
                    totalItems: queue.length
                }
            });
        } else {
            // Return flat list
            res.status(200).json({
                success: true,
                data: {
                    items: queue,
                    totalItems: queue.length
                }
            });
        }

    } catch (error) {
        console.error('Get queue error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ========== 4. GET QUEUE SUMMARY ==========
exports.getQueueSummary = async (req, res) => {
    try {
        const queue = await ConsolidationQueue.find({ status: 'pending' });
        
        // Group by destination for summary
        const byDestination = {};
        const byType = {};
        const byOrigin = {};
        
        queue.forEach(item => {
            // By destination
            const dest = item.destination;
            if (!byDestination[dest]) {
                byDestination[dest] = {
                    destination: dest,
                    count: 0,
                    totalWeight: 0,
                    totalVolume: 0,
                    countries: new Set()
                };
            }
            byDestination[dest].count++;
            byDestination[dest].totalWeight += item.totalWeight || 0;
            byDestination[dest].totalVolume += item.totalVolume || 0;
            if (item.destinationCountry) {
                byDestination[dest].countries.add(item.destinationCountry);
            }
            
            // By type
            const type = `${item.mainType}_${item.subType}`;
            if (!byType[type]) {
                byType[type] = {
                    mainType: item.mainType,
                    subType: item.subType,
                    mainTypeName: getMainTypeName(item.mainType),
                    subTypeName: getSubTypeName(item.subType),
                    count: 0,
                    totalWeight: 0,
                    totalVolume: 0
                };
            }
            byType[type].count++;
            byType[type].totalWeight += item.totalWeight || 0;
            byType[type].totalVolume += item.totalVolume || 0;
            
            // By origin
            const origin = item.origin;
            if (!byOrigin[origin]) {
                byOrigin[origin] = {
                    origin: origin,
                    count: 0,
                    totalWeight: 0,
                    totalVolume: 0
                };
            }
            byOrigin[origin].count++;
            byOrigin[origin].totalWeight += item.totalWeight || 0;
            byOrigin[origin].totalVolume += item.totalVolume || 0;
        });
        
        // Convert Sets to arrays
        Object.values(byDestination).forEach(d => {
            d.countries = Array.from(d.countries);
        });
        
        res.status(200).json({
            success: true,
            data: {
                totalItems: queue.length,
                byDestination: Object.values(byDestination),
                byType: Object.values(byType),
                byOrigin: Object.values(byOrigin)
            }
        });
        
    } catch (error) {
        console.error('Get queue summary error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ========== 5. CREATE CONSOLIDATION ==========
exports.createConsolidation = async (req, res) => {
    try {
        const {
            groupKey,
            containerNumber,
            containerType,
            sealNumber,
            estimatedDeparture,
            selectedShipmentIds,
        } = req.body;

        // Helper function for seal number generation
        function generateSealNumber() {
            const year = new Date().getFullYear();
            const month = String(new Date().getMonth() + 1).padStart(2, '0');
            const day = String(new Date().getDate()).padStart(2, '0');
            const random = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
            return `SEL-${year}${month}${day}-${random}`;
        }

        // Validation
        if (!groupKey) {
            return res.status(400).json({
                success: false,
                message: 'groupKey is required'
            });
        }

        if (!selectedShipmentIds || selectedShipmentIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Please select at least one shipment'
            });
        }

        // Get selected shipments
        const queueItems = await ConsolidationQueue.find({
            _id: { $in: selectedShipmentIds },
            groupKey: groupKey,
            status: 'pending'
        })
        .populate('shipmentId')
        .populate('customerId');

        if (queueItems.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No pending shipments found for this group'
            });
        }

        // Calculate totals
        let totalPackages = 0;
        let totalWeight = 0;
        let totalVolume = 0;
        const items = [];
        const customerMap = new Map();

        for (const item of queueItems) {
            totalPackages += item.totalPackages || 0;
            totalWeight += item.totalWeight || 0;
            totalVolume += item.totalVolume || 0;

            items.push({
                shipmentId: item.shipmentId._id,
                packageType: 'Mixed',
                quantity: item.totalPackages || 1,
                description: `Shipment ${item.trackingNumber}`,
                weight: item.totalWeight || 0,
                volume: item.totalVolume || 0
            });
            
            if (item.customerId) {
                customerMap.set(item.customerId._id.toString(), item.customerId);
            }
        }

        const firstItem = queueItems[0];
        const consolidationNumber = generateConsolidationNumber(
            firstItem.mainType, 
            firstItem.destination
        );

        // ✅ Generate seal number if not provided
        const finalSealNumber = sealNumber || generateSealNumber();
        const finalContainerNumber = containerNumber || `CNTR-${Date.now()}`;
        const finalContainerType = containerType || estimateContainerType(totalVolume);

        console.log('📦 Creating consolidation with:', {
            consolidationNumber,
            sealNumber: finalSealNumber,
            containerNumber: finalContainerNumber
        });

        // Create consolidation
        const consolidation = await Consolidation.create({
            consolidationNumber,
            shipments: queueItems.map(q => q.shipmentId._id),
            
            mainType: firstItem.mainType,
            subType: firstItem.subType,
            
            containerNumber: finalContainerNumber,
            containerType: finalContainerType,
            sealNumber: finalSealNumber,  // ← Auto-generated seal number
            
            totalShipments: queueItems.length,
            totalPackages,
            totalWeight,
            totalVolume,
            
            originWarehouse: firstItem.origin,
            destinationPort: firstItem.destination,
            destinationCountry: firstItem.destinationCountry,
            
            consolidationStarted: new Date(),
            estimatedDeparture: estimatedDeparture || new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
            status: 'draft',
            
            items,
            
            createdBy: req.user._id
        });

        // Update queue items
        await ConsolidationQueue.updateMany(
            { _id: { $in: queueItems.map(q => q._id) } },
            {
                $set: {
                    status: 'assigned',
                    consolidationId: consolidation._id,
                    assignedAt: new Date()
                }
            }
        );

        // Update shipments
        await Shipment.updateMany(
            { _id: { $in: queueItems.map(q => q.shipmentId._id) } },
            {
                $set: {
                    warehouseStatus: 'consolidated',
                    consolidationId: consolidation._id,
                    'transport.containerNumber': finalContainerNumber,
                    'transport.sealNumber': finalSealNumber  // ← Add seal to transport
                },
                $push: {
                    milestones: {
                        status: 'consolidated',
                        location: firstItem.origin,
                        description: `Shipment consolidated into container ${finalContainerNumber} (Seal: ${finalSealNumber}) for ${firstItem.destination}`,
                        timestamp: new Date(),
                        updatedBy: req.user._id
                    }
                }
            }
        );

        // Send notifications
        try {
            for (const customer of customerMap.values()) {
                if (customer.email) {
                    await sendEmail({
                        to: customer.email,
                        subject: 'Shipments Consolidated',
                        template: 'consolidationCreated',
                        data: {
                            customerName: customer.companyName || `${customer.firstName} ${customer.lastName}`,
                            consolidationNumber: consolidation.consolidationNumber,
                            shipmentCount: queueItems.filter(q => 
                                q.customerId?._id.toString() === customer._id.toString()
                            ).length,
                            destination: firstItem.destination,
                            sealNumber: finalSealNumber  // ← Add seal to email
                        }
                    });
                }
            }
        } catch (emailError) {
            console.error('Email notification error:', emailError);
        }

        res.status(201).json({
            success: true,
            message: `Consolidation created for ${queueItems.length} shipments in group ${groupKey}`,
            data: consolidation
        });

    } catch (error) {
        console.error('❌ Create consolidation error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ========== 6. GET ALL CONSOLIDATIONS ==========
exports.getConsolidations = async (req, res) => {
    try {
        const { 
            status, 
            mainType, 
            subType, 
            origin, 
            destination,
            page = 1, 
            limit = 20,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        // Build query
        let query = {};
        if (status) query.status = status;
        if (mainType) query.mainType = mainType;
        if (subType) query.subType = subType;
        if (origin) query.originWarehouse = origin;
        if (destination) query.destinationPort = destination;

        // Build sort object
        const sort = {};
        sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const consolidations = await Consolidation.find(query)
            .populate('shipments', 'trackingNumber status customerId')
            .populate('createdBy', 'firstName lastName')
            .populate('updatedBy', 'firstName lastName')
            .sort(sort)
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit));

        const total = await Consolidation.countDocuments(query);

        // Get summary statistics
        const summary = await Consolidation.aggregate([
            { $match: query },
            { $group: {
                _id: null,
                totalWeight: { $sum: '$totalWeight' },
                totalVolume: { $sum: '$totalVolume' },
                totalShipments: { $sum: '$totalShipments' },
                avgShipmentsPerConsolidation: { $avg: '$totalShipments' }
            }}
        ]);

        res.status(200).json({
            success: true,
            data: consolidations,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / parseInt(limit))
            },
            summary: summary[0] || {
                totalWeight: 0,
                totalVolume: 0,
                totalShipments: 0,
                avgShipmentsPerConsolidation: 0
            }
        });

    } catch (error) {
        console.error('Get consolidations error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ========== 7. GET CONSOLIDATION BY ID ==========
exports.getConsolidationById = async (req, res) => {
    try {
        const { id } = req.params;

        const consolidation = await Consolidation.findById(id)
            .populate({
                path: 'shipments',
                populate: {
                    path: 'customerId',
                    select: 'firstName lastName companyName email phone'
                }
            })
            .populate({
                path: 'items.shipmentId',
                select: 'trackingNumber status'
            })
            .populate('createdBy', 'firstName lastName')
            .populate('updatedBy', 'firstName lastName');

        if (!consolidation) {
            return res.status(404).json({
                success: false,
                message: 'Consolidation not found'
            });
        }

        // Get queue items for this consolidation
        const queueItems = await ConsolidationQueue.find({
            consolidationId: consolidation._id
        }).populate('addedBy', 'firstName lastName');

        res.status(200).json({
            success: true,
            data: {
                consolidation,
                queueHistory: queueItems
            }
        });

    } catch (error) {
        console.error('Get consolidation error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ========== 8. UPDATE CONSOLIDATION ==========
exports.updateConsolidation = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        const consolidation = await Consolidation.findById(id);
        if (!consolidation) {
            return res.status(404).json({
                success: false,
                message: 'Consolidation not found'
            });
        }

        // Prevent updates to certain fields if already departed
        if (consolidation.status === 'departed' || consolidation.status === 'arrived') {
            const restrictedFields = ['shipments', 'items', 'containerNumber', 'mainType', 'subType'];
            for (const field of restrictedFields) {
                if (updates[field]) {
                    return res.status(400).json({
                        success: false,
                        message: `Cannot update ${field} after consolidation has departed`
                    });
                }
            }
        }

        // Update fields
        Object.keys(updates).forEach(key => {
            if (key !== '_id' && key !== '__v' && key !== 'consolidationNumber') {
                consolidation[key] = updates[key];
            }
        });

        consolidation.updatedBy = req.user._id;
        await consolidation.save();

        res.status(200).json({
            success: true,
            message: 'Consolidation updated successfully',
            data: consolidation
        });

    } catch (error) {
        console.error('Update consolidation error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ========== 9. UPDATE CONSOLIDATION STATUS ========== 

// controllers/consolidationController.js - সম্পূর্ণ replace করুন

// controllers/consolidationController.js - শুধু updateConsolidationStatus ফাংশন

exports.updateConsolidationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, actualDeparture, actualArrival, location, notes, forceUpdate } = req.body;

    console.log('🔄 ===== UPDATE CONSOLIDATION STATUS =====');
    console.log('🔄 Consolidation ID:', id);
    console.log('🔄 New status:', status);
    console.log('🔄 Force update:', forceUpdate);

    const consolidation = await Consolidation.findById(id).populate('shipments');
    
    if (!consolidation) {
      return res.status(404).json({
        success: false,
        message: 'Consolidation not found'
      });
    }

    const oldStatus = consolidation.status;
    
    // ========== ALLOWED TRANSITIONS ==========
    const getAllowedTransitions = (currentStatus) => {
      const transitions = {
        'draft': ['in_progress', 'ready_for_dispatch', 'cancelled', 'on_hold'],
        'in_progress': ['consolidated', 'ready_for_dispatch', 'cancelled', 'on_hold'],
        'consolidated': ['ready_for_dispatch'],
        'ready_for_dispatch': ['loaded', 'cancelled', 'on_hold'],
        'loaded': ['dispatched', 'cancelled', 'on_hold'],
        'dispatched': ['in_transit', 'cancelled'],
        'in_transit': ['arrived', 'cancelled'],
        'arrived': ['under_customs_cleared', 'customs_cleared', 'cancelled'],  // ← under_customs_cleared যোগ করুন
  'under_customs_cleared': ['customs_cleared', 'cancelled'],  // ← নতুন স্ট্যাটাস যোগ করুন
  'customs_cleared': ['out_for_delivery', 'cancelled'],
        'out_for_delivery': ['delivered'],
        'delivered': ['completed'],
        'on_hold': ['in_progress', 'cancelled'],
        'cancelled': [],
        'completed': []
      };
      return transitions[currentStatus] || [];
    };

    // ========== VALIDATION (forceUpdate TRUE হলে স্কিপ) ==========
    if (!forceUpdate) {
      const allowedTransitions = getAllowedTransitions(oldStatus);
      if (!allowedTransitions.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Cannot move from ${oldStatus} to ${status}. Allowed transitions: ${allowedTransitions.join(', ')}`
        });
      }
    }

    console.log(`✅ Validation passed: ${oldStatus} → ${status}`);

    // ========== SHIPMENT STATUS MAPPING ==========
    const getShipmentStatus = (consolStatus) => {
      const statusMap = {
        'draft': 'pending',
        'in_progress': 'pending',
        'consolidated': 'consolidated',
        'ready_for_dispatch': 'ready_for_dispatch',
        'loaded': 'loaded_in_container',
        'dispatched': 'dispatched',
        'in_transit': 'in_transit',
        'arrived': 'arrived_at_destination_port',
        'customs_cleared': 'customs_cleared',
        'out_for_delivery': 'out_for_delivery',
        'delivered': 'delivered',
        'completed': 'completed',
        'cancelled': 'cancelled',
        'on_hold': 'on_hold'
      };
      return statusMap[consolStatus] || 'pending';
    };

    // ========== LOCATION & DESCRIPTION HELPERS ==========
    const getLocationForStatus = (stat, cons) => {
      const locationMap = {
        'arrived': cons.destinationPort || 'Destination Port',
        'customs_cleared': cons.destinationPort || 'Customs',
        'out_for_delivery': 'Out for Delivery',
        'delivered': 'Delivered',
        'completed': 'Completed',
        'dispatched': 'Dispatched',
        'in_transit': 'In Transit',
        'ready_for_dispatch': cons.originWarehouse || 'Warehouse',
        'loaded': cons.originWarehouse || 'Warehouse'
      };
      return locationMap[stat] || cons.originWarehouse || 'Warehouse';
    };

    const getDescriptionForStatus = (stat, cons) => {
      const descMap = {
        'arrived': `Shipment arrived at ${cons.destinationPort}`,
        'customs_cleared': 'Customs clearance completed',
        'out_for_delivery': 'Shipment out for delivery',
        'delivered': 'Shipment delivered successfully',
        'completed': 'Shipment completed',
        'dispatched': 'Shipment dispatched',
        'in_transit': 'Shipment in transit',
        'ready_for_dispatch': 'Shipment ready for dispatch',
        'loaded': 'Shipment loaded into container'
      };
      return descMap[stat] || `Status updated to ${stat}`;
    };

    const shipmentNewStatus = getShipmentStatus(status);
    
    // ========== UPDATE ALL SHIPMENTS IN THIS CONSOLIDATION ==========
    const updatedShipments = [];
    
    for (const shipment of consolidation.shipments) {
      if (!shipment) continue;
      
      console.log(`  📦 Updating shipment: ${shipment.trackingNumber}`);
      console.log(`     Old status: ${shipment.status} → New: ${shipmentNewStatus}`);
      
      shipment.status = shipmentNewStatus;
      shipment.currentMilestone = shipmentNewStatus;
      shipment.updatedBy = req.user._id;
      
      let milestoneLocation = location || getLocationForStatus(status, consolidation);
      let milestoneDescription = getDescriptionForStatus(status, consolidation);
      
      if (!shipment.milestones) shipment.milestones = [];
      
      shipment.milestones.push({
        status: shipmentNewStatus,
        location: milestoneLocation,
        description: `${milestoneDescription} (via consolidation ${consolidation.consolidationNumber})`,
        timestamp: new Date(),
        updatedBy: req.user._id
      });
      
      // Update transport info based on status
      if (!shipment.transport) shipment.transport = {};
      
      switch(status) {
        case 'dispatched':
          shipment.transport.actualDeparture = actualDeparture || new Date();
          shipment.transport.currentLocation = {
            location: milestoneLocation,
            status: 'dispatched',
            timestamp: new Date()
          };
          break;
        case 'in_transit':
          shipment.transport.currentLocation = {
            location: milestoneLocation,
            status: 'in_transit',
            timestamp: new Date()
          };
          break;
        case 'arrived':
          shipment.transport.actualArrival = actualArrival || new Date();
          shipment.transport.currentLocation = {
            location: milestoneLocation,
            status: 'arrived',
            timestamp: new Date()
          };
          break;
        case 'delivered':
        case 'completed':
          if (!shipment.dates) shipment.dates = {};
          shipment.dates.delivered = new Date();
          shipment.transport.currentLocation = {
            location: milestoneLocation,
            status: 'delivered',
            timestamp: new Date()
          };
          break;
      }
      
      await shipment.save();
      updatedShipments.push({
        id: shipment._id,
        trackingNumber: shipment.trackingNumber,
        oldStatus: shipment.status,
        newStatus: shipmentNewStatus
      });
      
      console.log(`     ✅ Shipment updated successfully`);
    }

    // ========== UPDATE CONSOLIDATION ==========
    consolidation.status = status;
    consolidation.updatedBy = req.user._id;
    
    if (status === 'completed') {
      consolidation.consolidationCompleted = new Date();
    }
    
    if (status === 'loaded' || status === 'dispatched') {
      consolidation.actualDeparture = actualDeparture || new Date();
    }
    
    if (status === 'arrived') {
      consolidation.actualArrival = actualArrival || new Date();
    }

    // Add timeline entry
    if (!consolidation.timeline) consolidation.timeline = [];
    consolidation.timeline.push({
      status: status,
      timestamp: new Date(),
      description: notes || `Consolidation status changed from ${oldStatus} to ${status}`,
      updatedBy: req.user._id
    });

    await consolidation.save();

    console.log(`✅ Consolidation ${consolidation.consolidationNumber} updated to ${status}`);
    console.log(`✅ ${updatedShipments.length} shipments updated to ${shipmentNewStatus}`);

    res.status(200).json({
      success: true,
      message: `Consolidation status updated to ${status}`,
      data: {
        consolidation,
        shipmentUpdates: updatedShipments,
        shipmentsUpdatedCount: updatedShipments.length
      }
    });

  } catch (error) {
    console.error('❌ Update consolidation status error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};
// ✅ Helper functions
function getLocationForStatus(status, consolidation) {
  const locationMap = {
    'arrived': consolidation.destinationPort || 'Destination Port',
    'customs_cleared': consolidation.destinationPort || 'Customs',
    'out_for_delivery': 'Out for Delivery',
    'delivered': 'Delivered',
    'completed': 'Completed',
    'dispatched': 'Dispatched',
    'in_transit': 'In Transit'
  };
  return locationMap[status] || consolidation.originWarehouse || 'Warehouse';
}

function getDescriptionForStatus(status, consolidation) {
  const descMap = {
    'arrived': `Shipment arrived at ${consolidation.destinationPort}`,
    'customs_cleared': 'Customs clearance completed',
    'out_for_delivery': 'Shipment out for delivery',
    'delivered': 'Shipment delivered successfully',
    'completed': 'Shipment completed',
    'dispatched': 'Shipment dispatched',
    'in_transit': 'Shipment in transit'
  };
  return descMap[status] || `Status updated to ${status}`;
}

// ========== 10. ADD SHIPMENTS TO EXISTING CONSOLIDATION ==========
exports.addShipmentsToConsolidation = async (req, res) => {
    try {
        const { id } = req.params;
        const { shipmentIds } = req.body;

        const consolidation = await Consolidation.findById(id);
        if (!consolidation) {
            return res.status(404).json({
                success: false,
                message: 'Consolidation not found'
            });
        }

        // Check if consolidation can accept more shipments
        if (consolidation.status !== 'draft' && consolidation.status !== 'in_progress') {
            return res.status(400).json({
                success: false,
                message: `Cannot add shipments to consolidation with status: ${consolidation.status}`
            });
        }

        // Get queue items for these shipments
        const queueItems = await ConsolidationQueue.find({
            shipmentId: { $in: shipmentIds },
            status: 'pending'
        }).populate('shipmentId');

        if (queueItems.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No pending shipments found with the provided IDs'
            });
        }

        // Verify all shipments match the consolidation's group
        const invalidItems = queueItems.filter(item => 
            item.mainType !== consolidation.mainType ||
            item.subType !== consolidation.subType ||
            item.origin !== consolidation.originWarehouse ||
            item.destination !== consolidation.destinationPort
        );

        if (invalidItems.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Some shipments do not match the consolidation type/destination',
                invalidShipments: invalidItems.map(i => i.trackingNumber)
            });
        }

        // Update consolidation
        const newShipmentIds = queueItems.map(q => q.shipmentId._id);
        consolidation.shipments.push(...newShipmentIds);
        
        // Recalculate totals
        for (const item of queueItems) {
            consolidation.totalShipments++;
            consolidation.totalPackages += item.totalPackages || 0;
            consolidation.totalWeight += item.totalWeight || 0;
            consolidation.totalVolume += item.totalVolume || 0;
            
            consolidation.items.push({
                shipmentId: item.shipmentId._id,
                packageType: 'Mixed',
                quantity: item.totalPackages || 1,
                description: `Shipment ${item.trackingNumber}`,
                weight: item.totalWeight || 0,
                volume: item.totalVolume || 0
            });
        }

        consolidation.updatedBy = req.user._id;
        await consolidation.save();

        // Update queue items
        await ConsolidationQueue.updateMany(
            { _id: { $in: queueItems.map(q => q._id) } },
            {
                $set: {
                    status: 'assigned',
                    consolidationId: consolidation._id,
                    assignedAt: new Date()
                }
            }
        );

        // Update shipments
        await Shipment.updateMany(
            { _id: { $in: newShipmentIds } },
            {
                $set: {
                    warehouseStatus: 'consolidated',
                    consolidationId: consolidation._id,
                    'transport.containerNumber': consolidation.containerNumber
                },
                $push: {
                    milestones: {
                        status: 'consolidated',
                        location: consolidation.originWarehouse,
                        description: `Added to consolidation ${consolidation.consolidationNumber}`,
                        timestamp: new Date(),
                        updatedBy: req.user._id
                    }
                }
            }
        );

        res.status(200).json({
            success: true,
            message: `Added ${queueItems.length} shipments to consolidation`,
            data: consolidation
        });

    } catch (error) {
        console.error('Add to consolidation error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ========== 11. REMOVE SHIPMENT FROM CONSOLIDATION ==========
// controllers/consolidationController.js

// Remove shipment from consolidation (delete shipment from container)
exports.removeShipmentFromConsolidation = async (req, res) => {
    try {
        const { consolidationId, shipmentId } = req.params;

        console.log('🗑️ Removing shipment from consolidation:', { consolidationId, shipmentId });

        // Find consolidation
        const consolidation = await Consolidation.findById(consolidationId);
        
        if (!consolidation) {
            return res.status(404).json({
                success: false,
                message: 'Consolidation not found'
            });
        }

        // Check if shipment exists in consolidation
        const shipmentIndex = consolidation.shipments.findIndex(
            s => s.toString() === shipmentId
        );

        if (shipmentIndex === -1) {
            return res.status(404).json({
                success: false,
                message: 'Shipment not found in this consolidation'
            });
        }

        // Remove shipment from consolidation
        const removedShipment = consolidation.shipments.splice(shipmentIndex, 1)[0];

        // Add timeline entry
        consolidation.timeline.push({
            status: 'cancelled',
            timestamp: new Date(),
            location: consolidation.originWarehouse || 'Warehouse',
            description: `Shipment ${shipmentId} removed from consolidation (cancelled)`,
            updatedBy: req.user._id,
            metadata: {
                shipmentId: shipmentId,
                action: 'remove',
                reason: 'cancelled'
            }
        });

        // Update totals
        // You may want to recalculate totals here
        consolidation.totalShipments = consolidation.shipments.length;
        
        // Recalculate total weight and volume if needed
        let totalWeight = 0;
        let totalVolume = 0;
        let totalPackages = 0;
        
        for (const shipId of consolidation.shipments) {
            const shipment = await Shipment.findById(shipId);
            if (shipment) {
                totalWeight += shipment.totalWeight || 0;
                totalVolume += shipment.totalVolume || 0;
                totalPackages += shipment.packages?.length || 0;
            }
        }
        
        consolidation.totalWeight = totalWeight;
        consolidation.totalVolume = totalVolume;
        consolidation.totalPackages = totalPackages;

        await consolidation.save();

        // Also update the shipment status
        const shipment = await Shipment.findById(shipmentId);
        if (shipment) {
            shipment.status = 'cancelled';
            shipment.cancelledAt = new Date();
            shipment.cancellationReason = 'Cancelled by admin';
            shipment.consolidationId = null;
            
            shipment.milestones = shipment.milestones || [];
            shipment.milestones.push({
                status: 'cancelled',
                location: 'System',
                description: 'Shipment removed from consolidation and cancelled',
                timestamp: new Date(),
                updatedBy: req.user._id
            });
            
            await shipment.save();
        }

        res.status(200).json({
            success: true,
            message: 'Shipment removed from consolidation successfully',
            data: consolidation
        });

    } catch (error) {
        console.error('❌ Remove shipment from consolidation error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// ========== 12. DELETE CONSOLIDATION (Draft only) ==========
exports.deleteConsolidation = async (req, res) => {
    try {
        const { id } = req.params;

        const consolidation = await Consolidation.findById(id);
        if (!consolidation) {
            return res.status(404).json({
                success: false,
                message: 'Consolidation not found'
            });
        }

        // Only allow deletion of draft consolidations
        if (consolidation.status !== 'draft') {
            return res.status(400).json({
                success: false,
                message: `Cannot delete consolidation with status: ${consolidation.status}`
            });
        }

        // Update queue items back to pending
        await ConsolidationQueue.updateMany(
            { consolidationId: consolidation._id },
            {
                $set: {
                    status: 'pending',
                    consolidationId: null,
                    assignedAt: null
                }
            }
        );

        // Update shipments
        await Shipment.updateMany(
            { _id: { $in: consolidation.shipments } },
            {
                $set: {
                    warehouseStatus: 'in_queue',
                    consolidationId: null
                },
                $push: {
                    milestones: {
                        status: 'consolidation_cancelled',
                        location: consolidation.originWarehouse,
                        description: `Consolidation ${consolidation.consolidationNumber} was cancelled`,
                        timestamp: new Date(),
                        updatedBy: req.user._id
                    }
                }
            }
        );

        // Delete the consolidation
        await consolidation.deleteOne();

        res.status(200).json({
            success: true,
            message: 'Consolidation deleted successfully'
        });

    } catch (error) {
        console.error('Delete consolidation error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ========== 13. GET CONSOLIDATION STATISTICS ==========
exports.getConsolidationStats = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        let dateQuery = {};
        if (startDate || endDate) {
            dateQuery.createdAt = {};
            if (startDate) dateQuery.createdAt.$gte = new Date(startDate);
            if (endDate) dateQuery.createdAt.$lte = new Date(endDate);
        }

        // Overall statistics
        const overall = await Consolidation.aggregate([
            { $match: dateQuery },
            { $group: {
                _id: null,
                totalConsolidations: { $sum: 1 },
                totalShipments: { $sum: '$totalShipments' },
                totalWeight: { $sum: '$totalWeight' },
                totalVolume: { $sum: '$totalVolume' },
                avgShipmentsPerConsolidation: { $avg: '$totalShipments' },
                avgWeightPerConsolidation: { $avg: '$totalWeight' },
                avgVolumePerConsolidation: { $avg: '$totalVolume' }
            }}
        ]);

        // Statistics by status
        const byStatus = await Consolidation.aggregate([
            { $match: dateQuery },
            { $group: {
                _id: '$status',
                count: { $sum: 1 },
                totalShipments: { $sum: '$totalShipments' },
                totalWeight: { $sum: '$totalWeight' }
            }}
        ]);

        // Statistics by type
        const byType = await Consolidation.aggregate([
            { $match: dateQuery },
            { $group: {
                _id: {
                    mainType: '$mainType',
                    subType: '$subType'
                },
                count: { $sum: 1 },
                totalShipments: { $sum: '$totalShipments' },
                totalWeight: { $sum: '$totalWeight' }
            }}
        ]);

        // Statistics by destination
        const byDestination = await Consolidation.aggregate([
            { $match: dateQuery },
            { $group: {
                _id: '$destinationPort',
                count: { $sum: 1 },
                totalShipments: { $sum: '$totalShipments' },
                totalWeight: { $sum: '$totalWeight' }
            }},
            { $sort: { totalWeight: -1 } },
            { $limit: 10 }
        ]);

        // Monthly trends
        const monthlyTrends = await Consolidation.aggregate([
            { $match: dateQuery },
            { $group: {
                _id: {
                    year: { $year: '$createdAt' },
                    month: { $month: '$createdAt' }
                },
                count: { $sum: 1 },
                totalShipments: { $sum: '$totalShipments' },
                totalWeight: { $sum: '$totalWeight' }
            }},
            { $sort: { '_id.year': -1, '_id.month': -1 } },
            { $limit: 12 }
        ]);

        res.status(200).json({
            success: true,
            data: {
                overall: overall[0] || {
                    totalConsolidations: 0,
                    totalShipments: 0,
                    totalWeight: 0,
                    totalVolume: 0
                },
                byStatus,
                byType: byType.map(item => ({
                    mainType: item._id.mainType,
                    subType: item._id.subType,
                    mainTypeName: getMainTypeName(item._id.mainType),
                    subTypeName: getSubTypeName(item._id.subType),
                    count: item.count,
                    totalShipments: item.totalShipments,
                    totalWeight: item.totalWeight
                })),
                byDestination,
                monthlyTrends: monthlyTrends.map(item => ({
                    year: item._id.year,
                    month: item._id.month,
                    monthName: new Date(item._id.year, item._id.month - 1, 1).toLocaleString('default', { month: 'long' }),
                    count: item.count,
                    totalShipments: item.totalShipments,
                    totalWeight: item.totalWeight
                }))
            }
        });

    } catch (error) {
        console.error('Get consolidation stats error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ========== 14. REMOVE FROM QUEUE ==========
exports.removeFromQueue = async (req, res) => {
    try {
        const { id } = req.params;

        const queueItem = await ConsolidationQueue.findById(id);
        if (!queueItem) {
            return res.status(404).json({
                success: false,
                message: 'Queue item not found'
            });
        }

        // Check if already consolidated
        if (queueItem.status === 'assigned' || queueItem.status === 'consolidated') {
            return res.status(400).json({
                success: false,
                message: `Cannot remove item with status: ${queueItem.status}`
            });
        }

        // Update shipment
        await Shipment.findByIdAndUpdate(queueItem.shipmentId, {
            $set: { warehouseStatus: 'received' },
            $push: {
                milestones: {
                    status: 'removed_from_queue',
                    description: 'Removed from consolidation queue',
                    timestamp: new Date(),
                    updatedBy: req.user._id
                }
            }
        });

        // Delete queue item
        await queueItem.deleteOne();

        res.status(200).json({
            success: true,
            message: 'Shipment removed from queue'
        });

    } catch (error) {
        console.error('Remove from queue error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ========== 15. BULK REMOVE FROM QUEUE ==========
exports.bulkRemoveFromQueue = async (req, res) => {
    try {
        const { queueItemIds } = req.body;

        if (!queueItemIds || !Array.isArray(queueItemIds) || queueItemIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Please provide queue item IDs array'
            });
        }

        const queueItems = await ConsolidationQueue.find({
            _id: { $in: queueItemIds },
            status: 'pending'
        });

        if (queueItems.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No pending queue items found'
            });
        }

        // Update shipments
        await Shipment.updateMany(
            { _id: { $in: queueItems.map(q => q.shipmentId) } },
            {
                $set: { warehouseStatus: 'received' },
                $push: {
                    milestones: {
                        status: 'removed_from_queue',
                        description: 'Removed from consolidation queue (bulk)',
                        timestamp: new Date(),
                        updatedBy: req.user._id
                    }
                }
            }
        );

        // Delete queue items
        await ConsolidationQueue.deleteMany({
            _id: { $in: queueItems.map(q => q._id) }
        });

        res.status(200).json({
            success: true,
            message: `Removed ${queueItems.length} items from queue`
        });

    } catch (error) {
        console.error('Bulk remove from queue error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ========== 16. GET AVAILABLE CONTAINER TYPES ==========
exports.getAvailableContainerTypes = async (req, res) => {
    try {
        const { totalVolume, mainType } = req.query;
        
        const containers = [
            { type: '20ft', maxVolume: 28, maxWeight: 28000, description: '20 feet Standard Container' },
            { type: '40ft', maxVolume: 58, maxWeight: 30000, description: '40 feet Standard Container' },
            { type: '40ft HC', maxVolume: 68, maxWeight: 30000, description: '40 feet High Cube Container' },
            { type: '45ft', maxVolume: 78, maxWeight: 30000, description: '45 feet High Cube Container' },
            { type: 'LCL', maxVolume: Infinity, maxWeight: Infinity, description: 'Less than Container Load' }
        ];
        
        let recommendations = containers;
        
        // Filter by volume if provided
        if (totalVolume) {
            const volume = parseFloat(totalVolume);
            recommendations = containers.filter(c => c.maxVolume >= volume);
            
            // Add recommendation
            const recommended = containers.find(c => c.maxVolume >= volume);
            if (recommended) {
                recommendations = recommendations.map(c => ({
                    ...c,
                    recommended: c.type === recommended.type
                }));
            }
        }
        
        // Filter by type if provided
        if (mainType === 'air_freight') {
            recommendations = [
                { type: 'ULD', maxVolume: 30, maxWeight: 5000, description: 'Unit Load Device (Air Freight)' }
            ];
        } else if (mainType === 'inland_trucking') {
            recommendations = [
                { type: 'Truck', maxVolume: 90, maxWeight: 24000, description: 'Full Truck Load' },
                { type: 'LTL', maxVolume: Infinity, maxWeight: Infinity, description: 'Less than Truck Load' }
            ];
        }
        
        res.status(200).json({
            success: true,
            data: recommendations
        });
        
    } catch (error) {
        console.error('Get container types error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};
// consolidationController.js
// controllers/consolidationController.js

// controllers/consolidationController.js

exports.markAsReadyForDispatch = async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('🚀 ===== MARK READY FOR DISPATCH =====');
    console.log('🚀 ID:', id);
    console.log('🚀 User:', req.user?._id || req.user?.id);
    
    // 1. Consolidation খুঁজুন
    const consolidation = await Consolidation.findById(id)
      .populate('shipments');
    
    if (!consolidation) {
      console.log('❌ Consolidation not found');
      return res.status(404).json({ 
        success: false, 
        message: 'Consolidation not found' 
      });
    }
    
    console.log('✅ Consolidation found:', consolidation.consolidationNumber);
    console.log('📦 Current status:', consolidation.status);
    
    // 2. স্ট্যাটাস চেক
    if (consolidation.status !== 'consolidated') {
      console.log('❌ Wrong status:', consolidation.status);
      return res.status(400).json({
        success: false,
        message: `Cannot mark as ready. Current status: ${consolidation.status}`
      });
    }
    
    // 3. ডকুমেন্ট চেক (optional - যদি documents থাকে)
    if (consolidation.documents && consolidation.documents.length > 0) {
      console.log('📄 Documents found:', consolidation.documents.length);
    } else {
      console.log('⚠️ No documents found, but continuing...');
    }
    
    // 4. স্ট্যাটাস আপডেট করুন
    consolidation.status = 'ready_for_dispatch';
    
    // 5. Timeline এ যোগ করুন
    if (!consolidation.timeline) {
      consolidation.timeline = [];
    }
    
    consolidation.timeline.push({
      status: 'ready_for_dispatch',
      timestamp: new Date(),
      description: `Marked ready for dispatch by ${req.user?.firstName || 'System'}`,
      updatedBy: req.user?._id
    });
    
    // 6. Save করুন
    await consolidation.save();
    console.log('✅ Status updated to ready_for_dispatch');
    
    // 7. সম্পর্কিত শিপমেন্ট আপডেট (optional)
    if (consolidation.shipments && consolidation.shipments.length > 0) {
      try {
        await Shipment.updateMany(
          { _id: { $in: consolidation.shipments.map(s => s._id) } },
          { 
            $set: { 
              status: 'ready_for_dispatch'
            }
          }
        );
        console.log('✅ Shipments updated');
      } catch (shipmentError) {
        console.error('⚠️ Shipment update error:', shipmentError);
        // Don't fail the whole request
      }
    }
    
    res.json({
      success: true,
      message: 'Consolidation marked as ready for dispatch',
      data: consolidation
    });

  } catch (error) {
    console.error('❌ Mark as ready error:', error);
    console.error('❌ Error stack:', error.stack);
    
    res.status(500).json({ 
      success: false, 
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// অটোমেটিক ভ্যালিডেশন ফাংশন
const validateForDispatch = async (consolidation) => {
  const missing = [];
  const warnings = [];
  const report = {};

  // 1. স্ট্যাটাস চেক
  if (consolidation.status !== 'consolidated') {
    missing.push('Status must be consolidated');
  }

  // 2. ডকুমেন্ট চেক
  const requiredDocs = ['packing_list', 'container_manifest'];
  const uploadedDocTypes = consolidation.documents.map(d => d.type);
  
  requiredDocs.forEach(doc => {
    if (!uploadedDocTypes.includes(doc)) {
      missing.push(`Missing document: ${doc}`);
    }
  });

  // 3. শিপমেন্ট চেক
  if (!consolidation.shipments || consolidation.shipments.length === 0) {
    missing.push('No shipments in consolidation');
  }

  // 4. কন্টেইনার চেক
  if (!consolidation.containerNumber) {
    missing.push('Container number required');
  }

  // 5. ওয়েট/ভলিউম চেক
  if (consolidation.totalWeight === 0) {
    warnings.push('Total weight is 0');
  }

  // 6. তারিখ চেক
  if (consolidation.estimatedDeparture) {
    const daysUntilDeparture = Math.ceil(
      (new Date(consolidation.estimatedDeparture) - new Date()) / (1000 * 60 * 60 * 24)
    );
    
    if (daysUntilDeparture < 0) {
      warnings.push('Estimated departure date has passed');
    }
    
    report.daysUntilDeparture = daysUntilDeparture;
  }

  // 7. পেমেন্ট চেক (অপশনাল)
  const unpaidShipments = consolidation.shipments.filter(
    s => s.payment?.status !== 'paid' && s.pricingStatus !== 'accepted'
  );
  
  if (unpaidShipments.length > 0) {
    warnings.push(`${unpaidShipments.length} shipment(s) have payment pending`);
  }

  return {
    ready: missing.length === 0,
    missing,
    warnings,
    report,
    summary: {
      totalChecks: 7,
      passed: 7 - missing.length,
      warnings: warnings.length,
      timestamp: new Date()
    }
  };
};
// controllers/consolidationController.js - একদম শেষে এই ফাংশন যোগ করুন

/**
 * Upload document to consolidation
 */
// controllers/consolidationController.js

/**
 * Upload document to consolidation
 */
// controllers/consolidationController.js

exports.uploadDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const { type, fileName, fileData, autoGenerated } = req.body;
    
    console.log('📄 Uploading document:', { type, fileName, autoGenerated });
    
    const consolidation = await Consolidation.findById(id);
    if (!consolidation) {
      return res.status(404).json({
        success: false,
        message: 'Consolidation not found'
      });
    }

    // Allowed types check
    const allowedTypes = ['packing_list', 'container_manifest', 'bill_of_lading', 'air_waybill', 'customs_docs', 'insurance_certificate'];
    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document type'
      });
    }

    // Documents array initialize
    if (!consolidation.documents) {
      consolidation.documents = [];
    }

    // 🔥🔥🔥 সব ডাটা সহ document object তৈরি করুন 🔥🔥🔥
    const document = {
      type: type,
      fileName: fileName,           // ← এইটা非常重要!
      fileData: fileData,           // ← এইটা非常重要! (base64 data)
      uploadedAt: new Date(),
      uploadedBy: req.user._id,
      autoGenerated: autoGenerated || true
    };

    // Duplicate check - যদি already থাকে তাহলে replace করুন
    const existingIndex = consolidation.documents.findIndex(d => d.type === type);
    if (existingIndex !== -1) {
      consolidation.documents[existingIndex] = document;
      console.log('🔄 Replaced existing document');
    } else {
      consolidation.documents.push(document);
      console.log('✅ Added new document');
    }

    await consolidation.save();
    
    console.log('✅ Document saved with fileName:', fileName);

    res.status(200).json({
      success: true,
      message: 'Document uploaded successfully',
      data: {
        type: document.type,
        fileName: document.fileName,
        uploadedAt: document.uploadedAt
      }
    });

  } catch (error) {
    console.error('❌ Upload error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
// controllers/consolidationController.js - নতুন ফাংশন

/**
 * Update individual shipment status inside consolidation (On Hold / Cancel / Resume)
 */
// controllers/consolidationController.js

exports.updateShipmentInConsolidation = async (req, res) => {
  try {
    const { consolidationId, shipmentId } = req.params;
    const { 
      status, 
      holdReason, 
      cancellationReason,
      notes,
      resumeFromHold
    } = req.body;

    console.log('📦 Updating shipment in consolidation:', { consolidationId, shipmentId, status });

    const consolidation = await Consolidation.findById(consolidationId)
      .populate('shipments');
    
    if (!consolidation) {
      return res.status(404).json({
        success: false,
        message: 'Consolidation not found'
      });
    }

    const shipmentExists = consolidation.shipments.some(
      s => s._id.toString() === shipmentId
    );
    
    if (!shipmentExists) {
      return res.status(404).json({
        success: false,
        message: 'Shipment not found in this consolidation'
      });
    }

    const shipment = await Shipment.findById(shipmentId);
    if (!shipment) {
      return res.status(404).json({
        success: false,
        message: 'Shipment not found'
      });
    }

    const previousStatus = shipment.status;
    let milestoneDescription = notes || '';
    let updateData = {};

    switch(status) {
      case 'on_hold':
        updateData = {
          status: 'on_hold',
          holdReason: holdReason || 'Manual hold by admin',
          heldAt: new Date(),
          holdSource: 'consolidation',
          consolidationId: consolidation._id,
          holdNotes: notes
        };
        milestoneDescription = `Shipment placed on hold within consolidation ${consolidation.consolidationNumber}. Reason: ${updateData.holdReason}`;
        console.log('⏸️ Shipment on hold:', shipment.trackingNumber);
        break;

      case 'cancelled':
        updateData = {
          status: 'cancelled',
          cancellationReason: cancellationReason || 'Cancelled from consolidation',
          cancelledAt: new Date(),
          cancelledBy: req.user._id,
          cancelledFromConsolidation: true,
          previousConsolidationId: consolidation._id
        };
        milestoneDescription = `Shipment cancelled and removed from consolidation ${consolidation.consolidationNumber}. Reason: ${updateData.cancellationReason}`;
        console.log('❌ Shipment cancelled:', shipment.trackingNumber);
        break;

      case 'resume':  // ✅ in_progress এর পরিবর্তে resume
      case 'in_progress':
        if (previousStatus === 'on_hold') {
          updateData = {
            status: 'pending',  // ✅ pending use করুন
            // অথবা আপনার business logic অনুযায়ী অন্য status
            resumedAt: new Date(),
            previousStatus: 'on_hold',
            holdReason: null,
            heldAt: null,
            holdSource: null,
            holdNotes: null
          };
          milestoneDescription = `Shipment resumed from hold within consolidation ${consolidation.consolidationNumber}. ${notes || ''}`;
          console.log('▶️ Shipment resumed:', shipment.trackingNumber);
        }
        break;

      default:
        return res.status(400).json({
          success: false,
          message: `Invalid status transition: ${previousStatus} → ${status}`
        });
    }

    Object.assign(shipment, updateData);
    shipment.updatedBy = req.user._id;

    if (!shipment.milestones) shipment.milestones = [];
    shipment.milestones.push({
      status: updateData.status || status,
      location: consolidation.originWarehouse || 'Consolidation',
      description: milestoneDescription,
      timestamp: new Date(),
      updatedBy: req.user._id
    });

    await shipment.save();

    // Handle cancellation
    if (status === 'cancelled') {
      consolidation.shipments = consolidation.shipments.filter(
        s => s._id.toString() !== shipmentId
      );

      if (consolidation.items) {
        consolidation.items = consolidation.items.filter(
          item => item.shipmentId?.toString() !== shipmentId
        );
      }

      const remainingShipments = await Shipment.find({
        _id: { $in: consolidation.shipments },
        status: { $nin: ['cancelled'] }
      });

      consolidation.totalShipments = remainingShipments.length;
      consolidation.totalPackages = remainingShipments.reduce((sum, s) => sum + (s.shipmentDetails?.totalPackages || 0), 0);
      consolidation.totalWeight = remainingShipments.reduce((sum, s) => sum + (s.shipmentDetails?.totalWeight || 0), 0);
      consolidation.totalVolume = remainingShipments.reduce((sum, s) => sum + (s.shipmentDetails?.totalVolume || 0), 0);

      if (!consolidation.cancelledShipments) {
        consolidation.cancelledShipments = [];
      }
      consolidation.cancelledShipments.push({
        shipmentId: shipment._id,
        trackingNumber: shipment.trackingNumber,
        reason: cancellationReason,
        cancelledAt: new Date(),
        cancelledBy: req.user._id
      });

      await consolidation.save();
    }

    // Add timeline entry to consolidation
    if (!consolidation.timeline) consolidation.timeline = [];
    consolidation.timeline.push({
      status: `shipment_${status}`,
      timestamp: new Date(),
      description: `Shipment ${shipment.trackingNumber} ${status === 'on_hold' ? 'on hold' : status === 'cancelled' ? 'cancelled' : 'resumed'}. ${notes || ''}`,
      updatedBy: req.user._id,
      shipmentId: shipment._id
    });
    
    await consolidation.save();

    res.status(200).json({
      success: true,
      message: `Shipment ${status === 'on_hold' ? 'put on hold' : 
                           status === 'cancelled' ? 'cancelled and removed' : 
                           'resumed'} successfully`,
      data: {
        shipment: {
          _id: shipment._id,
          trackingNumber: shipment.trackingNumber,
          status: shipment.status,
          ...(status === 'on_hold' && { holdReason: shipment.holdReason, heldAt: shipment.heldAt }),
          ...(status === 'cancelled' && { cancellationReason: shipment.cancellationReason, cancelledAt: shipment.cancelledAt })
        },
        consolidation: {
          _id: consolidation._id,
          consolidationNumber: consolidation.consolidationNumber,
          totalShipments: consolidation.totalShipments,
          totalWeight: consolidation.totalWeight,
          totalVolume: consolidation.totalVolume
        }
      }
    });

  } catch (error) {
    console.error('❌ Update shipment in consolidation error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
// controllers/shipmentController.js - trackByNumber ফাংশন

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

        console.log('📊 Tracking Data:', {
            trackingNumber: shipment.trackingNumber,
            status: shipment.status,
            milestonesCount: shipment.milestones?.length
        });

        // ✅ সব মাইলস্টোন সাজান (তারিখ অনুযায়ী)
        const sortedMilestones = [...(shipment.milestones || [])]
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        // ✅ ডেস্টিনেশন নির্ধারণ
        const destination = shipment.shipmentDetails?.destination || 
                           shipment.receiver?.address?.country || 
                           'UK';

        // ✅ টাইমলাইন তৈরি
        const timeline = sortedMilestones.map(m => {
            let location = m.location;
            let statusLabel = getStatusDisplayText(m.status);
            
            // লোকেশন ফরম্যাটিং
            if (m.status === 'arrived_at_destination_port') {
                location = destination;
            } else if (m.status === 'customs_cleared') {
                location = destination;
            } else if (m.status === 'out_for_delivery') {
                location = destination;
            } else if (m.status === 'delivered' || m.status === 'completed') {
                location = destination;
            }
            
            return {
                status: m.status,
                statusLabel: statusLabel,
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

        // ✅ বর্তমান স্ট্যাটাস এবং লোকেশন
        let currentLocation = 'Processing';
        let currentStatus = shipment.status;
        
        if (timeline.length > 0) {
            const latest = timeline[timeline.length - 1];
            currentLocation = latest.location || 'In Transit';
            currentStatus = latest.status;
        }

        // ✅ প্রগ্রেস ক্যালকুলেশন
        const progress = calculateShipmentProgress(shipment.status, sortedMilestones);

        res.status(200).json({
            success: true,
            data: {
                trackingNumber: shipment.trackingNumber,
                status: currentStatus,
                statusLabel: getStatusDisplayText(currentStatus),
                currentLocation: currentLocation,
                origin: shipment.shipmentDetails?.origin || 'China Warehouse',
                destination: destination,
                estimatedDeparture: shipment.estimatedDepartureDate,
                estimatedArrival: shipment.transport?.estimatedArrival || shipment.estimatedArrivalDate,
                actualDelivery: shipment.actualDeliveryDate,
                progress: progress,
                timeline: timeline,
                lastUpdate: shipment.updatedAt,
                sender: {
                    name: shipment.sender?.name,
                    country: shipment.sender?.address?.country
                },
                receiver: {
                    name: shipment.receiver?.name,
                    country: shipment.receiver?.address?.country
                },
                packages: (shipment.packages || []).map(pkg => ({
                    description: pkg.description,
                    quantity: pkg.quantity,
                    weight: pkg.weight,
                    volume: pkg.volume
                }))
            }
        });

    } catch (error) {
        console.error('Track by number error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ✅ হেল্পার ফাংশন
function getStatusDisplayText(status) {
    const labels = {
        'pending': 'Pending',
        'in_progress': 'In Progress',
        'consolidated': 'Consolidated',
        'ready_for_dispatch': 'Ready for Dispatch',
        'loaded_in_container': 'Loaded in Container',
        'dispatched': 'Dispatched',
        'in_transit': 'In Transit',
        'arrived_at_destination_port': 'Arrived at Port',
        'customs_cleared': 'Customs Cleared',
        'out_for_delivery': 'Out for Delivery',
        'delivered': 'Delivered',
        'completed': 'Completed',
        'cancelled': 'Cancelled',
        'on_hold': 'On Hold'
    };
    return labels[status] || status?.replace(/_/g, ' ') || 'Processing';
}

function calculateShipmentProgress(status, milestones) {
    const progressMap = {
        'pending': 10,
        'consolidated': 30,
        'ready_for_dispatch': 35,
        'loaded_in_container': 40,
        'dispatched': 45,
        'in_transit': 50,
        'arrived_at_destination_port': 70,
        'customs_cleared': 80,
        'out_for_delivery': 90,
        'delivered': 100,
        'completed': 100
    };
    
    // মাইলস্টোন থেকে সর্বোচ্চ প্রগ্রেস নিন
    let maxProgress = 0;
    for (const m of milestones) {
        const progress = progressMap[m.status] || 0;
        if (progress > maxProgress) {
            maxProgress = progress;
        }
    }
    
    return maxProgress > 0 ? maxProgress : (progressMap[status] || 0);
}
module.exports = exports;