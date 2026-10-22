/**
 * @file SuperMemory Central Memory Bridge
 * Unified bridge for A.T.O.M. / J.A.R.V.I.S. / F.R.I.D.A.Y. / U.L.T.R.O.N.
 * Connects to the 4 canonical SuperMemory namespaces:
 * - atom_core: Operational sessions, critical milestones, hub state
 * - atom_knowledge: Technical blueprints, architecture decisions, verified code patterns
 * - atom_ideas: Future features, user requests, backlog ideas
 * - atom_user: Boss's habits, rules, commands, preferences
 */

import fs from 'node:fs';
import path from 'node:path';

function getApiKey() {
  const envPaths = [
    'J:/Cloude/A.Tom/.env',
    'J:/Mark-LV/.env',
  ];
  for (const ep of envPaths) {
    if (fs.existsSync(ep)) {
      const content = fs.readFileSync(ep, 'utf-8');
      const match = content.match(/SUPERMEMORY_API_KEY=([^\r\n]+)/);
      if (match && match[1].trim()) return match[1].trim();
    }
  }
  return process.env.SUPERMEMORY_API_KEY || '';
}

export const CANONICAL_NAMESPACES = {
  atom_core: 'project_atom_memory_base_4folders_atom_core',
  atom_knowledge: 'project_atom_memory_base_4folders_atom_knowledge',
  atom_ideas: 'project_atom_memory_base_4folders_atom_ideas',
  atom_user: 'project_atom_memory_base_4folders_atom_user',
};

const BASE_URL = 'https://api.supermemory.ai';

export async function searchMemory(container, query, limit = 5) {
  const ns = CANONICAL_NAMESPACES[container] || CANONICAL_NAMESPACES.atom_core;
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('SUPERMEMORY_API_KEY is not configured');

  const res = await fetch(`${BASE_URL}/ns/${ns}/search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, limit }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`SuperMemory search failed [${res.status}]: ${errText}`);
  }

  return await res.json();
}

export async function addMemory(container, content, metadata = {}) {
  const ns = CANONICAL_NAMESPACES[container] || CANONICAL_NAMESPACES.atom_core;
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('SUPERMEMORY_API_KEY is not configured');

  const res = await fetch(`${BASE_URL}/ns/${ns}/document`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content,
      metadata: {
        timestamp: new Date().toISOString(),
        author: metadata.author || 'A.T.O.M.',
        ...metadata,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`SuperMemory add failed [${res.status}]: ${errText}`);
  }

  return await res.json();
}

export async function listNamespaces() {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('SUPERMEMORY_API_KEY is not configured');

  const res = await fetch(`${BASE_URL}/namespaces`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) throw new Error(`SuperMemory list failed [${res.status}]`);
  return await res.json();
}
