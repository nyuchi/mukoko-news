#!/usr/bin/env node
/**
 * Stdio ↔ HTTP bridge for the Mukoko News MCP server.
 *
 * Usage (Claude Desktop / Cursor / any stdio MCP client):
 *   npx @nyuchi/mukoko-news-mcp
 *
 * Or install globally:
 *   npm i -g @nyuchi/mukoko-news-mcp
 *   mukoko-news-mcp
 */

'use strict';

const MCP_URL = 'https://news.mukoko.com/mcp';

process.stdin.setEncoding('utf8');
let buffer = '';

process.stdin.on('data', async (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop(); // retain any incomplete trailing line

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let request;
    try {
      request = JSON.parse(trimmed);
    } catch {
      writeResponse({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }

    // Notifications have no id and expect no response
    if (request.id === undefined || request.id === null) {
      if (typeof request.method === 'string' && request.method.startsWith('notifications/')) {
        // Fire-and-forget: still forward so server can track state
        fetch(MCP_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        }).catch(() => {});
        continue;
      }
    }

    try {
      const res = await fetch(MCP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (res.status === 204) continue;

      const text = await res.text();
      if (text.trim()) writeResponse(JSON.parse(text));
    } catch (err) {
      writeResponse({
        jsonrpc: '2.0',
        id: request.id ?? null,
        error: { code: -32603, message: String(err) },
      });
    }
  }
});

process.stdin.on('end', () => process.exit(0));

function writeResponse(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}
