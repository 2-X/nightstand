import express, { Request, Response, Router } from 'express';
import moment from 'moment-timezone';

const router: Router = express.Router();

// ============================================================
// CONFIGURATION
// ============================================================
// How long before presence data is considered stale (in milliseconds)
// Default: 10 minutes (600000 ms)
const STALE_DATA_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
// ============================================================

// Interface for side presence data
interface SidePresent {
  present: boolean;
  lastUpdatedAt: string; // Human readable timestamp with moment.tz().format()
  isStale: boolean;
}

// Interface for complete presence data
interface PresenceData {
  left: SidePresent;
  right: SidePresent;
}

// Internal storage structure
interface InternalPresenceData {
  left: boolean | null;
  right: boolean | null;
  lastUpdated: {
    left: number | null;
    right: number | null;
  };
}

// In-memory storage for presence data
// Default values are null until first update
const presenceData: InternalPresenceData = {
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

// Helper function to format side data
const formatSideData = (present: boolean | null, timestamp: number | null): SidePresent => {
  const stale = isDataStale(timestamp);
  return {
    present: present ?? false,
    lastUpdatedAt: timestamp ? moment(timestamp).tz('America/New_York').format() : 'never',
    isStale: stale
  };
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
 * Get presence data for both sides
 * 
 * Query parameters:
 * - ?side=left - Get left side presence only (returns single SidePresent object)
 * - ?side=right - Get right side presence only (returns single SidePresent object)
 * - (no params) - Get both sides (returns PresenceData object)
 */
router.get('/presence', (req: Request, res: Response) => {
  try {
    const { side } = req.query;
    
    // If specific side is requested, return just that side
    if (side === 'left') {
      return res.status(200).json(formatSideData(presenceData.left, presenceData.lastUpdated.left));
    }
    
    if (side === 'right') {
      return res.status(200).json(formatSideData(presenceData.right, presenceData.lastUpdated.right));
    }
    
    // No side specified - return both sides
    const response: PresenceData = {
      left: formatSideData(presenceData.left, presenceData.lastUpdated.left),
      right: formatSideData(presenceData.right, presenceData.lastUpdated.right)
    };
    
    return res.status(200).json(response);
    
  } catch (error) {
    console.error('Error retrieving presence:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: (error as Error).message
    });
  }
});

export default router;