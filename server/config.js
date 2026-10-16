import 'dotenv/config';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Project traces/checkpoints stay on disk; do not inherit host tracing credentials.
process.env.LANGSMITH_TRACING='false';
process.env.LANGCHAIN_TRACING_V2='false';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = path.resolve(ROOT, process.env.AGENT_DATA_DIR || '.agent-data');
export const PORT = Number(process.env.AGENT_PORT || 8787);
export const BASE = `http://127.0.0.1:${PORT}`;
export const MAX_GLB = 100 * 1024 * 1024;
export const MAX_ATTACHMENT = 20 * 1024 * 1024;
export const configured = () => Boolean(process.env.AGENT_MODEL && process.env.AGENT_API_KEY);
