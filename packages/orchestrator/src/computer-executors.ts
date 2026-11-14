import type { ComputerActionExecutor } from './computer-action-broker.js';
import type { ComputerActionRequest } from '@neuralbridge/shared';

export interface AllowedApplicationLauncher { launch(application: 'spotify' | 'teams' | 'settings' | 'notepad' | 'calculator'): Promise<void>; typeText?(text: string, options?: { targetWindow?: string; targetElement?: { automationId?: string | undefined; name?: string | undefined; controlType?: string | undefined } }): Promise<void>; }

export interface ProjectTaskStarter { start(task: { prompt: string; projectId: string; externalRef?: { system: string; id: string; revision: number } }): Promise<unknown>; }

/** The request is the user's, confirmed in the panel; these limits hold whatever it says. */
const PROJECT_TASK_RULES = 'Pedido feito à Neura e confirmado pelo usuário no painel. Altere somente o que ele pede. Não faça commit, push, checkout ou merge.';

/** Safe computer executor seam: no arbitrary command or transcript text reaches the OS. */
export class AllowedApplicationExecutor implements ComputerActionExecutor {
  constructor(private readonly launcher: AllowedApplicationLauncher, private readonly projectTasks?: ProjectTaskStarter) {}

  async execute(request: ComputerActionRequest): Promise<string> {
    if (request.actionType === 'computer.type_chat_reply') {
      const text = request.payload?.text;
      if (!text || !this.launcher.typeText) throw new Error('blocked: text input is not configured');
      if (request.payload?.targetWindow || request.payload?.targetElement) await this.launcher.typeText(text, { ...(request.payload.targetWindow ? { targetWindow: request.payload.targetWindow } : {}), ...(request.payload.targetElement ? { targetElement: request.payload.targetElement } : {}) });
      else await this.launcher.typeText(text);
      return 'Resposta digitada na janela em foco.';
    }
    if (request.actionType === 'project.edit_task') {
      const { text, projectId } = request.payload ?? {};
      if (!text || !projectId || !this.projectTasks) throw new Error('blocked: project tasks are not configured');
      await this.projectTasks.start({ prompt: `${PROJECT_TASK_RULES}\n\n${text}`, projectId, externalRef: { system: 'void', id: `action/${request.actionId}`, revision: 1 } });
      return 'Tarefa iniciada no projeto.';
    }
    const match = /^computer\.open_app:(spotify|teams|settings|notepad|calculator)$/u.exec(request.actionType);
    if (!match) throw new Error('blocked: application is not in the allowlist');
    await this.launcher.launch(match[1] as 'spotify' | 'teams' | 'settings' | 'notepad' | 'calculator');
    return `Aplicativo ${match[1]} aberto.`;
  }
}
