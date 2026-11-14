import { PageHeader } from '@/app/PageHeader';
import { AzureDevOpsWorkspace } from '@/features/integrations/AzureDevOpsWorkspace';

export function AzureDevOpsPage({ description }: { description: string }) {
  return <div className="flex min-h-0 flex-1 flex-col overflow-y-auto"><PageHeader title="Azure / TFS" description={description} /><AzureDevOpsWorkspace /></div>;
}
