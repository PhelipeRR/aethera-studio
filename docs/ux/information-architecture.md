# NeuralBridge information architecture — Task 3.1

The shell has four stable navigation groups:

- **Trabalho:** Dashboard, Chat, Execuções, Projetos, Workflows, Mission Control, and enabled Velix.
- **Conhecimento:** Memória, Skills, and Analytics.
- **Integrações:** Git Intelligence, Azure/TFS, Agentes, and MCPs.
- **Configurações:** Extensions and Configurações.

Chat, Execuções, and Projetos remain the primary work path. Existing hash paths
are preserved, including nested project/run/memory deep links and `/video`.
The `/video` route remains addressable for compatibility but shows a clear
extension-unavailable state unless the Velix extension is enabled.

The Extensions page is a renderer-only consumer of typed preload methods. It
does not duplicate install logic: checksum, signature, compatibility, staging,
rollback, and persistence remain in the Core process. Installation and
uninstallation are explicit actions; uninstall states that user data is not
removed and requires confirmation.

The shell uses the existing palette, Inter typography, visible focus rings,
compact density, and reduced-motion-compatible transitions from
`design-system/neuralbridge-intelligent-workspace/MASTER.md`.
