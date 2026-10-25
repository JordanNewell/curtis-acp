#!/usr/bin/env node
// curtis-acp — Curtis AI as an ACP agent (Zed + any ACP client).
// Speaks JSON-RPC 2.0 over stdio via @zed-industries/agent-client-protocol.

import "./log.js";
import { AgentSideConnection, ndJsonStream } from "@zed-industries/agent-client-protocol";
import { Readable, Writable } from "node:stream";
import { CurtisAgent } from "./agent.js";
import { ready } from "./config.js";

// Complete provider bootstrap (local model discovery) before the first ACP
// request arrives — stdio buffers meanwhile, so nothing is lost.
await ready;

const input = Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>;
const output = Writable.toWeb(process.stdout) as unknown as WritableStream<Uint8Array>;

const stream = ndJsonStream(output, input);
new AgentSideConnection((conn) => new CurtisAgent(conn), stream);
