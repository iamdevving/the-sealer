"use strict";
// src/index.ts
// Sealer Protocol MCP Server
// Enables AI agents to interact with The Sealer Protocol onchain attestation platform
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const streamableHttp_js_1 = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const express_1 = __importDefault(require("express"));
const leaderboard_js_1 = require("./tools/leaderboard.js");
const agent_js_1 = require("./tools/agent.js");
const commitment_js_1 = require("./tools/commitment.js");
const protocol_js_1 = require("./tools/protocol.js");
function createServer() {
    const server = new mcp_js_1.McpServer({
        name: 'sealer-mcp-server',
        version: '1.0.0',
    });
    // Register all tool groups
    (0, leaderboard_js_1.registerLeaderboardTools)(server);
    (0, agent_js_1.registerAgentTools)(server);
    (0, commitment_js_1.registerCommitmentTools)(server);
    (0, protocol_js_1.registerProtocolTools)(server);
    return server;
}
async function runStdio() {
    const server = createServer();
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    console.error('Sealer MCP server running on stdio');
}
async function runHTTP() {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.post('/mcp', async (req, res) => {
        const server = createServer();
        const transport = new streamableHttp_js_1.StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
        });
        res.on('close', () => transport.close());
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    });
    const port = parseInt(process.env.PORT ?? '3000', 10);
    app.listen(port, () => {
        console.error(`Sealer MCP server running on http://localhost:${port}/mcp`);
    });
}
const transport = process.env.TRANSPORT ?? 'stdio';
if (transport === 'http') {
    runHTTP().catch((error) => {
        console.error('Server error:', error);
        process.exit(1);
    });
}
else {
    runStdio().catch((error) => {
        console.error('Server error:', error);
        process.exit(1);
    });
}
//# sourceMappingURL=index.js.map