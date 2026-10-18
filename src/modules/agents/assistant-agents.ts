/**
 * @file ผู้ช่วยประจำวัน — เตือนความจำ · ปฏิทิน · ติดต่อ (ลงทะเบียนตอน boot)
 */

import { agentRegistry, type AgentRegistry } from '../../core/agents/AgentRegistry';
import { installNotificationHandler } from '../../features/today/notifications';
import { registerCalendarAgent } from './calendar-agent';
import { registerContactAgent } from './contact-agent';
import { registerReminderAgent } from './reminder-agent';

/** เรียกซ้ำได้ (fast refresh / bootApp ซ้ำ) */
export function registerAssistantAgents(registry: AgentRegistry = agentRegistry): void {
  installNotificationHandler();
  registerReminderAgent(registry);
  registerCalendarAgent(registry);
  registerContactAgent(registry);
}
