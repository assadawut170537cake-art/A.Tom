import { ProviderError } from '../../../core/http/errors';
import { moduleRegistry, type ModuleRegistry } from '../../../core/modules/ModuleRegistry';
import { isCommandModule } from '../../../core/modules/types';
import { DEFAULT_PERSONA } from '../../jarvis/constants';
import type { HandlerResult, IntentHandler, RouteOf, RouterInput } from '../core/types';

export const PC_BRIDGE_MODULE_ID = 'pc-bridge';

/** Reply while no PC bridge module is installed (unchanged from Phase 3). */
export const PC_BRIDGE_STUB_REPLY = 'Phase 4 ครับ';

/**
 * Hands PC commands to the `pc-bridge` module when it is registered, enabled and can execute
 * commands (initialising it on first use). Otherwise keeps the Phase 3 stub reply.
 * TODO(phase-4.5): the pc-bridge module itself (desktop companion + transport).
 */
export class PCCommandHandler implements IntentHandler<'pc_command'> {
  constructor(private readonly modules: ModuleRegistry = moduleRegistry) {}

  async handle(input: RouterInput, route?: RouteOf<'pc_command'>): Promise<HandlerResult> {
    const persona = input.context?.activePersona ?? DEFAULT_PERSONA;
    const bridge = this.modules.get(PC_BRIDGE_MODULE_ID);
    if (!bridge || !this.modules.isEnabled(PC_BRIDGE_MODULE_ID) || !isCommandModule(bridge)) {
      return { reply: PC_BRIDGE_STUB_REPLY, persona };
    }
    try {
      await this.modules.ensureReady(PC_BRIDGE_MODULE_ID);
      const { reply } = await bridge.execute({
        text: input.text,
        action: route?.entities?.action,
        target: route?.entities?.target,
      });
      return { reply, persona };
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      // Not a network problem: report it as a module failure so the chat shows the right advice
      const reason = e instanceof Error ? e.message : String(e);
      throw new ProviderError(PC_BRIDGE_MODULE_ID, 'unsupported', `สั่งงานคอมไม่สำเร็จ: ${reason}`);
    }
  }
}
