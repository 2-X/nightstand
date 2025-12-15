import express, { Request, Response, Router } from 'express';

const router: Router = express.Router();

// ============================================================
// CONFIGURATION
// ============================================================
// How long before presence data is considered stale (in milliseconds)
// Default: 10 minutes (600000 ms)
const STALE_DATA_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
// ============================================================

// Interface for presence data structure
interface PresenceData {
  left: boolean | null;
  right: boolean | null;
  lastUpdated: {
    left: number | null;
    right: number | null;
  };
}

// In-memory storage for presence data
// Default values are null until first update
let presenceData: PresenceData = {
  left: null,
  right: null,
  lastUpdated: {
    left: null,
    right: null
  }
};

// Helper function to check if data is stale
const isDataStale = (timestamp: number | null): boolean => {
  if (!timestamp) return true;
  return Date.now() - timestamp > STALE_DATA_TIMEOUT_MS;
};

/**
 * POST /presence
 * Update presence data for one or both sides
 * 
 * Body examples:
 * - { "left": true } - Update left side only
 * - { "right": false } - Update right side only
 * - { "left": true, "right": false } - Update both sides
 * - {} - No side specified (invalid, returns 400)
 */
router.post('/presence', (req: Request, res: Response) => {
  try {
    const { left, right } = req.body;
    
    // Check if at least one side is provided
    if (left === undefined && right === undefined) {
      return res.status(400).json({
        error: 'At least one side (left or right) must be specified',
        message: 'Please provide "left" and/or "right" with boolean values'
      });
    }
    
    const currentTime = Date.now();
    
    // Update left side if provided
    if (left !== undefined) {
      if (typeof left !== 'boolean') {
        return res.status(400).json({
          error: 'Invalid value for left',
          message: 'Value must be a boolean (true or false)'
        });
      }
      presenceData.left = left;
      presenceData.lastUpdated.left = currentTime;
    }
    
    // Update right side if provided
    if (right !== undefined) {
      if (typeof right !== 'boolean') {
        return res.status(400).json({
          error: 'Invalid value for right',
          message: 'Value must be a boolean (true or false)'
        });
      }
      presenceData.right = right;
      presenceData.lastUpdated.right = currentTime;
    }
    
    return res.status(200).json({
      success: true,
      message: 'Presence data updated',
      data: {
        left: presenceData.left,
        right: presenceData.right,
        lastUpdated: presenceData.lastUpdated
      }
    });
    
  } catch (error) {
    console.error('Error updating presence:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: (error as Error).message
    });
  }
});

/**
 * GET /presence
 * Get presence data for one or both sides
 * 
 * Query parameters:
 * - ?side=left - Get left side presence only
 * - ?side=right - Get right side presence only
 * - (no params) - Get overall presence (true if either side has presence)
 */
router.get('/presence', (req: Request, res: Response) => {
  try {
    const { side } = req.query;
    
    // Check if data is available (not null and not stale)
    const isLeftAvailable = presenceData.left !== null && !isDataStale(presenceData.lastUpdated.left);
    const isRightAvailable = presenceData.right !== null && !isDataStale(presenceData.lastUpdated.right);
    
    // If specific side is requested
    if (side === 'left') {
      if (!isLeftAvailable) {
        return res.status(200).json({
          side: 'left',
          presence: 'not available',
          message: 'No recent data available for left side'
        });
      }
      
      return res.status(200).json({
        side: 'left',
        presence: presenceData.left,
        lastUpdated: presenceData.lastUpdated.left
      });
    }
    
    if (side === 'right') {
      if (!isRightAvailable) {
        return res.status(200).json({
          side: 'right',
          presence: 'not available',
          message: 'No recent data available for right side'
        });
      }
      
      return res.status(200).json({
        side: 'right',
        presence: presenceData.right,
        lastUpdated: presenceData.lastUpdated.right
      });
    }
    
    // No side specified - return overall presence
    // Overall presence is true if either side has presence
    if (!isLeftAvailable && !isRightAvailable) {
      return res.status(200).json({
        side: 'all',
        presence: 'not available',
        message: 'No recent data available for either side'
      });
    }
    
    // If only one side has data, use that
    let overallPresence: boolean;
    if (isLeftAvailable && !isRightAvailable) {
      overallPresence = presenceData.left as boolean;
    } else if (!isLeftAvailable && isRightAvailable) {
      overallPresence = presenceData.right as boolean;
    } else {
      // Both sides have data - presence if either side is true
      overallPresence = (presenceData.left as boolean) || (presenceData.right as boolean);
    }
    
    return res.status(200).json({
      side: 'all',
      presence: overallPresence,
      details: {
        left: isLeftAvailable ? presenceData.left : 'not available',
        right: isRightAvailable ? presenceData.right : 'not available'
      },
      lastUpdated: {
        left: presenceData.lastUpdated.left,
        right: presenceData.lastUpdated.right
      }
    });
    
  } catch (error) {
    console.error('Error retrieving presence:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: (error as Error).message
    });
  }
});

export default router;