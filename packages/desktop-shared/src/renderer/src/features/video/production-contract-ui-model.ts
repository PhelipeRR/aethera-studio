import {
  extractProductionContract,
  type ContractConflict,
  type ContractControlField,
  type ProductionContractControls,
} from '@neuralbridge/cinema/browser';

export type ProductionControlDraft = ProductionContractControls;

export interface PromptControlSyncState {
  prompt: string;
  controls: ProductionControlDraft;
  inferredControls: Partial<ProductionControlDraft>;
  manualFields: ContractControlField[];
  conflicts: ContractConflict[];
}

export function syncPromptToControls(
  prompt: string,
  controls: ProductionControlDraft,
  manualFields: readonly ContractControlField[],
): PromptControlSyncState {
  const contract = extractProductionContract({
    projectId: 'ui-draft',
    prompt,
    controls,
    manuallyChangedFields: [...manualFields],
  });
  return {
    prompt,
    controls: contract.controls,
    inferredControls: contract.inferredControls,
    manualFields: [...manualFields],
    conflicts: contract.conflicts,
  };
}

export function resolveContractControlConflict(
  state: PromptControlSyncState,
  field: ContractControlField,
  resolution: 'use_prompt' | 'keep_manual',
): PromptControlSyncState {
  const conflict = state.conflicts.find((item) => item.field === field);
  if (!conflict) return state;
  if (resolution === 'keep_manual') {
    return { ...state, conflicts: state.conflicts.filter((item) => item.field !== field) };
  }
  const nextControls = { ...state.controls, [field]: conflict.promptValue } as ProductionControlDraft;
  const nextManualFields = state.manualFields.filter((item) => item !== field);
  const next = syncPromptToControls(state.prompt, nextControls, nextManualFields);
  return { ...next, conflicts: next.conflicts.filter((item) => item.field !== field) };
}

export function markControlAsManual(
  state: PromptControlSyncState,
  field: ContractControlField,
  value: ProductionControlDraft[ContractControlField],
): PromptControlSyncState {
  const manualFields = state.manualFields.includes(field) ? state.manualFields : [...state.manualFields, field];
  return syncPromptToControls(state.prompt, { ...state.controls, [field]: value } as ProductionControlDraft, manualFields);
}
