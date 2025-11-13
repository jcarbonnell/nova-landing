// src/app/api/mcp-proxy/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const mcpPath = url.pathname.replace('/api/mcp-proxy', '/mcp');  
  const mcpUrl = `${process.env.MCP_URL || 'https://nova-mcp.fastmcp.app/mcp'}${mcpPath}${url.search}`.replace(/\/mcp\/mcp/, '/mcp');

  // Await headers() Promise
  const reqHeaders = await headers();
  const forwardHeaders = {
    'Content-Type': 'application/json',  // For MCP
    'Authorization': reqHeaders.get('Authorization') || '',  // Now safe after await
    'User-Agent': reqHeaders.get('User-Agent') || 'Nova-Landing/1.0',
  };

  try {
    const res = await fetch(mcpUrl, {
      method: 'GET',
      headers: forwardHeaders,
      // No body for GET
    });

    if (!res.ok) {
      return NextResponse.json({ error: `MCP error: ${res.status}` }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('MCP proxy error:', error);
    return NextResponse.json({ error: 'Proxy failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  // Similar for POST (tools like composite_upload)
  const url = new URL(request.url);
  const mcpPath = url.pathname.replace('/api/mcp-proxy', '/mcp');
  const mcpUrl = `${process.env.MCP_URL || 'https://nova-mcp.fastmcp.app/mcp'}${mcpPath}${url.search}`;

  const body = await request.json();
  // Await headers() Promise
  const reqHeaders = await headers();
  const forwardHeaders = {
    'Content-Type': 'application/json',
    'Authorization': reqHeaders.get('Authorization') || '',
    'User-Agent': reqHeaders.get('User-Agent') || 'Nova-Landing/1.0',
  };

  try {
    const res = await fetch(mcpUrl, {
      method: 'POST',
      headers: forwardHeaders,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      return NextResponse.json({ error: `MCP error: ${res.status}`, details: errorData }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('MCP POST proxy error:', error);
    return NextResponse.json({ error: 'Proxy failed' }, { status: 500 });
  }
}