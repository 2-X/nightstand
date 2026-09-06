import express from 'express';
import { frankenCommands, executeFunction } from '../../8sleep/deviceApi.js';
import { isArgWithinBounds } from './executeHelpers.js';
import { recordConfigAudit } from '../../db/collector.js';
const router = express.Router();
router.post('/execute', async (req, res) => {
    const { command, arg } = req.body;
    // Basic validation
    if (!Object.keys(frankenCommands).includes(command)) {
        res.status(400).send('Invalid command');
        return;
    }
    if (!isArgWithinBounds(command, arg)) {
        res.status(400).send(`Invalid arg for ${command}`);
        return;
    }
    // Execute the 8sleep command
    await executeFunction(command, arg || 'empty');
    recordConfigAudit('execute', 'POST /api/execute', { command, arg: arg ?? null });
    // Respond with success
    res.json({ success: true, message: `Command '${command}' executed successfully.` });
    return;
});
export default router;
//# sourceMappingURL=execute.js.map