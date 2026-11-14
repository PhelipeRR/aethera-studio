/** Files that say a folder is software. New technologies are one more line here, not a change to the scan. */
export interface ProjectDetector {
  id: string;
  label: string;
  points: number;
  matches: (name: string) => boolean;
  /** A manifest of a tool that groups several projects. */
  monorepo?: boolean;
}

const exact = (...names: string[]) => (name: string) => names.includes(name);
const pattern = (expression: RegExp) => (name: string) => expression.test(name);

export const PROJECT_DETECTORS: ProjectDetector[] = [
  { id: 'dotnet-solution', label: '.NET', points: 50, matches: pattern(/\.(sln|slnx)$/i), monorepo: true },
  { id: 'dotnet-project', label: '.NET', points: 50, matches: pattern(/\.(csproj|fsproj)$/i) },
  { id: 'maven', label: 'Java', points: 50, matches: exact('pom.xml') },
  { id: 'gradle', label: 'Java', points: 50, matches: pattern(/^build\.gradle(\.kts)?$/) },
  { id: 'rust', label: 'Rust', points: 50, matches: exact('Cargo.toml') },
  { id: 'go', label: 'Go', points: 50, matches: exact('go.mod') },
  { id: 'python', label: 'Python', points: 50, matches: exact('pyproject.toml') },
  { id: 'python-legacy', label: 'Python', points: 30, matches: exact('requirements.txt', 'setup.py', 'Pipfile') },
  { id: 'pnpm-workspace', label: 'Node.js', points: 30, matches: exact('pnpm-workspace.yaml'), monorepo: true },
  { id: 'turbo', label: 'Node.js', points: 30, matches: exact('turbo.json'), monorepo: true },
  { id: 'nx', label: 'Node.js', points: 30, matches: exact('nx.json'), monorepo: true },
  { id: 'go-work', label: 'Go', points: 30, matches: exact('go.work'), monorepo: true },
  { id: 'gradle-settings', label: 'Java', points: 30, matches: pattern(/^settings\.gradle(\.kts)?$/), monorepo: true },
  { id: 'dotnet-props', label: '.NET', points: 30, matches: exact('global.json', 'Directory.Build.props') },
  { id: 'angular', label: 'Angular', points: 20, matches: exact('angular.json') },
  { id: 'vite', label: 'Vite', points: 20, matches: pattern(/^vite\.config\./) },
  { id: 'next', label: 'Next.js', points: 20, matches: pattern(/^next\.config\./) },
  { id: 'nuxt', label: 'Nuxt', points: 20, matches: pattern(/^nuxt\.config\./) },
  { id: 'lockfile', label: 'Node.js', points: 10, matches: exact('yarn.lock', 'package-lock.json', 'pnpm-lock.yaml') },
];

export const FRAMEWORK_LABELS: Record<string, string> = { next: 'Next.js', react: 'React', vue: 'Vue', nuxt: 'Nuxt', '@angular/core': 'Angular', vite: 'Vite', express: 'Express', '@nestjs/core': 'NestJS', electron: 'Electron', typescript: 'TypeScript' };

export const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs|vue|svelte|cs|fs|vb|java|kt|py|rs|go|rb|php|cpp|c|h|swift)$/i;
export const SOURCE_FOLDERS = new Set(['src', 'lib', 'app', 'pages', 'cmd', 'internal']);
export const SKIPPED_FOLDERS = new Set(['node_modules', 'dist', 'build', 'bin', 'obj', 'out', 'target', 'coverage', '__pycache__', 'venv', 'tmp', 'temp']);
