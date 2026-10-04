import express from 'express';
import serverStatus from '../../serverStatus.js';
const router = express.Router();
// Answers only that the server and its event loop are alive. The health
// check asks every minute, and the full status below rewrites the services
// file each time.
router.get('/alive', (_req, res) => {
    res.status(204).end();
});
// Endpoint to list all log files as clickable links
router.get('/', async (req, res) => {
    const response = await serverStatus.toJSON();
    res.json(response);
});
export default router;
//# sourceMappingURL=serverStatus.js.map