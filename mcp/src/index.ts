// src/index.ts
// Sealer Protocol MCP Server
// Enables AI agents to interact with The Sealer Protocol onchain attestation platform

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { registerLeaderboardTools } from './tools/leaderboard.js';
import { registerAgentTools } from './tools/agent.js';
import { registerCommitmentTools } from './tools/commitment.js';
import { registerProtocolTools } from './tools/protocol.js';

function createServer(): McpServer {
  const server = new McpServer({
    name: 'sealer-mcp-server',
    version: '1.0.0',
  });

  // Register all tool groups
  registerLeaderboardTools(server);
  registerAgentTools(server);
  registerCommitmentTools(server);
  registerProtocolTools(server);

  return server;
}

async function runStdio(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Sealer MCP server running on stdio');
}

async function runHTTP(): Promise<void> {
  const app = express();
  app.use(express.json());

  app.post('/mcp', async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body as unknown);
  });

  const port = parseInt(process.env.PORT ?? '3000', 10);
  app.listen(port, () => {
    console.error(`Sealer MCP server running on http://localhost:${port}/mcp`);
  });
}

const transport = process.env.TRANSPORT ?? 'stdio';
if (transport === 'http') {
  runHTTP().catch((error: unknown) => {
    console.error('Server error:', error);
    process.exit(1);
  });
} else {
  runStdio().catch((error: unknown) => {
    console.error('Server error:', error);
    process.exit(1);
  });
}
