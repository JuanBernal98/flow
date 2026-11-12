---
name: flow-ticket-switch
description: Lista mis tickets de YouTrack asignados, cambia a la rama del elegido (la crea desde origin/main si no existe) y carga su contexto.
argument-hint: "[ID]"
disable-model-invocation: true
---

Empieza a trabajar en un ticket de YouTrack. Responde en español. Argumento opcional: `<argumentos>`.

Si las herramientas `mcp__youtrack__*` no están disponibles, dilo, sugiere ejecutar `/mcp` para reconectar `youtrack` y para.

## 1. Elegir ticket

- Si `<argumentos>` contiene un ID (p. ej. `PROJ-20887`), úsalo y pasa al paso 2.
- Si no, llama a `mcp__youtrack__search_issues` con query `for: me #Unresolved State: -Review sort by: updated desc`,
  `customFieldsToReturn: ["Type", "State", "Priority"]`, `limit: 20`.
  Que elija con un selector interactivo (`AskUserQuestion`, single select, header `Ticket`), paginado
  porque admite como mucho 4 opciones:
  - Cada página tiene hasta 3 tickets en el orden de la búsqueda. Label: `<ID> · <State>`. Description:
    el summary (Type si cabe).
  - Si quedan más tickets, la 4.ª opción es `Ver más…`, con la description `Tickets X–Y de N`. En la
    última página no la pongas; si quedan exactamente 4, muestra los 4.
  - Pregunta: `¿Con qué ticket seguimos? (página P/T; los de Review están ocultos, escribe su ID en "Other")`.
  - Si elige `Ver más…`, muestra la página siguiente. Si escribe un ID en Other, úsalo.
    No escribas la lista en texto antes del selector.

## 2. Comprobar el working tree

Ejecuta `git status --porcelain`. Si hay cambios, muéstralos y pregunta qué hacer: stash, que commitee él
o cancelar. **No hagas stash, commit ni descartes nada sin que lo diga.** No sigas hasta que responda.

## 3. Rama

1. `git fetch origin --prune` (si falla, avisa y sigue con lo que haya en local).
2. Busca ramas que coincidan con `^<ID>($|-)`:
   - locales: `git branch --format='%(refname:short)' --list '<ID>' '<ID>-*'`
   - remotas: `git branch -r --format='%(refname:short)' --list 'origin/<ID>' 'origin/<ID>-*'`
3. Decide:
   - Ya estás en la rama del ticket → no cambies nada.
   - Una rama local → `git switch <rama>`.
   - Solo existe en remoto → `git switch --track origin/<rama>`.
   - Varias candidatas → lístalas y pregunta cuál. Para hasta que responda.
   - Ninguna → `git switch --no-track -c <ID> origin/main` (la rama se llama solo con el ID; `--no-track`
     para que no quede siguiendo a main).
4. Si la rama ya existía: `git log --oneline origin/main..HEAD` y `git status -sb` para ver qué hay hecho
   y si va por delante o por detrás de su remota. No hagas pull ni rebase sin preguntar.

## 4. Contexto y resumen

Usa el skill `flow-ticket-context` con el `<ID>` (carga el ticket, su padre, Notion y los `AGENTS.md`, y resume
lo hecho en la rama). Muestra su resumen en el chat, añadiendo al principio la línea **Rama**: nombre y si es
nueva, local existente o traída del remoto.

No empieces a implementar hasta que lo pida.

## Reglas

- YouTrack es solo lectura: no cambies campos, asignado ni comentes. Si el ticket está en `Next`, ofrece
  pasarlo a `In Progress` y hazlo solo si dice que sí (`mcp__youtrack__update_issue`).
- Nunca commit, stash, rebase, pull ni push sin que lo pida.
