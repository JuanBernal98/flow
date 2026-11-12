---
name: flow-mr-open
description: Crea el MR de la rama actual, envía la petición de review al canal de Slack del equipo y pasa el ticket de YouTrack a Review, cada cosa solo tras la aprobación del usuario. Úsalo cuando llegue un evento "flow request: mr-open [<ID>]" del watcher (el usuario pulsó P), o cuando el usuario pida abrir el MR.
argument-hint: "[locally|staging|tests]"
---

Publica el trabajo de la rama actual. Responde en español. Argumento opcional (cómo se probó): `<argumentos>`.

Nada sale fuera (push, MR, Slack, YouTrack) sin la aprobación del paso 3, y solo lo aprobado.

## 0. Datos del repo

Los datos del equipo viven en el `.flow/config.toml` del repo, que es local y no se sube a git. Léelo
desde la raíz del repo y usa estos valores en todo el skill:

- `<youtrack>`: `[youtrack] url` (p. ej. `https://youtrack.example.com`).
- `<canal>` y `<canal-id>`: `[slack] review_channel` (p. ej. `#team-reviews`) y `review_channel_id`.

Si falta `[youtrack] url` o `[slack]`, dilo y para: el skill necesita los dos. Si las herramientas
`mcp__claude_ai_Slack__*` no están disponibles, dilo, sugiere `/mcp` para conectar Slack y para antes de
crear nada, para no dejar un MR sin su aviso de review. Nunca inventes ni reutilices estos valores de
otra conversación o de los ejemplos.

## 1. Comprobaciones

- Rama actual: `git branch --show-current`. Si es `main`, para.
- ID del ticket: el prefijo `^[A-Z]+-[0-9]+` del nombre de la rama actual. Si no hay, pregunta el ID.
  Ese `<ID>` es el único que se usa en título, Slack, enlace de YouTrack y cambio de State; nunca uses un
  ID de la conversación, de la memoria o de los ejemplos de este skill. Los ejemplos con PROJ-20887 son
  solo formato.
- `git status --porcelain`: si hay cambios sin commitear, muéstralos y pregunta si seguir sin ellos o
  parar (`C` en flow los commitea con `flow-commit-create`). No commitees ni hagas stash por tu cuenta.
- `git fetch origin --quiet` y `git log --oneline origin/main..HEAD`: si no hay commits, para.
- Si `glab auth status` va bien (glab saca el host del remote del repo), mira si ya existe un MR abierto de esta
  rama (`glab mr list --source-branch <rama>`). Si existe, avisa y ofrece solo los pasos 5-6 con ese MR.

## 2. Preparar la propuesta

- Ticket: `mcp__youtrack__get_issue` (`recentCommentsCount: 0`) para el summary y el State actual.
- Cambio: `git log origin/main..HEAD --format='%s%n%b'` y `git diff --stat origin/main...HEAD`.
- **Título del MR**: `<ID>: <resumen breve y muy descriptivo de lo que hace la rama>` (estilo:
  "PROJ-20887: Keep N-1 overlay badge on one line"). Inglés.
- **Descripción del MR**: una frase en inglés con el efecto del cambio, no la mecánica (sin nombres de
  archivos ni funciones, sin refactors ni beneficios secundarios). Después, una línea con cómo se probó:
  - tests nuevos o cambiados → menciónalos en la misma frase ("…, and new tests check that …").
  - prueba manual → línea aparte `Tested locally.` o `Tested on staging.`
    Si `<argumentos>` no lo dice y no lo sabes por la conversación, pregúntalo.
  - al final, tras una línea en blanco: `Closes <ID>`.
- **Mensaje de Slack** para `<canal>` (`<canal-id>`), con este formato exacto:
  ```
  :code-review: <URL del MR>
  • [<ID>](<youtrack>/issue/<ID>): <resumen del título, sin el ID>
  ```
- **YouTrack**: State actual → `Review`.

## 3. Aprobación

Una sola llamada a `AskUserQuestion` con **tres preguntas** (single select), una por acción. En cada
una, las tres opciones llevan el mismo `preview` con el contenido exacto tal como quedará:

1. header `MR`: "¿Creo el MR así?". Preview:
   ```
   Título:
   <título>

   Descripción:
   <descripción>

   Destino: main · borrar rama al mergear · asignado a mí
   ```
2. header `Slack`: "¿Envío este mensaje a `<canal>`?". Preview: el mensaje exacto, con
   `<URL del MR>` como marcador.
3. header `YouTrack`: "¿Paso <ID> a Review?". Preview: `<ID>: <State actual> → Review`.

Opciones de cada pregunta:

- `Sí`: description "Hacerlo tal cual".
- `No`: description "Saltar este paso". En la pregunta del MR: "Cancelar todo" (sin MR no hay Slack).
- `Cambiar`: description "Dime qué cambiar (o escríbelo directamente en Other)".

No escribas la propuesta en texto antes del selector: el preview ya la muestra.

Después:

- Si alguna respuesta es `Cambiar` o un texto en Other, aplica los cambios (pregunta en texto qué
  cambiar si eligió `Cambiar` sin decirlo) y vuelve a lanzar el selector **solo con las preguntas que
  cambiaron**; las que ya tienen `Sí`/`No` se mantienen.
- `No` en el MR cancela todo. `No` en Slack o YouTrack solo salta ese paso.
- Ejecuta los pasos 4-6 aprobados cuando ninguna pregunta quede pendiente.

## 4. Push y MR

```bash
git push -u origin <rama>
glab mr create --source-branch <rama> --target-branch main --remove-source-branch \
  --assignee @me --yes --title "<título>" --description "<descripción>"
```

- `glab` conserva los saltos de línea de la descripción y asigna el MR al usuario autenticado.
- El hook de pre-push lanza mypy y puede tardar; usa un timeout largo. Si falla, enseña el error y para.
- Saca la URL del MR de la salida de `glab`. Si dice que ya existía, usa esa.
- Si `glab` no está autenticado, crea el MR con push options (`-o merge_request.create`,
  `.target=main`, `.title`, `.description`, `.remove_source_branch`), con las líneas de la descripción
  unidas por espacios, y avisa de que faltan los saltos de línea y el assignee.

## 5. Slack

Si en el paso 3 respondió `Sí` a Slack, envía el mensaje con `mcp__claude_ai_Slack__slack_send_message`
en `<canal-id>`, con la URL real del MR. Sin ese `Sí`, no envíes nada.

## 6. YouTrack

`mcp__youtrack__update_issue` con `customFields: {"State": "Review"}`. Si ya estaba en Review, no hagas
nada. Si falla (valor no válido para el proyecto), mira `get_issue_fields_schema` y dilo; no inventes
otro estado.

## 7. Resumen

Corto: URL del MR, enlace al mensaje enviado en `<canal>`, State
anterior → Review. Di claramente cualquier paso que haya fallado o se haya saltado.
