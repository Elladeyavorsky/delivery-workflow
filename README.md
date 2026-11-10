# delivery-workflow

Paquete [APM](https://github.com/microsoft/apm) para **Claude Code, Cursor y Codex** que lleva una tarea de GitHub desde la idea hasta la revisión, sin salir del chat del agente.

## Qué hace

1. **Piensa la tarea contigo** con preguntas, cada una con su respuesta recomendada.
2. **La deja escrita en GitHub:** issue con etiqueta, rama, commit `chore: open #N` y pull request en draft.
3. **Escribe la spec, el plan y las tasks** en la propia issue.
4. **La implementa en hasta nueve rondas** de código, tests y revisión de la documentación. Cada ronda deja un comentario en la issue.
5. **La cierra** con el commit final, el push y la petición de revisión.

Solo se para si a la spec le falta un dato, si aparece un secreto o si falla la novena ronda.

> Probado de punta a punta en Claude Code en macOS. En Cursor, Codex y Windows solo se ha comprobado la instalación o está sin probar.

## Requisitos

- Un proyecto con git y un remoto `origin` en GitHub en el que puedas escribir.
- [GitHub CLI](https://cli.github.com) (`gh`) con sesión, Node 20 o superior y APM.
- Un token de GitHub en la variable `GITHUB_TOKEN`.

## Instalación en macOS y Linux

1. Prepara el equipo, una sola vez:

   ```bash
   brew install gh node apm          # sin Homebrew: curl -sSL https://aka.ms/apm-unix | sh
   gh auth login
   echo 'export GITHUB_TOKEN=$(gh auth token)' >> ~/.zshrc   # o ~/.bashrc
   ```

2. Instala el paquete desde la raíz del proyecto. En `--target` pon tu herramienta: `claude`, `cursor`, `codex` o varias separadas por comas.

   ```bash
   env -u GITHUB_TOKEN apm install venturars/delivery-workflow#v0.1.0 --target claude
   ```

   `env -u GITHUB_TOKEN` evita que el valor del token acabe escrito en la configuración del MCP. Mientras no exista `v0.1.0`, usa `#staging`.

3. Haz commit de `apm.yml` y `apm.lock.yaml`.

4. Abre tu herramienta **desde la terminal**, para que vea `GITHUB_TOKEN`:
   - **Claude Code:** `claude` y acepta el servidor `github`.
   - **Cursor:** `cursor .` y activa el servidor `github` en *Settings → MCP*.
   - **Codex:** `codex` y marca el proyecto como de confianza.

5. Escribe `/check-status` (en Codex, `$check-status`). Tiene que mostrar la rama base, el token, la sesión de `gh` y Node 20 o más.

## Instalación en Windows

Los scripts del paquete son de `bash`, así que en Windows hacen falta una terminal y un entorno de tipo Unix. Elige una opción.

### Opción A: WSL (recomendada, vale para las tres herramientas)

1. En PowerShell como administrador: `wsl --install`, y reinicia.
2. Abre **Ubuntu**, clona el proyecto dentro de WSL (por ejemplo, en `~/proyectos`) y sigue [Instalación en macOS y Linux](#instalación-en-macos-y-linux). Sin Homebrew:

   ```bash
   sudo apt update && sudo apt install -y gh
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
   source ~/.bashrc && nvm install 22      # el Node de apt puede ser anterior a 20
   curl -sSL https://aka.ms/apm-unix | sh
   ```

3. Abre la herramienta desde la terminal de Ubuntu: `claude`, `codex` o `cursor .` (Cursor abre el proyecto conectado a WSL).

### Opción B: Git Bash (solo Claude Code)

1. Instala [Git for Windows](https://git-scm.com/download/win), que trae Git Bash. Claude Code lo usa para lanzar comandos.
2. En PowerShell:

   ```powershell
   winget install --id GitHub.cli
   winget install --id OpenJS.NodeJS.LTS
   winget install --id Microsoft.APM --exact --source winget
   ```

3. Abre **Git Bash** y sigue los pasos de [Instalación en macOS y Linux](#instalación-en-macos-y-linux) desde el paso 1, saltándote `brew`. El token va en `~/.bashrc`.

## Uso

Llama al orquestador con `/delivery-workflow` (en Codex, `$delivery-workflow`) y pide lo que quieras con tus palabras:

| Pide | Qué pasa |
|---|---|
| «Ayúdame a pensar cómo contar usuarios por género» | Una entrevista y un resumen. |
| «Crea la issue y hazla: …» | Todo el flujo, de la issue al commit final. |
| «Crea la issue, solo git: …» | Hasta la pull request en draft. El código lo escribes tú. |
| «Guarda `src/users.js` con feat: count users by gender» | Commit de esos ficheros y push. |
| «Que la revisen Ana y Luis» | Pide la revisión y saca la pull request de draft. |

**Tipos de tarea:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore` y `knowledge`. Las ramas se llaman `número-tipo-descripcion`.

**Rama base:** `GIT_WORKFLOW_BASE` si está definida, si no `staging` si existe, y si no la rama por defecto.

## Permisos

La primera vez que el flujo lanza `bash`, `node`, `git` o `gh`, la herramienta pide permiso. En Claude Code puedes aprobarlos de una vez en `.claude/settings.local.json`, solo en proyectos en los que confíes:

```json
{ "permissions": { "allow": ["Bash(bash:*)", "Bash(node:*)", "Bash(git:*)", "Bash(gh:*)"] } }
```

## Proyecto en equipo

Si en el proyecto cada persona usa una herramienta distinta, **una sola persona** instala para las tres, en una pull request `chore`:

```bash
env -u GITHUB_TOKEN apm install venturars/delivery-workflow#v0.1.0 --target claude,cursor,codex
grep -nE 'gh[pousr]_|github_pat_' .mcp.json .cursor/mcp.json .codex/config.toml || echo "Sin tokens."
```

Si el `grep` encuentra un token, no hagas commit. Si no, añade `.claude/settings.local.json` a `.gitignore` y haz commit de `apm.yml`, `apm.lock.yaml`, `.gitignore`, `.mcp.json`, `.claude/`, `.cursor/`, `.codex/` y `.agents/`.

El resto solo hace pull: no necesita APM, pero sí `gh`, Node y `GITHUB_TOKEN`. Nadie más lanza `apm install`, porque reescribiría el lockfile.

## Actualizar y desinstalar

- **Actualizar:** cambia la versión en `apm.yml` (por ejemplo, `#v0.2.0`), lanza `env -u GITHUB_TOKEN apm install` y haz commit.
- **Desinstalar:** `apm uninstall venturars/delivery-workflow`. El servidor `github` se queda en la configuración del MCP: bórralo a mano si no lo usas.

## Más información

- [CAMBIOS.md](CAMBIOS.md): de dónde sale el paquete y qué cambia respecto al original.
- [docs/MANTENIMIENTO.md](docs/MANTENIMIENTO.md): tests, prueba en un repositorio desechable y cómo publicar una versión.
- [docs/adr/](docs/adr/) y [GLOSSARY.md](GLOSSARY.md): decisiones de diseño y vocabulario.
