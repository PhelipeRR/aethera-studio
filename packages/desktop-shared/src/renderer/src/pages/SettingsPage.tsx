import { useEffect, useState } from 'react';
import type { AppInfo, AppStatus, ThemeSource } from '@neuralbridge/shared/channels';
import { PageHeader } from '@/app/PageHeader';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { CompanionSettingsSection } from '@/features/companion/CompanionSettingsSection';
import { SpotifySettingsSection } from '@/features/companion/SpotifySettingsSection';
import { DevicesSettingsSection } from '@/features/core/DevicesSettingsSection';
import { NeuraSettingsSection } from '@/features/neura/NeuraSettingsSection';
import { SemanticSearchSection } from './SemanticSearchSection';
import { AzureDevOpsSettingsSection } from '@/features/integrations/AzureDevOpsSettingsSection';
import { AzureDevOpsReviewExtras } from '@/features/integrations/AzureDevOpsReviewExtras';
import { resolveAppIdentity } from '@/app/app-settings-isolation';
import { AetheraSettingsPage } from '@/features/aethera/AetheraSettingsPage';

const THEME_OPTIONS: { value: ThemeSource; label: string; hint: string }[] = [
  { value: 'dark', label: 'Escuro', hint: 'Padrão do Singularity.' },
  { value: 'light', label: 'Claro', hint: 'Para ambientes bem iluminados.' },
  { value: 'system', label: 'Sistema', hint: 'Acompanha o tema do Windows.' },
];

export function SettingsPage({ description }: { description: string }) {
  if (resolveAppIdentity() === 'aethera') {
    return <AetheraSettingsPage description={description} />;
  }
  const [theme, setTheme] = useState<ThemeSource | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.neuralbridge.theme.get().then(setTheme, () => setError('Não foi possível ler o tema salvo.'));
    window.neuralbridge.app.info().then(setInfo, () => setInfo(null));
    window.neuralbridge.app.status().then(setStatus, () => setStatus(null));
  }, []);

  const changeTheme = (value: string): void => {
    const next = THEME_OPTIONS.find((option) => option.value === value)?.value;
    if (!next) return;
    setTheme(next);
    setError(null);
    window.neuralbridge.theme.set(next).catch(() => setError('Não foi possível salvar o tema. A escolha vale só até fechar o app.'));
  };

  return (
    <>
      <PageHeader title="Configurações" description={description} />
      <div className="settings-sections max-w-2xl space-y-10 px-8 py-7">
        <section data-tour="settings-theme" aria-labelledby="appearance-heading">
          <h2 id="appearance-heading" className="text-base font-medium">
            Aparência
          </h2>
          <p className="mt-1 text-muted-foreground">O tema também muda a barra de título da janela.</p>
          {theme && (
            <RadioGroup value={theme} onValueChange={changeTheme} aria-labelledby="appearance-heading" className="mt-4 gap-1">
              {THEME_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  htmlFor={`theme-${option.value}`}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 hover:bg-accent"
                >
                  <RadioGroupItem id={`theme-${option.value}`} value={option.value} />
                  <span className="font-medium">{option.label}</span>
                  <span className="text-muted-foreground">{option.hint}</span>
                </label>
              ))}
            </RadioGroup>
          )}
          {error && (
            <p role="alert" className="mt-3 text-destructive">
              {error}
            </p>
          )}
        </section>

        <CompanionSettingsSection />

        <SpotifySettingsSection />
        <DevicesSettingsSection />

        <NeuraSettingsSection />

        <SemanticSearchSection />

        <AzureDevOpsSettingsSection />
        <AzureDevOpsReviewExtras />

        <section aria-labelledby="about-heading">
          <h2 id="about-heading" className="text-base font-medium">
            Sobre
          </h2>
          {info ? (
            <dl className="mt-3 grid grid-cols-[10rem_1fr] gap-y-1.5">
              <dt className="text-muted-foreground">Versão</dt>
              <dd className="font-mono text-[13px]">{info.version}</dd>
              <dt className="text-muted-foreground">Electron</dt>
              <dd className="font-mono text-[13px]">{info.electron}</dd>
              <dt className="text-muted-foreground">Plataforma</dt>
              <dd className="font-mono text-[13px]">{info.platform}</dd>
              {status && (
                <>
                  <dt className="text-muted-foreground">Banco de dados</dt>
                  <dd className="font-mono text-[13px] break-all">
                    {status.database.file}
                    {!status.database.ok && <span className="ml-2 font-sans text-destructive">(indisponível)</span>}
                  </dd>
                </>
              )}
            </dl>
          ) : (
            <p className="mt-3 text-muted-foreground">Informações indisponíveis.</p>
          )}
        </section>
      </div>
    </>
  );
}
